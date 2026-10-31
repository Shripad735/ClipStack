use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::SETTINGS_CHANGED_EVENT;
use crate::{logging, runtime, window, AppState};

const SHOW_ID: &str = "show_overlay";
const TOGGLE_CAPTURE_ID: &str = "toggle_capture";
const OPEN_LOGS_ID: &str = "open_logs";
const RESTART_ID: &str = "restart";
const QUIT_ID: &str = "quit";

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW_ID, "Show ClipStack (Alt+V)", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let toggle_capture_item = MenuItem::with_id(
        app,
        TOGGLE_CAPTURE_ID,
        "Pause / Resume Capture",
        true,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let open_logs_item =
        MenuItem::with_id(app, OPEN_LOGS_ID, "Open log folder", true, None::<&str>)
            .map_err(|error| error.to_string())?;
    let restart_item = MenuItem::with_id(app, RESTART_ID, "Restart ClipStack", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &toggle_capture_item,
            &open_logs_item,
            &restart_item,
            &quit,
        ],
    )
    .map_err(|error| error.to_string())?;

    let mut builder = TrayIconBuilder::with_id("clipstack-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("ClipStack");

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW_ID => {
                let _ = window::show_overlay(app, "tray-menu");
            }
            TOGGLE_CAPTURE_ID => toggle_capture(app),
            OPEN_LOGS_ID => open_logs_folder(),
            RESTART_ID => runtime::restart("tray-menu"),
            QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = window::toggle_overlay(&tray.app_handle(), "tray-icon");
            }
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn toggle_capture(app: &AppHandle) {
    let state = app.state::<AppState>();
    let current_enabled = state
        .capture_enabled
        .load(std::sync::atomic::Ordering::Relaxed);
    let next_enabled = !current_enabled;
    state
        .capture_enabled
        .store(next_enabled, std::sync::atomic::Ordering::Relaxed);

    if let Ok(mut storage) = state.storage.lock() {
        if let Ok(mut settings) = storage.load_settings() {
            settings.capture_enabled = next_enabled;
            let _ = storage.save_settings(&settings);
        }
    }

    log::info!(
        "clipboard capture {}",
        if next_enabled { "resumed" } else { "paused" }
    );
    let _ = app.emit(SETTINGS_CHANGED_EVENT, true);
}

fn open_logs_folder() {
    let dir = logging::log_dir();
    let _ = std::fs::create_dir_all(&dir);

    if let Err(error) = std::process::Command::new("explorer").arg(&dir).spawn() {
        log::warn!("could not open the log folder: {error}");
    }
}
