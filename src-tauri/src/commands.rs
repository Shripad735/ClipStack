use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use arboard::{Clipboard, ImageData};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
};

use crate::cleanup;
use crate::settings::{sync_launch_on_login, AppSettings};
use crate::storage::{ClipboardEntry, ClipboardEntryKind, Storage};
use crate::{logging, runtime, window, AppState};

pub const HISTORY_CHANGED_EVENT: &str = "history-changed";
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// Runs a storage operation on the blocking pool.
///
/// Tauri executes synchronous commands on the UI thread, and the storage mutex
/// is held by the clipboard worker while it encodes PNGs and prunes media.
/// Moving every database call here is what keeps the overlay responsive.
async fn with_storage<T, F>(state: &State<'_, AppState>, work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut Storage) -> Result<T, String> + Send + 'static,
{
    let storage = std::sync::Arc::clone(&state.storage);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = storage.lock().map_err(|error| error.to_string())?;
        work(&mut guard)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_history(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ClipboardEntry>, String> {
    let query = query.unwrap_or_default();
    let query = if query.trim().is_empty() {
        None
    } else {
        Some(query)
    };

    with_storage(&state, move |storage| {
        storage.get_history(query.as_deref(), limit)
    })
    .await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    with_storage(&state, |storage| storage.load_settings()).await
}

#[tauri::command]
pub async fn copy_item(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let (entry, settings) = with_storage(&state, move |storage| {
        let entry = storage
            .get_entry(id)?
            .ok_or_else(|| "clipboard item not found".to_string())?;
        storage.touch_last_copied(id)?;
        let settings = storage.load_settings()?;
        Ok((entry, settings))
    })
    .await?;

    let entry_for_clipboard = entry.clone();
    tauri::async_runtime::spawn_blocking(move || set_clipboard(&entry_for_clipboard))
        .await
        .map_err(|error| error.to_string())??;

    if settings.hide_after_copy || settings.paste_on_select {
        window::hide_overlay(&app, "copy-item")?;
    }

    if settings.paste_on_select {
        thread::spawn(|| {
            thread::sleep(Duration::from_millis(140));
            if let Err(error) = send_ctrl_v() {
                log::debug!("paste automation skipped: {error}");
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_pin(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    with_storage(&state, move |storage| storage.toggle_pin(id)).await?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_item(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    with_storage(&state, move |storage| storage.delete_entry(id)).await?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn clear_unpinned(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    with_storage(&state, |storage| storage.clear_unpinned()).await?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let next_settings = settings.sanitized();
    let persisted = next_settings.clone();

    with_storage(&state, move |storage| {
        storage.save_settings(&persisted)?;
        cleanup::prune(storage, &persisted)
    })
    .await?;

    state.capture_enabled.store(
        next_settings.capture_enabled,
        std::sync::atomic::Ordering::Relaxed,
    );

    // A registry policy can refuse this; the setting is already persisted, so
    // this must not fail the whole command.
    if let Err(error) = sync_launch_on_login(&app, &next_settings) {
        log::warn!("launch-on-login could not be updated: {error}");
    }

    app.emit(SETTINGS_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    app.emit(HISTORY_CHANGED_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(next_settings)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    window::hide_overlay(&app, "command")
}

#[tauri::command]
pub async fn export_history(
    state: State<'_, AppState>,
    format: Option<String>,
) -> Result<String, String> {
    let format = format
        .unwrap_or_else(|| "json".to_string())
        .trim()
        .to_ascii_lowercase();

    let history = with_storage(&state, |storage| storage.export_history()).await?;
    let content = match format.as_str() {
        "csv" => to_csv(&history),
        "json" => serde_json::to_string_pretty(&history).map_err(|error| error.to_string())?,
        _ => return Err("unsupported export format".to_string()),
    };

    let extension = format.as_str();
    let timestamp = crate::settings::current_timestamp_ms();
    let target_dir = dirs::document_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let output_path = target_dir.join(format!("clipstack-history-{timestamp}.{extension}"));

    let path = output_path.clone();
    tauri::async_runtime::spawn_blocking(move || fs::write(&path, content))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;

    log::info!("history exported to {}", output_path.display());
    Ok(output_path.to_string_lossy().to_string())
}

/// Called by the frontend once React has painted for the first time.
#[tauri::command]
pub fn overlay_ready(app: AppHandle, state: State<'_, AppState>) {
    state.runtime.mark_ready(&app);
}

/// Renderer heartbeat for the UI watchdog.
#[tauri::command]
pub fn heartbeat(state: State<'_, AppState>) {
    state.runtime.heartbeat();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub version: String,
    pub safe_mode: bool,
    pub log_path: String,
    pub log_dir: String,
}

#[tauri::command]
pub fn get_runtime_info(state: State<'_, AppState>) -> RuntimeInfo {
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        safe_mode: state.runtime.safe_mode,
        log_path: logging::log_path().to_string_lossy().to_string(),
        log_dir: logging::log_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn open_logs_folder() -> Result<(), String> {
    let dir = logging::log_dir();
    let _ = fs::create_dir_all(&dir);

    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err("opening the log folder is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn restart_app(_app: AppHandle) {
    runtime::restart("user-request");
}

fn set_clipboard(entry: &ClipboardEntry) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;

    match entry.kind {
        ClipboardEntryKind::Text => clipboard
            .set_text(entry.content.clone())
            .map_err(|error| error.to_string()),
        ClipboardEntryKind::Image => {
            let image_path = entry
                .image_path
                .clone()
                .ok_or_else(|| "image file missing for clipboard item".to_string())?;
            let image_bytes = fs::read(&image_path).map_err(|error| error.to_string())?;
            let decoded =
                image::load_from_memory(&image_bytes).map_err(|error| error.to_string())?;
            let rgba = decoded.to_rgba8();
            let (width, height) = rgba.dimensions();

            clipboard
                .set_image(ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(rgba.into_raw()),
                })
                .map_err(|error| error.to_string())
        }
    }
}

fn send_ctrl_v() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_MENU, VK_SHIFT,
        };

        // Never inject a paste while a modifier is still physically held: the
        // synthetic keystrokes would combine with it (Ctrl+Alt+V, Alt+Tab, ...)
        // and land in whatever window has focus by then.
        for key in [VK_CONTROL, VK_MENU, VK_SHIFT] {
            if unsafe { GetAsyncKeyState(key as i32) } as u16 & 0x8000 != 0 {
                return Err("a modifier key is still held down".to_string());
            }
        }

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
            Err("failed to send the paste shortcut".to_string())
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
        let image_width = entry
            .image_width
            .map(|value| value.to_string())
            .unwrap_or_default();
        let image_height = entry
            .image_height
            .map(|value| value.to_string())
            .unwrap_or_default();
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
