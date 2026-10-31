# ClipStack — "overlay won't open and the laptop freezes" — diagnosis and fix plan

**Version analysed:** v1.2.1 (`7073c5a`), identical in behaviour to the released v1.2.0.
**Symptom:** after the PC has been off/asleep for a few days, opening ClipStack (Alt+V, tray, Start menu) does not show
the overlay, and the whole desktop stops responding to clicks. During continuous use the app is fine.
**Status:** implemented in v1.2.2 — see §9 for what landed and what was deliberately deferred.

---

## 1. TL;DR

The overlay is not a normal window. It is created **once, hidden**, at login, and it is **transparent, always-on-top,
focusable and absent from the taskbar**. Opening it after a boot is a completely different code path from opening it
during the day — and it is the path that has **no watchdog, no error reporting and no recovery**.

Today a single failing step can leave you with either:

* **no window at all** — startup aborts silently (`windows_subsystem = "windows"`, no console, no log), or
  `show_overlay()` returns before it ever calls `show()`; or
* **an invisible window** — a transparent, always-on-top window whose WebView2 never painted. It still accepts
  clicks, still takes focus, and cannot be dismissed because it has no taskbar button and no title bar.

Both look exactly like "the app didn't open". The desktop-wide freeze has three plausible contributors, all real in
this code:

1. **Compositor path.** Transparency on Windows is implemented by `DwmEnableBlurBehindWindow` with an empty blur
   region (tao 0.35, `window.rs:1283-1297`), i.e. the least robust rendering path in WebView2, combined with
   `backdrop-filter: blur(22px)` and an opacity/transform entry animation. After a cold boot or a GPU device reset this
   is the composition that can stall DWM — when DWM stalls, *everything* stops repainting.
2. **Mouse capture path.** The header uses `data-tauri-drag-region`, which calls `start_dragging()` and enters the
   **OS modal move loop** (`SendMessage(WM_NCLBUTTONDOWN, HTCAPTION)`), which captures the mouse for the whole
   desktop. A click on an invisible overlay during a hang can park the machine in that loop.
3. **UI thread path.** Every shortcut, tray event, second-instance launch and Tauri command runs on the **one main
   thread**, and synchronous commands there take a mutex that the clipboard thread holds while it encodes PNGs,
   writes files and scans the whole images directory. Windows then marks the window "Not Responding".

The fix order matters: **first make failures visible and survivable, then remove the compositor/mouse-capture risk,
then move the database off the UI thread.**

---

## 2. What I verified

### 2.1 The window is only ever created once, hidden

`src-tauri/tauri.conf.json:13-27` — `visible: false`, `decorations: false`, `transparent: true`,
`alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`.

`src-tauri/src/main.rs:81-86` — if launched by autostart (`--autostart`) the window is hidden; otherwise it is shown
from `.setup()`, i.e. **before the webview has loaded the page**.

There is no `on_window_event` handler, no recreate-on-demand, and `show_overlay()` fails permanently with
`"main window unavailable"` once the window is gone (`src-tauri/src/window.rs:10-12`).

### 2.2 Startup is all-or-nothing and silent

`src-tauri/src/main.rs:49-90` propagates an error (`?`) out of `setup()` for:

| step | line | can fail because |
|---|---|---|
| `app_data_dir()` / `create_dir_all` | 50-54 | profile/permissions/disk |
| `Storage::open` | 58 | locked or corrupt DB, WAL recovery, media-dir prune |
| `cleanup::prune` | 60 | locked image file (`storage.rs:648`), read-only media dir |
| `sync_launch_on_login` | 61 | registry write blocked (policy, AV, moved exe) |
| `global_shortcut().register(Alt+V)` | 68-70 | another app owns Alt+V, or the previous instance still holds it |
| `tray::create_tray` | 79 | shell not ready yet at logon, Explorer restart |

