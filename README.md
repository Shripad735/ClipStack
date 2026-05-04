# ClipStack

ClipStack is a fast, local-first clipboard manager for Windows built with Tauri + React.
It gives you searchable clipboard history, pinning, cleanup controls, and quick paste workflows from a lightweight overlay UI.

## Features

- Global shortcut overlay (`Ctrl` + `Shift` + `V`)
- Clipboard history capture with local SQLite storage
- Instant search across copied text
- Pin / unpin important items
- Delete entries and clear unpinned history
- Optional launch on Windows login
- Optional paste-on-select into the active app
- Compact, minimal overlay UI for quick use

## Tech Stack

- Tauri 2 (Rust backend + desktop shell)
- React 19 + TypeScript + Vite
- SQLite via `rusqlite`

## Project Structure

- `src/` - React frontend (overlay UI, keyboard navigation, settings panel)
- `src-tauri/src/` - Rust backend (clipboard monitor, storage, commands, tray/window behavior)
- `src-tauri/tauri.conf.json` - Tauri app/window/bundle configuration

## Prerequisites

- Node.js 18+ (recommended: latest LTS)
- Rust stable toolchain
- Windows 10/11
- Microsoft WebView2 runtime

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run tauri dev
```

## Build

Build frontend only:

```bash
npm run build
```

Build desktop installer/executable:

```bash
npm run tauri build
```

Generated installer output (default):

- `src-tauri/target/release/bundle/nsis/ClipStack_0.1.0_x64-setup.exe`

## Keyboard Shortcuts

- `Ctrl + Shift + V` - Toggle ClipStack overlay
- `Arrow Up / Arrow Down` - Navigate items
- `Enter` - Select item (copy/paste behavior follows settings)
- `Delete` - Delete selected item (when search box is empty)
- `Esc` - Close overlay

## Settings

Current in-app settings include:

- History limit
- Retention period (days)
- Clipboard capture on/off
- Launch on login
- Paste selected item into active app
- Close panel after selecting an item
- Open panel when app is launched manually

## Privacy

ClipStack is local-first:

- Clipboard history is stored on-device in app data (`clipstack.db`)
- No cloud sync or external clipboard upload by default

## Roadmap

- Rich content support (images/files)
- Better filtering and tags
- Export/import history
- Additional customization and shortcuts

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
