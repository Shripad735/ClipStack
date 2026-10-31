#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cleanup;
mod clipboard_monitor;
mod commands;
mod logging;
mod runtime;
mod settings;
mod storage;
mod tray;
mod window;

use std::env;
use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::Manager;

use crate::runtime::RuntimeFlags;
use crate::settings::{sync_launch_on_login, AppSettings};
use crate::storage::Storage;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<Mutex<Storage>>,
    pub capture_enabled: Arc<AtomicBool>,
    pub runtime: Arc<RuntimeFlags>,
}

fn main() {
    let startup_started = Instant::now();
    let args: Vec<String> = env::args().collect();
    let verbose = has_flag(&args, "--verbose");
    let safe_mode = has_flag(&args, "--safe-mode");

    logging::init(verbose);
    log::info!(
        "ClipStack {} starting (safe_mode={safe_mode}, args={args:?}, log={})",
        env!("CARGO_PKG_VERSION"),
        logging::log_path().display()
    );

    if safe_mode {
        // Must be set before the WebView2 environment is created. Safe mode is
        // the switch to try when the normal compositor path is suspected.
        env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --disable-gpu-compositing --disable-features=CalculateNativeWinOcclusion",
        );
    }

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = window::show_overlay(app, "second-instance");
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;

                    if event.state() == ShortcutState::Pressed {
                        let _ = window::toggle_overlay(app, "shortcut");
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(move |app| {
            let handle = app.handle().clone();

            let app_dir = match app.path().app_data_dir() {
                Ok(dir) => dir,
                Err(error) => runtime::fatal(
                    "ClipStack cannot start",
                    &format!("The application data folder is unavailable.\n\n{error}"),
                ),
            };
            log::info!("app data folder: {}", app_dir.display());

            if let Err(error) = fs::create_dir_all(&app_dir) {
                runtime::fatal(
                    "ClipStack cannot start",
                    &format!(
                        "The application data folder could not be created.\n\n{}\n\n{error}",
                        app_dir.display()
                    ),
                );
            }

            let db_path = app_dir.join("clipstack.db");
            let media_dir = app_dir.join("images");

            let mut storage = match Storage::open(&db_path, &media_dir) {
                Ok(storage) => storage,
                Err(error) => runtime::fatal(
                    "ClipStack cannot open its history database",
                    &format!(
                        "{error}\n\nDatabase: {}\nLog file: {}",
                        db_path.display(),
                        logging::log_path().display()
                    ),
                ),
            };

            let settings = match storage.load_settings() {
                Ok(settings) => settings,
                Err(error) => {
                    log::error!("failed to load settings, falling back to defaults: {error}");
                    AppSettings::default()
                }
            };
            log::info!("settings loaded: {settings:?}");

            let prune_started = Instant::now();
            match cleanup::prune(&mut storage, &settings) {
                Ok(()) => log::info!(
                    "startup cleanup finished in {} ms",
                    prune_started.elapsed().as_millis()
                ),
                Err(error) => log::warn!("startup cleanup failed (continuing): {error}"),
            }

            if safe_mode {
                log::warn!("safe mode: skipping the launch-on-login registry sync");
            } else if let Err(error) = sync_launch_on_login(&handle, &settings) {
                // A registry policy or an antivirus can block this; the app is
                // still perfectly usable, so it must not abort the startup.
                log::warn!("failed to sync launch-on-login (continuing): {error}");
            }

            let runtime_flags = Arc::new(RuntimeFlags::new(safe_mode));
            let state = AppState {
                storage: Arc::new(Mutex::new(storage)),
                capture_enabled: Arc::new(AtomicBool::new(settings.capture_enabled)),
                runtime: Arc::clone(&runtime_flags),
            };
            app.manage(state.clone());

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyV);
                if let Err(error) = app.global_shortcut().register(shortcut) {
                    log::error!(
                        "failed to register the Alt+V shortcut (the tray icon still works): {error}"
                    );
                }
            }

            if let Err(error) = tray::create_tray(&handle) {
                log::error!("failed to create the tray icon: {error}");
            }

            if let Some(window) = app.get_webview_window("main") {
                window::apply_window_chrome(&window);
            }

            let launched_from_autostart = has_flag(&args, "--autostart");
            let was_restarted = has_flag(&args, "--restarted");
            if was_restarted || (settings.show_on_launch && !launched_from_autostart) {
                let _ = window::show_overlay(
                    &handle,
                    if was_restarted { "restart" } else { "startup" },
                );
            } else if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.hide() {
                    log::warn!("failed to hide the overlay at startup: {error}");
                }
            }

            clipboard_monitor::spawn(handle.clone(), state);
            runtime::start_supervisor(Arc::clone(&runtime_flags));
            runtime::start_escape_hatch();

            log::info!(
                "startup complete in {} ms",
                startup_started.elapsed().as_millis()
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // The overlay is only ever hidden. Destroying the main window
                // would leave a tray-only process that can never show it again.
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::warn!("failed to hide the window on close: {error}");
                }
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    state.runtime.set_visible(false);
                }
                log::info!("main window close intercepted; hidden instead of destroyed");
            }
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
            commands::export_history,
            commands::overlay_ready,
            commands::heartbeat,
            commands::get_runtime_info,
            commands::open_logs_folder,
            commands::restart_app
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        log::error!("fatal: the application loop stopped: {error}");
        runtime::fatal(
            "ClipStack stopped unexpectedly",
            &format!("{error}\n\nLog file: {}", logging::log_path().display()),
        );
    }
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}