`main.rs:102-103` is `.run(...).expect("failed to run ClipStack")` and the binary is built with
`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` (`main.rs:1`), so a failure here produces
**no window, no dialog, no console output, no log**. The same is true for `eprintln!` in `main.rs:31`, `tray.rs:42,75` —
they go nowhere in a release build.

### 2.3 The show sequence can abort before the window is ever shown

`src-tauri/src/window.rs:9-32`:

```rust
window.unminimize()?;                  // error => return, window stays hidden
if let Some(p) = LAST_WINDOW_POSITION { window.set_position(...)?; } else { window.center()?; }
window.show()?;
window.set_focus()?;
app.emit(OVERLAY_FOCUS_EVENT, true)?;
```

Every caller discards the error: `main.rs:31` (`eprintln!`), `main.rs:40` (`let _ =`), `tray.rs:42`
(`eprintln!`), `tray.rs:75`. So "press Alt+V, nothing happens" is a supported outcome of the current code.

Position is only cached in memory (`window.rs:6-7`), so a fresh process always centres — the "remembers position"
feature from the README does not survive a restart.

### 2.4 Everything runs on the main thread, over a shared mutex

* Tauri v2 runs **synchronous** commands on the main/UI thread. All of `commands.rs` are synchronous.
* The global-shortcut handler runs on the main thread (global-hotkey dispatches `WM_HOTKEY` from the thread that owns
  its hidden window, which the plugin pins to the main thread: `tauri-plugin-global-shortcut-2.3.1/src/lib.rs:75-86,416-425`).
* The tray menu callback runs on the main thread.
* The second-instance callback runs on the thread that owns the single-instance message window, created in plugin
  `setup` on the main thread (`tauri-plugin-single-instance-2.4.2/src/platform_impl/windows.rs:131-167`), and the
  second process **blocks in `SendMessageW`** (`windows.rs:91`) until that callback returns.

Meanwhile the clipboard thread holds `state.storage` (`Mutex<Storage>`) across expensive work:

`src-tauri/src/clipboard_monitor.rs:52-99` → lock → `load_settings()` → `insert_*_entry()` (PNG encode + `fs::write`)
→ `cleanup::prune()` → `storage.rs:432-477` (DELETE + `COUNT(DISTINCT entry_key)` + transaction commit)
→ `prune_media_directory()` → `storage.rs:621-653` (`fs::read_dir` of the whole images folder + `fs::remove_file`
per orphan, **`?` on every delete**, line 648).

While that runs, any `get_history` / `get_settings` / `toggle_pin` / `delete_item` on the main thread blocks on the
mutex. On a cold boot (cold file cache, Defender scanning, OneDrive) this is seconds, not milliseconds.

### 2.5 The clipboard poll does full work on every tick

`clipboard_monitor.rs:29-47,112` — every **225 ms**, forever:

* `get_text()` allocates and then `.trim().to_string()` allocates again — a 20 MB text on the clipboard is copied
  4×/second;
* when the clipboard holds an image, `get_image()` **materialises the entire RGBA bitmap** just to build a
  `wxh:len` signature. A 4K screenshot is 33 MB allocated and freed 4.4×/second, for as long as the image sits on the
  clipboard.

There is no `GetClipboardSequenceNumber` check and no `WM_CLIPBOARDUPDATE` listener.

### 2.6 Settings are overwritten with defaults on every launch

`src-tauri/src/storage.rs:118-119`:

```rust
let defaults = AppSettings::default();
self.save_settings(&defaults)?;   // INSERT .. ON CONFLICT DO UPDATE
```

`save_settings` upserts every key (`storage.rs:160-218`), so **every start resets** `history_limit`,
`retention_days`, `capture_enabled`, `launch_on_login`, `paste_on_select`, `hide_after_copy`, `show_on_launch`.
`main.rs:59` then reads those defaults. Consequences: autostart is re-enabled on every launch, `show_on_launch` is
always true, and any setting the user turned off comes back after a restart.

