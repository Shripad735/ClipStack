import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import type { AppSettings, RuntimeInfo } from "../lib/tauri";
import { hideOverlay } from "../lib/tauri";

type OverlayShellProps = PropsWithChildren<{
  itemCount: number;
  isDesktop: boolean;
  isLoading: boolean;
  captureEnabled: boolean;
  isSettingsOpen: boolean;
  safeMode: boolean;
  runtimeInfo: RuntimeInfo | null;
  settings: AppSettings;
  onToggleSettings: () => void;
  onRefresh: () => void;
  onClearUnpinned: () => void;
  onExportHistory: (format: "json" | "csv") => void;
  onOpenLogs: () => void;
  onRestart: () => void;
  onSettingsChange: (settings: AppSettings) => void;
}>;

export function OverlayShell({
  children,
  itemCount,
  isDesktop,
  isLoading,
  captureEnabled,
  isSettingsOpen,
  safeMode,
  runtimeInfo,
  settings,
  onToggleSettings,
  onRefresh,
  onClearUnpinned,
  onExportHistory,
  onOpenLogs,
  onRestart,
  onSettingsChange,
}: OverlayShellProps) {
  // Numeric settings are edited in a local draft and only committed on blur or
  // Enter. Committing on every keystroke used to prune the history down to the
  // intermediate value while the user was still typing.
  const [historyLimitDraft, setHistoryLimitDraft] = useState(
    String(settings.historyLimit),
  );
  const [retentionDaysDraft, setRetentionDaysDraft] = useState(
    String(settings.retentionDays),
  );

  useEffect(() => {
    setHistoryLimitDraft(String(settings.historyLimit));
  }, [settings.historyLimit]);

  useEffect(() => {
    setRetentionDaysDraft(String(settings.retentionDays));
  }, [settings.retentionDays]);

  const commitHistoryLimit = () => {
    const parsed = Number.parseInt(historyLimitDraft, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(500, Math.max(25, parsed))
      : settings.historyLimit;

    setHistoryLimitDraft(String(next));
    if (next !== settings.historyLimit) {
      onSettingsChange({ ...settings, historyLimit: next });
    }
  };

  const commitRetentionDays = () => {
    const parsed = Number.parseInt(retentionDaysDraft, 10);
    const next = Number.isFinite(parsed)
      ? Math.min(365, Math.max(1, parsed))
      : settings.retentionDays;

    setRetentionDaysDraft(String(next));
    if (next !== settings.retentionDays) {
      onSettingsChange({ ...settings, retentionDays: next });
    }
  };

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
        <header className="overlay-header" data-tauri-drag-region>
          <div className="header-title-group" data-tauri-drag-region>
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
          <span>
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
          <span>{captureEnabled ? "Capture on" : "Capture paused"}</span>
          <span>{isDesktop ? "Desktop" : "Preview"}</span>
          {safeMode ? <span>Safe mode</span> : null}
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
                value={historyLimitDraft}
                onChange={(event) => setHistoryLimitDraft(event.target.value)}
                onBlur={commitHistoryLimit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label>
              Retention days
              <input
                type="number"
                min={1}
                max={365}
                value={retentionDaysDraft}
                onChange={(event) => setRetentionDaysDraft(event.target.value)}
                onBlur={commitRetentionDays}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
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

            <div className="settings-group">
              <h2>Diagnostics</h2>
              <p>
                ClipStack keeps a log of every show, start and error. Send it
                along if the overlay ever stops responding.
              </p>
            </div>
            <div className="settings-export-actions">
              <button className="ghost-button" type="button" onClick={onOpenLogs}>
                Open logs
              </button>
              <button className="ghost-button" type="button" onClick={onRestart}>
                Restart app
              </button>
            </div>
            {runtimeInfo ? (
              <p className="settings-hint">
                ClipStack v{runtimeInfo.version}
                {runtimeInfo.safeMode ? " · Safe mode" : ""}
              </p>
            ) : null}
          </section>
        ) : (
          children
        )}
      </section>
    </main>
  );
}
