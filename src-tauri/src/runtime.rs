//! Runtime guards: overlay readiness, UI watchdog, emergency escape hatch and
//! user-visible fatal errors.
//!
//! Everything here is deliberately independent of Tauri window handles: these
//! threads must keep working when the UI thread is wedged, which is precisely
//! the failure mode they exist to recover from.

use std::fs;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::AppHandle;

use crate::logging;
use crate::settings::current_timestamp_ms;
use crate::window;

/// A UI freeze shorter than this is noise (a big paste, a slow disk).
const HANG_TIMEOUT_MS: u64 = 8_000;
/// A heartbeat older than this is a suspended machine (sleep/resume), not a
/// hang: the whole system clock jumped while the process was frozen.
const RESUME_GAP_MS: u64 = 120_000;
/// How long a queued overlay show waits for the renderer before forcing it.
const READY_TIMEOUT: Duration = Duration::from_secs(3);
/// Never auto-restart twice within this window, to avoid a restart loop.
const RESTART_GUARD: Duration = Duration::from_secs(120);

pub struct RuntimeFlags {
    pub safe_mode: bool,
    overlay_ready: AtomicBool,
    pending_show: AtomicBool,
    pending_timer_started: AtomicBool,
    last_heartbeat_ms: AtomicI64,
    overlay_visible: AtomicBool,
    restart_suppressed: AtomicBool,
}

impl RuntimeFlags {
    pub fn new(safe_mode: bool) -> Self {
        Self {
            safe_mode,
            overlay_ready: AtomicBool::new(false),
            pending_show: AtomicBool::new(false),
            pending_timer_started: AtomicBool::new(false),
            last_heartbeat_ms: AtomicI64::new(current_timestamp_ms()),
            overlay_visible: AtomicBool::new(false),
            restart_suppressed: AtomicBool::new(restart_guard_tripped()),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.overlay_ready.load(Ordering::SeqCst)
    }

    pub fn is_visible(&self) -> bool {
        self.overlay_visible.load(Ordering::SeqCst)
    }

    pub fn set_visible(&self, visible: bool) {
        self.overlay_visible.store(visible, Ordering::SeqCst);
        // A fresh visible window always starts with a clean watchdog budget so
        // a slow first paint is never mistaken for a hang.
        self.last_heartbeat_ms
            .store(current_timestamp_ms(), Ordering::SeqCst);
    }

    pub fn heartbeat(&self) {
        self.last_heartbeat_ms
            .store(current_timestamp_ms(), Ordering::SeqCst);
    }

    /// Called by the `overlay_ready` command once React has painted.
    pub fn mark_ready(self: &Arc<Self>, app: &AppHandle) {
        if self.overlay_ready.swap(true, Ordering::SeqCst) {
            return;
        }
        log::info!("overlay renderer reported ready");

        if self.pending_show.swap(false, Ordering::SeqCst) {
            if let Err(error) = window::show_now(app, "deferred") {
                log::error!("deferred overlay show failed: {error}");
            }
        }
    }

    /// Shows the overlay now, or queues the show until the renderer is ready.
    pub fn request_show(self: &Arc<Self>, app: &AppHandle, reason: &str) {
        if self.is_ready() {
            if let Err(error) = window::show_now(app, reason) {
                log::error!("overlay show failed ({reason}): {error}");
            }
            return;
        }

        log::info!("overlay show deferred ({reason}): renderer not ready yet");
        self.pending_show.store(true, Ordering::SeqCst);
        self.start_pending_timer(app);
    }

    fn start_pending_timer(self: &Arc<Self>, app: &AppHandle) {
        if self.pending_timer_started.swap(true, Ordering::SeqCst) {
            return;
        }

        let flags = Arc::clone(self);
        let app = app.clone();
        thread::Builder::new()
            .name("clipstack-ready-timer".into())
            .spawn(move || {
                thread::sleep(READY_TIMEOUT);
                if !flags.pending_show.load(Ordering::SeqCst) {
                    return;
                }
                flags.pending_show.store(false, Ordering::SeqCst);
                log::warn!(
                    "renderer did not report ready within {}s; showing the overlay anyway",
                    READY_TIMEOUT.as_secs()
                );
                let main_app = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let _ = window::show_now(&main_app, "ready-timeout");
                });
            })
            .ok();
    }
}