### 2.7 What the affected machine shows (checked here)

* No ClipStack in `%APPDATA%`/`%LOCALAPPDATA%` (no `com.clipstack.desktop`, no `clipstack.db`), no uninstall entry,
  no running process, no `Application Hang` / `Application Error` event for `clipstack.exe`. Only the installers in
  `D:\Downloads` (0.1.0, 1.1.0, 1.2.0) and `src-tauri\target\release\clipstack.exe` (built 09-06-2026).
* Windows 11 build **26300**, WebView2 **156.0.4314.58**, fast startup (`HiberbootEnabled=1`) **on**.

So the freeze was not reproduced here, and there is no crash/hang record to read. That is itself part of the bug:
**the app produces no evidence when it fails.** Phase 0 below fixes that.

---

## 3. Why "after a few days" is the trigger

Nothing in the code is time-based. What actually changes after a boot or a long sleep:

| change | effect on this app |
|---|---|
| process restarted | `show_overlay()` runs against a window that has **never been shown**; WebView2 has to create its composition surface on first show |
| GPU device reset / driver update / WebView2 update | the cold composition path is exactly where transparent + blur-behind windows are fragile |
| cold file cache, Defender/OneDrive startup I/O | the startup `Storage::open` + prune + media scan are 10-100× slower, and they run on the main thread |
| autostart fires at logon | the app starts while Explorer/WebView2 are still initialising, so tray/shortcut/registry steps are more likely to fail |
| machine slept instead of shut down | GPU/DWM state is lost but the window handle is not, so the first show is a "resume after device loss" |

"Continuous use is fine" is consistent with all of this: during the day the window has been shown, the composition is
warm, the caches are hot, and no step of the show path is being exercised for the first time.

---

## 4. Root causes, ranked

| id | cause | confidence | explains |
|---|---|---|---|
| **R1** | Transparent, always-on-top, taskbar-less WebView2 window: cold-show composition through DWM blur-behind, plus `backdrop-filter` and an entry animation. If composition stalls, DWM stalls and the desktop stops painting. | high (mechanism) / medium (that it is *your* exact trigger) | whole-desktop freeze |
| **R2** | No fail-safe: any startup/show error exits or hides silently; no log; `show()` is skipped when an earlier step errors. | **certain** (code) | "the window doesn't appear" |
| **R3** | One main thread for shortcut/tray/IPC, and synchronous commands take a mutex held across PNG encoding, file writes and a full media-dir scan. | **certain** (code) | "Not Responding", multi-second stalls, tray/shortcut dead |
| **R4** | `data-tauri-drag-region` puts the app into the OS modal move loop, which captures the mouse globally. Entered while the app is wedged, clicks stop reaching every other app. | medium | "can't click anywhere" |
| **R5** | Clipboard poll every 225 ms does full image decode + big-text copies; no sequence-number check. | certain (cost) / medium (impact) | CPU/RAM pressure, slower UI on cold boot |
| **R6** | The single-instance handshake uses `SendMessageW`; the newly launched process hangs behind a wedged first instance. | certain (code) | "I click it in the Start menu and nothing happens" |

R2 + R6 alone reproduce "I try to open it and nothing happens, then I click around and everything is stuck":
the first instance is wedged → the second process blocks in `SendMessageW` → the invisible always-on-top window
swallows clicks in its rectangle → the user concludes the laptop is frozen.

---

## 5. The fix plan

### Phase 0 — Make it observable (½ day, do first, ship alone if needed)

Nothing can be proven about an intermittent hang without a log. All of this is additive and low risk.

1. **File logging.** Add `log` + `tauri-plugin-log` (or `simplelog`), rotate at 5 MB, keep 5 files, write to
   `%APPDATA%\com.clipstack.desktop\logs\clipstack.log`. Default `INFO`, `--verbose` for `DEBUG`.
