use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Emitter, Manager, Position, PhysicalPosition};

pub const OVERLAY_FOCUS_EVENT: &str = "overlay-focus";
static LAST_WINDOW_POSITION: LazyLock<Mutex<Option<PhysicalPosition<i32>>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn show_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;

    window.unminimize().map_err(|error| error.to_string())?;
    let position = LAST_WINDOW_POSITION
        .lock()
        .map_err(|error| error.to_string())?
        .to_owned();

    if let Some(saved_position) = position {
        window
            .set_position(Position::Physical(saved_position))
            .map_err(|error| error.to_string())?;
    } else {
        window.center().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit(OVERLAY_FOCUS_EVENT, true)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn hide_overlay(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(position) = window.outer_position() {
            if let Ok(mut cached_position) = LAST_WINDOW_POSITION.lock() {
                *cached_position = Some(position);
            }
        }
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn toggle_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window unavailable".to_string())?;

    let visible = window.is_visible().map_err(|error| error.to_string())?;
    if visible {
        hide_overlay(app)
    } else {
        show_overlay(app)
    }
}