/// Watches the renderer heartbeat and restarts a wedged process.
pub fn start_supervisor(flags: Arc<RuntimeFlags>) {
    let result = thread::Builder::new()
        .name("clipstack-supervisor".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(1_000));

            if !flags.is_visible() {
                flags.heartbeat();
                continue;
            }

            let now = current_timestamp_ms();
            let last = flags.last_heartbeat_ms.load(Ordering::SeqCst);
            let gap = now.saturating_sub(last);

            if gap <= HANG_TIMEOUT_MS as i64 {
                continue;
            }

            if gap > RESUME_GAP_MS as i64 {
                log::warn!("no UI heartbeat for {gap} ms - assuming system resume, not a hang");
                flags.heartbeat();
                continue;
            }

            log::error!("UI watchdog: overlay visible but unresponsive for {gap} ms");
            if flags.restart_suppressed.load(Ordering::SeqCst) {
                log::error!(
                    "auto-restart suppressed after a recent restart; leaving the process alive"
                );
                flags.heartbeat();
                continue;
            }

            restart("ui-watchdog");
        });

    if let Err(error) = result {
        log::error!("failed to start the UI watchdog: {error}");
    }
}

/// Spawns a replacement process and exits this one from any thread.
pub fn restart(reason: &str) {
    log::warn!("restarting ClipStack ({reason})");
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::write(
            logging::app_data_dir().join("restart-guard"),
            current_timestamp_ms().to_string(),
        );
        match std::process::Command::new(exe).arg("--restarted").spawn() {
            Ok(_) => {}
            Err(error) => log::error!("failed to spawn the replacement process: {error}"),
        }
    }
    std::process::exit(0);
}

fn restart_guard_tripped() -> bool {
    let marker = logging::app_data_dir().join("restart-guard");
    fs::metadata(&marker)
        .and_then(|meta| meta.modified())
        .map(|modified| {
            modified
                .elapsed()
                .map(|age| age < RESTART_GUARD)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Logs and shows a native error box, then exits. Used when the app cannot run
/// at all (the database could not be opened), so the user is never left with a
/// process that silently does nothing.
pub fn fatal(title: &str, message: &str) -> ! {
    log::error!("fatal: {title}: {message}");
    let _ = fs::write(
        logging::log_dir().join("last-error.txt"),
        format!("{title}\n\n{message}\n"),
    );

    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

        let text = to_wide(message);
        let caption = to_wide(title);
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_ICONERROR | MB_OK,
        );
    }

    std::process::exit(1);
}

/// Ctrl+Alt+Shift+Q quits immediately, from a thread that never touches the UI
/// thread. It is the manual escape hatch if the overlay ever wedges again.
pub fn start_escape_hatch() {
    #[cfg(windows)]
    {
        let result = thread::Builder::new()
            .name("clipstack-escape-hatch".into())
            .spawn(|| unsafe {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_Q;
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                    RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
                };
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    DispatchMessageW, GetMessageW, TranslateMessage, MSG, WM_HOTKEY,
                };

                const HOTKEY_ID: i32 = 0x0C1A;
                let modifiers = MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT;

                if RegisterHotKey(std::ptr::null_mut(), HOTKEY_ID, modifiers, VK_Q as u32) == 0 {
                    log::warn!("emergency quit hotkey (Ctrl+Alt+Shift+Q) is unavailable");
                    return;
                }

                log::info!("emergency quit hotkey registered: Ctrl+Alt+Shift+Q");

                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    if message.message == WM_HOTKEY && message.wParam == HOTKEY_ID as usize {
                        log::warn!("emergency quit requested by the user");
                        std::process::exit(0);
                    }
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            });

        if let Err(error) = result {
            log::warn!("failed to start the emergency quit thread: {error}");
        }
    }
}

#[cfg(windows)]
fn to_wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}