2. **Startup trace.** One `info!` line per step of `main.rs:49-90` with `Instant::elapsed()` — this immediately shows
   whether startup or the show path is the blocking part.
3. **Show/hide trace.** In `window.rs`, log `caller` (shortcut / tray / second-instance / command), `thread::current().id()`,
   and the duration of each of `unminimize / set_position / center / show / set_focus / emit`.
4. **Command timing.** Log any command that takes > 50 ms, and log mutex wait time separately from work time.
5. **Panic hook.** `std::panic::set_hook` → log + `%APPDATA%\...\logs\last-crash.txt`. Today a panic in `setup` is silent.
6. **Power / display events.** Handle `WM_POWERBROADCAST` (resume), `WM_DISPLAYCHANGE`, `WM_DPICHANGED`; log them.
   Log WebView2 renderer/GPU process exit if reachable.
7. **Safe mode.** `clipstack.exe --safe-mode` → opaque window, no `backdrop-filter`, no animation, no GPU
   (`--disable-gpu --disable-gpu-compositing`), no autostart writes, no paste automation. This is the switch the user
   (and support) can flip to get out of a bad state and to bisect the compositor hypothesis.
8. **Environment dump.** `--diagnose` writes OS build, WebView2 version, GPU/driver, monitor layout, DPI, DWM state,
   and the last 200 log lines to a file the user can send.

**Acceptance:** after a fresh boot and one normal session, the log alone tells us the timeline of the freeze.

### Phase 1 — Never fail silently, never show an unpainted always-on-top window (1 day)

1. **Startup never aborts.** Convert `setup` to collect errors. Rules:
   * DB open fails → show a small native error window with the log path, do **not** exit silently;
   * prune/media-dir failure → log and continue (`prune_media_directory` must not `?` on a single undeletable file;
     log it and move on, `storage.rs:644-650`);
   * autostart, global shortcut, tray → log a warning, keep running, and expose the state in the tray menu
     ("Shortcut unavailable: Alt+V is taken").
2. **`show_overlay` is total.** One closure on the main thread via `app.run_on_main_thread`; `show()` is attempted
   **before** any positioning that can fail; each step is logged, not propagated; if the window is missing, recreate it
   from a stored `WebviewWindowBuilder` instead of returning `"main window unavailable"`.
3. **Renderer-ready handshake.** Frontend calls `overlay_ready` on mount. A show request stores
   `pending_show = Instant`; the window is shown when ready, or after a 1 500 ms timeout the webview is recreated once;
   if it is still not ready, the window is shown **with `set_ignore_cursor_events(true)`** and a native "renderer
   unavailable — press Ctrl+Alt+Shift+Q to restart" banner. Failing closed, never failing "visible and dead".
4. **Never destroy the window.** Add `on_window_event(CloseRequested → hide + prevent_close)`. Add "Restart ClipStack"
   to the tray.
5. **Watchdog.** Frontend pings every 500 ms; a supervisor thread records the last ping. If the window is visible and
   no ping arrives for 8 s → log a `HANG` record with the recent event ring buffer, then
   `Command::new(current_exe).spawn()` + `process::exit(0)` from the **supervisor thread** (the main thread may be the
   wedged one).
6. **Escape hatch.** A dedicated thread with its own message loop registers `Ctrl+Alt+Shift+Q`; on press it calls
   `process::exit(0)` without touching the main thread. This is what the user needs the next time it happens, and it
   doubles as a diagnostic ("if this unfreezes the desktop, the freeze is our window, not Windows").

**Acceptance:** a deliberately broken startup (rename the DB, lock an image, occupy Alt+V) produces a visible,
explainable result and a log line — never a silent nothing.

### Phase 2 — Remove the desktop-freeze risk (1-2 days)

