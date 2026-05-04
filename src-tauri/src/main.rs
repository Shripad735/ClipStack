#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cleanup;
mod clipboard_monitor;
mod commands;
mod settings;
mod storage;
mod tray;
mod window;

use std::env;
use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::settings::sync_launch_on_login;
use crate::storage::Storage;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<Mutex<Storage>>,
    pub capture_enabled: Arc<AtomicBool>,
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;

                    if event.state() == ShortcutState::Pressed {
                        let _ = window::toggle_overlay(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;

            let db_path = app_dir.join("clipstack.db");
            let mut storage = Storage::open(&db_path)?;
            let settings = storage.load_settings()?;
            cleanup::prune(&mut storage, &settings)?;
            sync_launch_on_login(app.handle(), &settings)?;

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                let shortcut =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV);
                app.global_shortcut()
                    .register(shortcut)
                    .map_err(|error| error.to_string())?;
            }

            let state = AppState {
                storage: Arc::new(Mutex::new(storage)),
                capture_enabled: Arc::new(AtomicBool::new(settings.capture_enabled)),
            };

            app.manage(state.clone());
            tray::create_tray(app.handle())?;

            let launched_from_autostart = env::args().any(|arg| arg == "--autostart");
            if settings.show_on_launch && !launched_from_autostart {
                let _ = window::show_overlay(app.handle());
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            clipboard_monitor::spawn(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_history,
            commands::get_settings,
            commands::copy_item,
            commands::toggle_pin,
            commands::delete_item,
            commands::clear_unpinned,
            commands::update_settings,
            commands::hide_overlay,
            commands::export_history
        ])
        .run(tauri::generate_context!())
        .expect("failed to run ClipStack")
}
