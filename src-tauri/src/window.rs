use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewWindow};

use crate::logging;
use crate::runtime::RuntimeFlags;
use crate::AppState;

pub const OVERLAY_FOCUS_EVENT: &str = "overlay-focus";

/// Cached last position; persisted so the overlay reopens where the user left it.
static LAST_WINDOW_POSITION: LazyLock<Mutex<Option<PhysicalPosition<i32>>>> =
    LazyLock::new(|| Mutex::new(load_saved_position()));

pub fn show_overlay(app: &AppHandle, reason: &str) -> Result<(), String> {
    match runtime_flags(app) {
        // The webview has not painted yet: queue the show instead of presenting
        // a transparent, always-on-top window that cannot be seen or dismissed.
        Some(flags) if !flags.is_ready() => {
            flags.request_show(app, reason);
            Ok(())
        }
        _ => show_now(app, reason),
    }
}

/// Performs the show exactly once. Only `show()` itself is allowed to fail the
/// call: positioning and focus are best-effort, because failing before `show()`
/// is how the overlay used to disappear without any trace.
pub fn show_now(app: &AppHandle, reason: &str) -> Result<(), String> {
    let started = Instant::now();

    let window = app.get_webview_window("main").ok_or_else(|| {
        log::error!("cannot show the overlay: the main window no longer exists");
        "main window unavailable".to_string()
    })?;

    if let Err(error) = window.unminimize() {
        log::debug!("window.unminimize() failed: {error}");
    }

    apply_position(&window);

    if let Err(error) = window.show() {
        log::error!("window.show() failed: {error}");
        return Err(error.to_string());
    }

    if let Err(error) = window.set_focus() {
        // Focus can legitimately be refused by the Windows foreground lock; the
        // window is still usable, so this must not abort the show.
        log::warn!("window.set_focus() failed: {error}");
    }

    if let Err(error) = app.emit(OVERLAY_FOCUS_EVENT, true) {
        log::warn!("failed to emit {OVERLAY_FOCUS_EVENT}: {error}");
    }

    if let Some(state) = app.try_state::<AppState>() {
        state.runtime.set_visible(true);
    }

    log::info!(
        "overlay shown ({reason}) in {} ms",
        started.elapsed().as_millis()
    );
    Ok(())
}

pub fn hide_overlay(app: &AppHandle, reason: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        remember_position(&window);

        if let Err(error) = window.hide() {
            log::warn!("window.hide() failed: {error}");
            return Err(error.to_string());
        }
    }

    if let Some(state) = app.try_state::<AppState>() {
        state.runtime.set_visible(false);
    }

    log::debug!("overlay hidden ({reason})");
    Ok(())
}

pub fn toggle_overlay(app: &AppHandle, reason: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return show_overlay(app, reason);
    };

    let visible = window.is_visible().unwrap_or(false);
    if visible {
        hide_overlay(app, reason)
    } else {
        show_overlay(app, reason)
    }
}

/// Applies Windows 11 rounded corners to the undecorated window. Best effort:
/// on Windows 10 the call simply fails and the window stays square.
pub fn apply_window_chrome(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        };

        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        let preference: i32 = DWMWCP_ROUND;
        let result = unsafe {
            DwmSetWindowAttribute(
                hwnd.0 as isize as *mut std::ffi::c_void,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &preference as *const i32 as *const std::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            )
        };

        if result != 0 {
            log::debug!("DWM rounded corners unavailable (hresult {result})");
        }
    }
}

fn runtime_flags(app: &AppHandle) -> Option<Arc<RuntimeFlags>> {
    app.try_state::<AppState>()
        .map(|state| Arc::clone(&state.runtime))
}

fn apply_position(window: &WebviewWindow) {
    let saved = LAST_WINDOW_POSITION.lock().ok().and_then(|guard| *guard);

    match saved {
        Some(position) if is_on_screen(window, position) => {
            if let Err(error) = window.set_position(Position::Physical(position)) {
                log::warn!("failed to restore the overlay position: {error}");
            }
        }
        Some(_) => {
            log::info!("saved overlay position is off-screen; centring instead");
            let _ = window.center();
        }
        None => {
            if let Err(error) = window.center() {
                log::warn!("failed to centre the overlay: {error}");
            }
        }
    }
}

fn is_on_screen(window: &WebviewWindow, position: PhysicalPosition<i32>) -> bool {
    let size = match window.outer_size() {
        Ok(size) => size,
        Err(_) => return true,
    };

    let monitors = window.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        // No monitor information available: keep the saved position rather than
        // second-guessing it.
        return true;
    }

    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let bounds = monitor.size();
        position.x + size.width as i32 > origin.x
            && position.x < origin.x + bounds.width as i32
            && position.y + size.height as i32 > origin.y
            && position.y < origin.y + bounds.height as i32
    })
}

fn remember_position(window: &WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };

    let Ok(mut guard) = LAST_WINDOW_POSITION.lock() else {
        return;
    };

    let changed = guard
        .as_ref()
        .map(|saved| *saved != position)
        .unwrap_or(true);
    if changed {
        *guard = Some(position);
        persist_position(position);
    }
}

fn position_file() -> PathBuf {
    logging::app_data_dir().join("window-position.json")
}

fn load_saved_position() -> Option<PhysicalPosition<i32>> {
    let raw = fs::read_to_string(position_file()).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some(PhysicalPosition::new(x, y))
}

fn persist_position(position: PhysicalPosition<i32>) {
    let body = format!("{{\"x\":{},\"y\":{}}}", position.x, position.y);
    if let Err(error) = fs::write(position_file(), body) {
        log::debug!("failed to persist the overlay position: {error}");
    }
}
