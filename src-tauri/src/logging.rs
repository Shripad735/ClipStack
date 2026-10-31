//! Minimal, dependency-free file logging.
//!
//! The app is built with `windows_subsystem = "windows"`, so `eprintln!` goes
//! nowhere in release builds. Without a log file an intermittent hang leaves no
//! evidence at all, which is exactly what made this class of bug undiagnosable.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use log::{LevelFilter, Metadata, Record};

pub const APP_IDENTIFIER: &str = "com.clipstack.desktop";
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

static LOG_FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();
static VERBOSE: AtomicBool = AtomicBool::new(false);

struct ClipStackLogger;

static LOGGER: ClipStackLogger = ClipStackLogger;

pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_IDENTIFIER)
}

pub fn log_dir() -> PathBuf {
    app_data_dir().join("logs")
}

pub fn log_path() -> PathBuf {
    log_dir().join("clipstack.log")
}

/// Opens the log file and installs the global logger plus a panic hook.
/// Safe to call once, before any Tauri window exists.
pub fn init(verbose: bool) {
    let dir = log_dir();
    let _ = fs::create_dir_all(&dir);

    let path = log_path();
    rotate_if_needed(&path);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok();

    let _ = LOG_FILE.set(Mutex::new(file));
    VERBOSE.store(verbose, Ordering::Relaxed);

    let _ = log::set_logger(&LOGGER);
    log::set_max_level(if verbose {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    });

    std::panic::set_hook(Box::new(|info| {
        log::error!("panic: {info}");
        let backtrace = std::backtrace::Backtrace::force_capture();
        let body = format!("{info}\n\nbacktrace:\n{backtrace}\n");
        let _ = fs::write(log_dir().join("last-crash.txt"), body);
    }));
}

fn rotate_if_needed(path: &PathBuf) {
    let too_big = fs::metadata(path)
        .map(|meta| meta.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if !too_big {
        return;
    }

    let backup = path.with_file_name("clipstack.1.log");
    let _ = fs::remove_file(&backup);
    let _ = fs::rename(path, backup);
}

impl log::Log for ClipStackLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let line = format!(
            "{} {:<5} [{}] {}\n",
            timestamp(),
            record.level(),
            record.target(),
            record.args()
        );

        if let Some(file) = LOG_FILE.get() {
            if let Ok(mut guard) = file.lock() {
                if let Some(handle) = guard.as_mut() {
                    // `File` writes are unbuffered, so a hung process still has
                    // the last events on disk.
                    let _ = handle.write_all(line.as_bytes());
                }
            }
        }

        if cfg!(debug_assertions) || VERBOSE.load(Ordering::Relaxed) {
            eprint!("{line}");
        }
    }

    fn flush(&self) {}
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = now.as_secs() as i64;
    let millis = now.subsec_millis();

    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        second_of_day / 3_600,
        (second_of_day % 3_600) / 60,
        second_of_day % 60
    )
}

/// Howard Hinnant's days-to-civil conversion, so the log needs no date crate.
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn converts_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_000), (2022, 1, 8));
    }
}