1. **Default to an opaque overlay.** `transparent: false`, `decorations: false`, `shadow: true`, rounded corners via
   `DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)` (Windows 11; square on Windows 10, which is
   fine), solid card background. This needs the `Win32_Graphics_Dwm` feature on the existing `windows-sys` dependency.
   Drop `backdrop-filter: blur(22px)` (`src/styles/theme.css:81`) and the `overlay-card-enter` opacity/transform
   animation (`theme.css:87-98`), or keep them only behind the `--blur` opt-in.
2. **If translucency is required**, make it a setting, default **off**, and when on:
   `additional_browser_args("--disable-gpu --disable-gpu-compositing --disable-features=CalculateNativeWinOcclusion")`,
   no backdrop filter, no animation. Tauri 2.11 supports `WebviewWindowBuilder::additional_browser_args`
   (`webview_window.rs:1015`).
3. **Remove `data-tauri-drag-region`** (`src/components/OverlayShell.tsx:47-49`). The OS modal move loop is the only
   code path in the app that can capture the mouse for the whole desktop. If draggable position is a must-have,
   implement it in JS: `pointerdown` → IPC `drag_start`, `pointermove` → `set_position`, `pointerup` → persist. That
   keeps the window fixed-size and never enters a nested OS loop.
4. **Focus discipline.** `focusable(false)` while hidden; on show, `show()` → `set_focus()` → if the foreground window
   is not ours, `FlashWindowEx` fallback and log it. Never call `set_focus()` from a non-main thread.

**Acceptance:** with the overlay hidden, killing the WebView2 GPU process and then showing it does not stall DWM;
clicking the overlay's area while it is unresponsive never captures the mouse.

### Phase 3 — Get the database and clipboard work off the UI thread (2-3 days)

1. **DB actor.** One dedicated thread owns `Storage`; callers send requests over `std::sync::mpsc` (or `tokio` +
   `spawn_blocking`) and await a reply. No `Mutex<Storage>` reachable from a command. Commands become `async fn`.
   Writes are coalesced (e.g. 250 ms debounce) so a burst of copies is one transaction.
2. **Prune policy.** Startup + every 5 minutes + after N inserts — never on every insert, never inside
   `update_settings`. `prune_media_directory` diffs a cached referenced-set instead of reading the directory each time.
3. **Clipboard capture.** Replace polling with `AddClipboardFormatListener` + `WM_CLIPBOARDUPDATE` on a dedicated
   message-loop thread; fall back to 750 ms polling of `GetClipboardSequenceNumber()` when the listener is unavailable.
   Only decode an image when the sequence number changed. Cap stored image dimensions/bytes.
4. **Settings.** Insert defaults only for keys that are missing (`INSERT OR IGNORE`), never `ON CONFLICT DO UPDATE` at
   startup (`storage.rs:118-119`). Save on blur/debounce, not on every keystroke; do not prune from `update_settings`.
5. **Paste automation.** Only send `Ctrl+V` if the overlay has actually lost focus and the foreground window is the one
   that was active before the show; refuse if `GetAsyncKeyState` shows Alt/Ctrl still held. Decode PNGs for
   `copy_item` off the UI thread (`commands.rs:57-72` currently decodes a full PNG on the main thread).

**Acceptance:** 24 h soak with the overlay toggled every 30 s → no UI-thread stall > 100 ms, idle CPU < 0.3 %,
flat RSS/handles/threads.

### Phase 4 — Prove it (1 day + 1 week of real use)

Reproduction matrix on a test machine:

| test | procedure | pass |
|---|---|---|
| cold show ×100 | start hidden, sleep 60 s, launch a second instance to show; repeat | 0 failures, time-to-paint p95 < 150 ms |
| resume | sleep the machine 30 min, wake, show | no DWM stall, log shows the resume event |
| GPU loss | kill the WebView2 `--type=gpu-process` while hidden, then show | window paints or recreates itself; no desktop stall |
| wedged renderer | suspend the renderer process (`pssuspend`), then show | cursor-events fallback + watchdog restart, machine stays usable |
| broken startup | delete/lock the DB, hold Alt+V in another app | visible error, log line, no silent exit |
| settings | change every setting, restart, re-read | values persist |

