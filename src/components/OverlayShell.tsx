import type { PropsWithChildren } from "react";
import type { AppSettings } from "../lib/tauri";
import { hideOverlay } from "../lib/tauri";

type OverlayShellProps = PropsWithChildren<{
  itemCount: number;
  isDesktop: boolean;
  isLoading: boolean;
  captureEnabled: boolean;
  isSettingsOpen: boolean;
  settings: AppSettings;
  onToggleSettings: () => void;
  onRefresh: () => void;
  onClearUnpinned: () => void;
  onExportHistory: (format: "json" | "csv") => void;
  onSettingsChange: (settings: AppSettings) => void;
}>;

export function OverlayShell({
  children,
  itemCount,
  isDesktop,
  isLoading,
  captureEnabled,
  isSettingsOpen,
  settings,
  onToggleSettings,
  onRefresh,
  onClearUnpinned,
  onExportHistory,
  onSettingsChange,
}: OverlayShellProps) {
  return (
    <main className="overlay-root">
      <section
        className="overlay-card"
        aria-label="ClipStack clipboard manager"
      >
        <button
          type="button"
          className="overlay-close-button"
          aria-label="Close ClipStack"
          onClick={() => void hideOverlay()}
        >
          ×
        </button>
        <header className="overlay-header">
          <div className="header-title-group" data-tauri-drag-region>
            <p className="eyebrow" data-tauri-drag-region>
              Clipboard
            </p>
            <h1 data-tauri-drag-region>ClipStack</h1>
          </div>
          <div className="header-actions">
            <button className="ghost-button" type="button" onClick={onRefresh}>
              Sync
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={onToggleSettings}
            >
              {isSettingsOpen ? "Back" : "Settings"}
            </button>
          </div>
        </header>

        <div className="header-meta">
          <span>{itemCount} items</span>
          <span>{captureEnabled ? "Capture on" : "Capture paused"}</span>
          <span>{isDesktop ? "Desktop" : "Preview"}</span>
          {isLoading ? <span>Loading...</span> : null}
        </div>

        {isSettingsOpen ? (
          <section className="settings-panel">
            <div className="settings-group">
              <h2>History</h2>
              <p>Control how much clipboard history ClipStack keeps locally.</p>
            </div>
            <label>
              History limit
              <input
                type="number"
                min={25}
                max={500}
                value={settings.historyLimit}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    historyLimit: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Retention days
              <input
                type="number"
                min={1}
                max={365}
                value={settings.retentionDays}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    retentionDays: Number(event.target.value),
                  })
                }
              />
            </label>

            <div className="settings-group">
              <h2>Behavior</h2>
              <p>Choose how the panel behaves when you pick an item.</p>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.captureEnabled}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    captureEnabled: event.target.checked,
                  })
                }
              />
              Capture clipboard updates
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.launchOnLogin}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    launchOnLogin: event.target.checked,
                  })
                }
              />
              Launch on Windows login
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.pasteOnSelect}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    pasteOnSelect: event.target.checked,
                  })
                }
              />
              Paste selected item into the active app
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.hideAfterCopy}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    hideAfterCopy: event.target.checked,
                  })
                }
              />
              Close panel after selecting an item
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.showOnLaunch}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    showOnLaunch: event.target.checked,
                  })
                }
              />
              Open panel when the app is launched manually
            </label>

            <div className="settings-group">
              <h2>Maintenance</h2>
              <p>Clean temporary history while keeping pinned items safe.</p>
            </div>
            <button
              className="danger-button"
              type="button"
              onClick={onClearUnpinned}
            >
              Clear unpinned history
            </button>
            <div className="settings-export-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => onExportHistory("json")}
              >
                Export JSON
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => onExportHistory("csv")}
              >
                Export CSV
              </button>
            </div>
          </section>
        ) : (
          children
        )}
      </section>
    </main>
  );
}
