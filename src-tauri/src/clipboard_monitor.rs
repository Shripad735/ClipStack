use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};

use arboard::Clipboard;
use tauri::{AppHandle, Emitter};
#[cfg(windows)]
use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;

use crate::commands::HISTORY_CHANGED_EVENT;
use crate::{cleanup, AppState};

const POLL_INTERVAL: Duration = Duration::from_millis(250);
const PRUNE_INTERVAL: Duration = Duration::from_secs(5);
const CLIPBOARD_RETRY: Duration = Duration::from_secs(2);
/// 40 megapixels. Anything larger is a screenshot of several 4K monitors and is
/// not worth the encode cost or the disk space.
const MAX_IMAGE_PIXELS: u64 = 40_000_000;

#[derive(Clone, Debug, PartialEq, Eq)]
enum ClipboardSnapshot {
    Empty,
    Text(String),
    Image(String),
}

/// An entry ready to be inserted, built before the storage lock is taken.
enum PendingEntry {
    Text(String),
    Image {
        bytes: Vec<u8>,
        width: u32,
        height: u32,
    },
}

pub fn spawn(app: AppHandle, state: AppState) {
    let result = thread::Builder::new()
        .name("clipstack-clipboard".into())
        .spawn(move || run(app, state));

    if let Err(error) = result {
        log::error!("failed to start the clipboard monitor: {error}");
    }
}

fn run(app: AppHandle, state: AppState) {
    let mut clipboard = loop {
        match Clipboard::new() {
            Ok(clipboard) => break clipboard,
            Err(error) => {
                log::warn!("clipboard unavailable ({error}); retrying");
                thread::sleep(CLIPBOARD_RETRY);
            }
        }
    };

    log::info!("clipboard monitor started");

    let mut last_seen = ClipboardSnapshot::Empty;
    // 0 means "unknown on the first tick", which forces the current clipboard
    // to be captured once at startup, like before.
    let mut last_sequence = 0u32;
    let mut last_prune = Instant::now();

    loop {
        if !state.capture_enabled.load(Ordering::Relaxed) {
            thread::sleep(POLL_INTERVAL);
            continue;
        }

        // Reading the clipboard allocates (and an image is tens of megabytes),
        // so only read it when Windows reports that the content changed.
        let sequence = clipboard_sequence();
        if sequence != 0 && sequence == last_sequence {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        last_sequence = sequence;

        let snapshot = read_snapshot(&mut clipboard);
        if snapshot == ClipboardSnapshot::Empty || snapshot == last_seen {
            thread::sleep(POLL_INTERVAL);
            continue;
        }

        let Some(entry) = materialize(&mut clipboard, &snapshot) else {
            thread::sleep(POLL_INTERVAL);
            continue;
        };

        let entry_kind = match &entry {
            PendingEntry::Text(_) => "text",
            PendingEntry::Image { .. } => "image",
        };

        let inserted = match lock_storage(&state) {
            Some(mut storage) => match &entry {
                PendingEntry::Text(content) => storage.insert_text_entry(content),
                PendingEntry::Image {
                    bytes,
                    width,
                    height,
                } => storage.insert_image_entry(bytes, *width, *height),
            },
            None => {
                thread::sleep(POLL_INTERVAL);
                continue;
            }
        };

        match inserted {
            Ok(Some(_)) => {
                last_seen = snapshot;
                log::debug!("captured a {entry_kind} clipboard entry");
                let _ = app.emit(HISTORY_CHANGED_EVENT, true);

                if last_prune.elapsed() >= PRUNE_INTERVAL {
                    last_prune = Instant::now();
                    prune(&state);
                }
            }
            Ok(None) => {
                last_seen = snapshot;
            }
            Err(error) => {
                log::warn!("failed to store the clipboard entry: {error}");
            }
        }

        thread::sleep(POLL_INTERVAL);
    }
}

fn prune(state: &AppState) {
    let Some(mut storage) = lock_storage(state) else {
        return;
    };

    match storage.load_settings() {
        Ok(settings) => {
            if let Err(error) = cleanup::prune(&mut storage, &settings) {
                log::warn!("periodic cleanup failed: {error}");
            }
        }
        Err(error) => log::warn!("could not read settings for cleanup: {error}"),
    }
}

fn lock_storage(state: &AppState) -> Option<std::sync::MutexGuard<'_, crate::storage::Storage>> {
    match state.storage.lock() {
        Ok(storage) => Some(storage),
        Err(error) => {
            log::error!("storage lock is poisoned: {error}");
            None
        }
    }
}

fn read_snapshot(clipboard: &mut Clipboard) -> ClipboardSnapshot {
    match clipboard.get_text() {
        Ok(content) => {
            let trimmed = content.trim().to_string();
            if trimmed.is_empty() {
                ClipboardSnapshot::Empty
            } else {
                ClipboardSnapshot::Text(trimmed)
            }
        }
        Err(_) => match clipboard.get_image() {
            Ok(image) => {
                let pixels = image.width as u64 * image.height as u64;
                if pixels == 0 {
                    ClipboardSnapshot::Empty
                } else if pixels > MAX_IMAGE_PIXELS {
                    log::debug!("ignoring a {pixels} px clipboard image");
                    ClipboardSnapshot::Empty
                } else {
                    ClipboardSnapshot::Image(format!(
                        "{}x{}:{}",
                        image.width,
                        image.height,
                        image.bytes.len()
                    ))
                }
            }
            Err(_) => ClipboardSnapshot::Empty,
        },
    }
}

fn materialize(clipboard: &mut Clipboard, snapshot: &ClipboardSnapshot) -> Option<PendingEntry> {
    match snapshot {
        ClipboardSnapshot::Empty => None,
        ClipboardSnapshot::Text(content) => Some(PendingEntry::Text(content.clone())),
        ClipboardSnapshot::Image(_) => {
            let image = match clipboard.get_image() {
                Ok(image) => image,
                Err(error) => {
                    log::debug!("could not re-read the clipboard image: {error}");
                    return None;
                }
            };

            let width = u32::try_from(image.width).ok()?;
            let height = u32::try_from(image.height).ok()?;

            Some(PendingEntry::Image {
                bytes: image.bytes.into_owned(),
                width,
                height,
            })
        }
    }
}

fn clipboard_sequence() -> u32 {
    #[cfg(windows)]
    {
        unsafe { GetClipboardSequenceNumber() }
    }

    #[cfg(not(windows))]
    {
        0
    }
}
