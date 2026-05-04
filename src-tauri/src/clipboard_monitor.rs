use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use tauri::{AppHandle, Emitter};

use crate::commands::HISTORY_CHANGED_EVENT;
use crate::{cleanup, AppState};

pub fn spawn(app: AppHandle, state: AppState) {
    thread::spawn(move || {
        let mut clipboard = loop {
            match Clipboard::new() {
                Ok(clipboard) => break clipboard,
                Err(_) => thread::sleep(Duration::from_secs(2)),
            }
        };

        let mut last_seen = String::new();

        loop {
            if !state.capture_enabled.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            if let Ok(content) = clipboard.get_text() {
                if !content.trim().is_empty() && content != last_seen {
                    let inserted = {
                        let mut storage = match state.storage.lock() {
                            Ok(storage) => storage,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(250));
                                continue;
                            }
                        };

                        last_seen = content.clone();
                        let settings = storage.load_settings().unwrap_or_default();
                        let result = storage.insert_entry(&content).ok().flatten();
                        if result.is_some() {
                            let _ = cleanup::prune(&mut storage, &settings);
                        }
                        result
                    };

                    if inserted.is_some() {
                        let _ = app.emit(HISTORY_CHANGED_EVENT, true);
                    }
                }
            }

            thread::sleep(Duration::from_millis(225));
        }
    });
}