Then one week on the user's machine with logging on, then a release (`1.2.2`) with the log path documented in the
tray menu.

---

## 6. Other defects found (not the freeze, fix in the same pass)

1. **Settings reset on every launch** — `storage.rs:118-119` writes defaults over the stored values. Certain.
2. **Typing in "History limit" can delete history** — the number input calls `update_settings` per keystroke
   (`OverlayShell.tsx:80-92`), which runs `save_settings` + `cleanup::prune` (`commands.rs:124-128`); typing `500` via
   `5` → 50 → 500 prunes down to 50 in between. Certain data-loss bug.
3. **Autostart cannot be turned off** — consequence of (1): `sync_launch_on_login` re-enables it every boot.
4. **`retention_days` never expires re-copied items** — `upsert_entry` sets `created_at = now` on every duplicate
   (`storage.rs:513`), so a frequently copied item never ages out.
5. **PNG decode on the UI thread** for image paste (`commands.rs:62`).
6. **CSV export breaks on multi-line content** — `to_csv` doubles quotes but never quotes newlines (`commands.rs:210-246`).
7. **Export writes silently into Documents** with no save dialog (`commands.rs:172-176`).
8. **`show_on_launch` is effectively always true**, so every manual launch pops the overlay even if the user turned it off.
9. **No window lifecycle guard** — no `CloseRequested` handler: Alt+F4 quits the app with no confirmation, and any path
   that destroys the main window leaves `show_overlay()` permanently returning `"main window unavailable"` (`window.rs:10-12`).
10. **Watch item in a dependency** — `global-hotkey 0.7.0` spawns a busy-wait thread on every hotkey press that polls
    `GetAsyncKeyState` with no sleep until the key is released (`src/platform_impl/windows/mod.rs:157-168`). One core
    per held key press. The app only uses `ShortcutState::Pressed` (`main.rs:39`), so the `Released` event it also
    receives is unused. Not the freeze, but it makes every Alt+V press cost a full core while the key is down.

---

## 7. What I need to confirm the trigger

1. When it is frozen, **does the mouse pointer still move?** Does `Ctrl+Alt+Del` / `Ctrl+Shift+Esc` still work?
   (pointer moves + shortcuts work ⇒ compositor/input hang, R1/R4; nothing works ⇒ DWM, R1)
2. Is the PC **powered off**, or does it **sleep / lid closed**? (fast startup is on, and sleep is the classic GPU-reset trigger)
3. Which build runs on that machine — the 1.2.0 installer, `target\release\clipstack.exe`, or `npm run tauri dev`?
   This machine has no installed copy and no app data at all.
4. During the freeze, is `clipstack.exe` in Task Manager, and what is its CPU/RAM? Is `msedgewebview2.exe` also stuck?
5. Laptop model, GPU, and whether an external monitor / docking station is involved.

---

## 8. Suggested sequencing

| step | effort | risk | value |
|---|---|---|---|
| Phase 0 logging + safe mode | ½ day | none | turns a mystery into a timeline |
| Phase 1 fail-safe show/watchdog/escape hatch | 1 day | low | users stop losing the desktop |
| Phase 2 opaque overlay, no drag region | 1-2 days | low-medium (visual change) | removes the actual freeze |
| Phase 3 DB actor + clipboard events | 2-3 days | medium | removes stalls and cold-boot load |
| Phase 4 repro matrix + soak + release | 1 day + 1 week | low | proves it |

Ship Phase 0 + 1 as `1.2.2` first: even if the compositor theory is wrong, the next occurrence will finally produce
the evidence needed, and the escape hatch means the user is never stuck again.

---

## 9. What shipped in v1.2.2

### Reliability

