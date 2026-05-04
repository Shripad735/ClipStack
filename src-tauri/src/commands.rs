use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use tauri::{AppHandle, Emitter, State};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
};

use crate::cleanup;
use crate::settings::{sync_launch_on_login, AppSettings};
use crate::storage::{ClipboardEntry, ClipboardEntryKind};
use crate::{window, AppState};

pub const HISTORY_CHANGED_EVENT: &str = "history-changed";
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

#[tauri::command]
pub fn get_history(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ClipboardEntry>, String> {
    let storage = state.storage.lock().map_err(|error| error.to_string())?;
    storage.get_history(query.as_deref(), limit)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let storage = state.storage.lock().map_err(|error| error.to_string())?;
    storage.load_settings()
}

#[tauri::command]
pub fn copy_item(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let (entry, settings) = {
        let mut storage = state.storage.lock().map_err(|error| error.to_string())?;
        let entry = storage
            .get_entry(id)?
            .ok_or_else(|| "clipboard item not found".to_string())?;
        storage.touch_last_copied(id)?;
        let settings = storage.load_settings()?;
        (entry, settings)
    };

    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    match entry.kind {
        ClipboardEntryKind::Text => {
            clipboard
                .set_text(entry.content)
                .map_err(|error| error.to_string())?;
        }
        ClipboardEntryKind::Image => {
            let image_path = entry
                .image_path
                .ok_or_else(|| "image file missing for clipboard item".to_string())?;
            let image_bytes = fs::read(&image_path).map_err(|error| error.to_string())?;
            let decoded = image::load_from_memory(&image_bytes).map_err(|error| error.to_string())?;
            let rgba = decoded.to_rgba8();
            let (width, height) = rgba.dimensions();
            clipboard
                .set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(rgba.into_raw()),
                })
                .map_err(|error| error.to_string())?;
        }
    }

    if settings.hide_after_copy || settings.paste_on_select {
        window::hide_overlay(&app)?;
    }

    if settings.paste_on_select {
        thread::spawn(|| {
            thread::sleep(Duration::from_millis(120));
            let _ = send_ctrl_v();
        });
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_pin(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut storage = state.storage.lock().map_err(|error| error.to_string())?;
    storage.toggle_pin(id)?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_item(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut storage = state.storage.lock().map_err(|error| error.to_string())?;
    storage.delete_entry(id)?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_unpinned(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().map_err(|error| error.to_string())?;
    storage.clear_unpinned()?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let next_settings = settings.sanitized();

    {
        let mut storage = state.storage.lock().map_err(|error| error.to_string())?;
        storage.save_settings(&next_settings)?;
        cleanup::prune(&mut storage, &next_settings)?;
    }

    state
        .capture_enabled
        .store(next_settings.capture_enabled, std::sync::atomic::Ordering::Relaxed);
    sync_launch_on_login(&app, &next_settings)?;

    app.emit(SETTINGS_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(next_settings)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    window::hide_overlay(&app)
}

#[tauri::command]
pub fn export_history(
    state: State<'_, AppState>,
    format: Option<String>,
) -> Result<String, String> {
    let format = format
        .unwrap_or_else(|| "json".to_string())
        .trim()
        .to_ascii_lowercase();

    let history = {
        let storage = state.storage.lock().map_err(|error| error.to_string())?;
        storage.export_history()?
    };

    let timestamp = crate::settings::current_timestamp_ms();
    let (extension, content) = match format.as_str() {
        "csv" => ("csv", to_csv(&history)),
        "json" => (
            "json",
            serde_json::to_string_pretty(&history).map_err(|error| error.to_string())?,
        ),
        _ => return Err("unsupported export format".to_string()),
    };

    let target_dir = dirs::document_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let output_path = target_dir.join(format!("clipstack-history-{timestamp}.{extension}"));
    fs::write(&output_path, content).map_err(|error| error.to_string())?;
    Ok(output_path.to_string_lossy().to_string())
}

fn send_ctrl_v() -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut inputs = [
            keyboard_input(VK_CONTROL as u16, 0),
            keyboard_input(b'V' as u16, 0),
            keyboard_input(b'V' as u16, KEYEVENTF_KEYUP),
            keyboard_input(VK_CONTROL as u16, KEYEVENTF_KEYUP),
        ];

        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_mut_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };

        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err("failed to send paste shortcut".to_string())
        }
    }

    #[cfg(not(windows))]
    {
        Err("paste automation is only supported on Windows builds".to_string())
    }
}

fn to_csv(entries: &[ClipboardEntry]) -> String {
    let mut output = String::from(
        "id,kind,content,image_path,image_width,image_height,created_at,pinned,last_copied_at,copy_count\n",
    );
    for entry in entries {
        let escaped_content = entry.content.replace('"', "\"\"");
        let escaped_image_path = entry
            .image_path
            .clone()
            .unwrap_or_default()
            .replace('"', "\"\"");
        let kind = match entry.kind {
            ClipboardEntryKind::Text => "text",
            ClipboardEntryKind::Image => "image",
        };
        let last_copied_at = entry
            .last_copied_at
            .map(|value| value.to_string())
            .unwrap_or_default();
        let image_width = entry.image_width.map(|value| value.to_string()).unwrap_or_default();
        let image_height = entry.image_height.map(|value| value.to_string()).unwrap_or_default();
        output.push_str(&format!(
            "{},\"{}\",\"{}\",\"{}\",{},{},{},{},{},{}\n",
            entry.id,
            kind,
            escaped_content,
            escaped_image_path,
            image_width,
            image_height,
            entry.created_at,
            entry.pinned,
            last_copied_at,
            entry.copy_count
        ));
    }
    output
}

#[cfg(windows)]
fn keyboard_input(virtual_key: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: virtual_key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
