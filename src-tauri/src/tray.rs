use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Emitter;
use tauri::Manager;

use crate::commands::SETTINGS_CHANGED_EVENT;
use crate::{window, AppState};

const SHOW_ID: &str = "show_overlay";
const TOGGLE_CAPTURE_ID: &str = "toggle_capture";
const QUIT_ID: &str = "quit";

pub fn create_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let show = MenuItem::with_id(app, SHOW_ID, "Show ClipStack", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let toggle_capture = MenuItem::with_id(
        app,
        TOGGLE_CAPTURE_ID,
        "Pause / Resume Capture",
        true,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show, &toggle_capture, &quit])
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
                if let Err(error) = window::show_overlay(app) {
                    eprintln!("failed to show ClipStack from tray menu: {error}");
                }
            }
            TOGGLE_CAPTURE_ID => {
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

                let _ = app.emit(SETTINGS_CHANGED_EVENT, true);
            }
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
                if let Err(error) = window::toggle_overlay(&tray.app_handle()) {
                    eprintln!("failed to toggle ClipStack from tray icon left-click: {error}");
                }
            }
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(())
}