- **Logging** (`src-tauri/src/logging.rs`): rotating file log at `%APPDATA%\com.clipstack.desktop\logs\clipstack.log`,
  panic hook writing `last-crash.txt`, `--verbose` for debug lines. Every startup step is timed and logged.
- **Startup can no longer fail silently** (`main.rs`): only a database failure is fatal, and that now shows a native
  message box plus `last-error.txt`. Autostart sync, shortcut registration, tray creation and cleanup failures are
  logged and skipped.
- **Renderer-ready handshake**: the window stays hidden until React mounts and calls `overlay_ready`; a show request is
  queued and force-shown after 3 s at worst. A dead renderer can no longer be presented as an invisible window.
- **`show_overlay` is total**: only `window.show()` can fail the call; positioning and focus are best-effort and logged.
- **Position persistence**: last position is written to `window-position.json` and clamped to a connected monitor.
- **Window lifecycle**: `CloseRequested` hides instead of destroying; the tray and settings panel gained
  *Restart ClipStack* and *Open log folder*.
- **UI watchdog** (`runtime.rs`): the renderer sends a heartbeat (driven by `requestAnimationFrame`, so it stops when
  the renderer is wedged); after 8 s the supervisor restarts the process, guarded against restart loops and tolerant of
  sleep/resume clock jumps.
- **Emergency quit**: `Ctrl+Alt+Shift+Q` runs on its own thread and exits without touching the UI thread.

### The freeze itself

- The window is **opaque** (`transparent: false`, `backgroundColor: #17191d`), `backdrop-filter` is gone, the drop
  shadow is gone, and Windows 11 rounds the window through DWM (`DwmSetWindowAttribute`, best effort).

### Performance

- All commands are `async` and every database call runs on the blocking pool, so the UI thread never waits on the
  storage mutex, PNG encoding, file writes or the media-directory scan.
- Clipboard capture uses `GetClipboardSequenceNumber`, so an unchanged clipboard costs one Win32 call instead of a full
  image decode; images above 40 MP are ignored; cleanup runs at most every 5 s instead of on every copy.
- Clipboard writes and PNG decoding happen off the UI thread.

### Correctness

- Settings are no longer reset to defaults on every launch (`INSERT OR IGNORE`), with a regression test.
- Numeric settings commit on blur/Enter, so typing a new history limit can no longer prune history to the digits typed
  so far.
- Paste automation refuses to inject `Ctrl+V` while a modifier is physically held.

### UX

- The search box is focused on every show (`overlay-focus` event was emitted but never handled).
- `Escape` closes the settings panel before the overlay.
- Safe-mode is surfaced as a header pill; the settings panel shows the version and exposes the diagnostics actions.
- "Open logs" / "Restart app" buttons, log path documented in the README.

### Verification performed

- `cargo test`: 8/8 (including the new settings-persistence regression test).
- `tsc && vite build`: clean.
- Live smoke test on the debug build: hidden start → `renderer reported ready` → second-instance show in 19 ms →
  window visible, responding to `WM_NULL`, correct 400×560 logical / 500×700 physical size at 125 % DPI, screenshot
  verified.

### Deliberately deferred

- **Removing `data-tauri-drag-region`**: the modal move loop is only dangerous when the app is already wedged *and* the
  window is invisible. Both preconditions are now gone (opaque window, watchdog, no UI-thread blocking), and removing it
  would drop drag-to-move. Revisit if a hang is ever observed mid-drag.
- **Full database actor thread**: the async + blocking-pool split removes the UI-thread stalls that mattered; a single
  writer thread is still the cleaner end state.
- **Clipboard change events** (`WM_CLIPBOARDUPDATE`): the sequence-number check removes the cost; the event listener
  would remove the 250 ms latency, not the load.
- **Automated reproduction matrix** (sleep/resume, GPU-process kill): needs a dedicated test machine, scripted in §5.

