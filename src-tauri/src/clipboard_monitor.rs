use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use tauri::{AppHandle, Emitter};

use crate::commands::HISTORY_CHANGED_EVENT;
use crate::{cleanup, AppState};

#[derive(Clone, Debug, PartialEq, Eq)]
enum ClipboardSnapshot {
    Empty,
    Text(String),
    Image(String),
}

pub fn spawn(app: AppHandle, state: AppState) {
    thread::spawn(move || {
        let mut clipboard = loop {
            match Clipboard::new() {
                Ok(clipboard) => break clipboard,
                Err(_) => thread::sleep(Duration::from_secs(2)),
            }
        };

        let mut last_seen = ClipboardSnapshot::Empty;

        loop {
            if !state.capture_enabled.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(250));
                continue;
            }

            let snapshot = if let Ok(content) = clipboard.get_text() {
                let trimmed = content.trim().to_string();
                if trimmed.is_empty() {
                    ClipboardSnapshot::Empty
                } else {
                    ClipboardSnapshot::Text(trimmed)
                }
            } else if let Ok(image) = clipboard.get_image() {
                let signature = format!("{}x{}:{}", image.width, image.height, image.bytes.len());
                ClipboardSnapshot::Image(signature)
            } else {
                ClipboardSnapshot::Empty
            };

            if snapshot != ClipboardSnapshot::Empty && snapshot != last_seen {
                let inserted = match &snapshot {
                    ClipboardSnapshot::Text(content) => {
                        let mut storage = match state.storage.lock() {
                            Ok(storage) => storage,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(250));
                                continue;
                            }
                        };
                        let settings = storage.load_settings().unwrap_or_default();
                        let result = storage.insert_text_entry(content).ok().flatten();
                        if result.is_some() {
                            let _ = cleanup::prune(&mut storage, &settings);
                        }
                        result
                    }
                    ClipboardSnapshot::Image(_) => {
                        let image = match clipboard.get_image() {
                            Ok(image) => image,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(225));
                                continue;
                            }
                        };
                        let width = match u32::try_from(image.width) {
                            Ok(value) => value,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(225));
                                continue;
                            }
                        };
                        let height = match u32::try_from(image.height) {
                            Ok(value) => value,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(225));
                                continue;
                            }
                        };
                        let bytes = image.bytes.into_owned();
                        let mut storage = match state.storage.lock() {
                            Ok(storage) => storage,
                            Err(_) => {
                                thread::sleep(Duration::from_millis(250));
                                continue;
                            }
                        };
                        let settings = storage.load_settings().unwrap_or_default();
                        let result = storage.insert_image_entry(&bytes, width, height).ok().flatten();
                        if result.is_some() {
                            let _ = cleanup::prune(&mut storage, &settings);
                        }
                        result
                    }
                    ClipboardSnapshot::Empty => None,
                };

                if inserted.is_some() {
                    last_seen = snapshot;
                    let _ = app.emit(HISTORY_CHANGED_EVENT, true);
                }
            }

            thread::sleep(Duration::from_millis(225));
        }
    });
}
