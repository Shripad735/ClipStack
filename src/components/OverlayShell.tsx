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

type SwitchRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

function SwitchRow({ title, description, checked, onChange }: SwitchRowProps) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-title">{title}</span>
        {description ? (
          <span className="switch-desc">{description}</span>
        ) : null}
      </span>
      <span className="switch">
        <input
          type="checkbox"
          className="switch-input"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch-track" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
}

type SliderRowProps = {
  title: string;
  description: string;
  value: string;
  min: number;
  max: number;
  onDraft: (next: string) => void;
  onCommit: () => void;
};

function SliderRow({
  title,
  description,
  value,
  min,
  max,
  onDraft,
  onCommit,
}: SliderRowProps) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="slider-text">
          <span className="slider-title">{title}</span>
          <span className="slider-desc">{description}</span>
        </span>
        <span className="slider-value" aria-live="polite">
          {value}
        </span>
      </div>
      <input
        type="range"
        className="slider-input"
        min={min}
        max={max}
        value={Number.parseInt(value, 10) || min}
        aria-label={title}
        onChange={(event) => onDraft(event.target.value)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <div className="slider-scale" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

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
            <span
              className="header-count"
              title={`${itemCount} ${itemCount === 1 ? "item" : "items"} stored locally`}
            >
              {itemCount}
            </span>
            <span
              className={`capture-dot${captureEnabled ? " capture-dot-on" : " capture-dot-off"}`}
              title={captureEnabled ? "Clipboard capture is on" : "Clipboard capture is paused"}
              aria-label={captureEnabled ? "Capture on" : "Capture paused"}
              role="status"
            />
          </div>
          <div className="header-actions">
            <button
              className="ghost-button header-icon-button"
              type="button"
              onClick={onRefresh}
              title="Reload history from the database"
              aria-label="Reload history"
            >
              <span aria-hidden="true" className="header-icon">⟳</span>
              <span className="header-action-label">Sync</span>
            </button>
            <button
              className="ghost-button header-icon-button"
              type="button"
              onClick={onToggleSettings}
              title={isSettingsOpen ? "Back to history" : "Open settings"}
              aria-label={isSettingsOpen ? "Back to history" : "Open settings"}
            >
              <span aria-hidden="true" className="header-icon">⚙</span>
              <span className="header-action-label">
                {isSettingsOpen ? "Back" : "Settings"}
              </span>
            </button>
          </div>
        </header>

        <div className="header-status" aria-live="polite">
          <span className="header-status-text">
            {captureEnabled ? "Capture on" : "Capture paused"}
            <span aria-hidden="true"> · </span>
            {isDesktop ? "Desktop" : "Preview"}
            {safeMode ? " · Safe mode" : null}
            {isLoading ? " · Loading…" : null}
          </span>
        </div>

        {isSettingsOpen ? (
          <section className="settings-panel" aria-label="ClipStack settings">
            <section className="settings-card" aria-labelledby="settings-storage-title">
              <div className="settings-card-head">
                <h2 id="settings-storage-title">Storage</h2>
                <p>Control how much clipboard history ClipStack keeps locally.</p>
              </div>
              <SliderRow
                title="History limit"
                description="Maximum grouped entries kept on disk"
                value={historyLimitDraft}
                min={25}
                max={500}
                onDraft={setHistoryLimitDraft}
                onCommit={commitHistoryLimit}
              />
              <SliderRow
                title="Retention"
                description="Days unpinned entries are kept"
                value={retentionDaysDraft}
                min={1}
                max={365}
                onDraft={setRetentionDaysDraft}
                onCommit={commitRetentionDays}
              />
            </section>

            <section className="settings-card" aria-labelledby="settings-behavior-title">
              <div className="settings-card-head">
                <h2 id="settings-behavior-title">Behavior</h2>
                <p>Choose how the panel behaves when you pick an item.</p>
              </div>
              <SwitchRow
                title="Capture clipboard updates"
                description="Watch Windows clipboard and store new entries"
                checked={settings.captureEnabled}
                onChange={(next) =>
                  onSettingsChange({ ...settings, captureEnabled: next })
                }
              />
              <SwitchRow
                title="Launch on Windows login"
                description="Start ClipStack in the background at boot"
                checked={settings.launchOnLogin}
                onChange={(next) =>
                  onSettingsChange({ ...settings, launchOnLogin: next })
                }
              />
              <SwitchRow
                title="Paste into the active app"
                description="Send Ctrl+V right after copying a selection"
                checked={settings.pasteOnSelect}
                onChange={(next) =>
                  onSettingsChange({ ...settings, pasteOnSelect: next })
                }
              />
              <SwitchRow
                title="Close panel after copy"
                description="Hide the overlay once an item is picked"
                checked={settings.hideAfterCopy}
                onChange={(next) =>
                  onSettingsChange({ ...settings, hideAfterCopy: next })
                }
              />
              <SwitchRow
                title="Open on manual launch"
                description="Show the panel when the app starts directly"
                checked={settings.showOnLaunch}
                onChange={(next) =>
                  onSettingsChange({ ...settings, showOnLaunch: next })
                }
              />
            </section>

            <section className="settings-card" aria-labelledby="settings-maintenance-title">
              <div className="settings-card-head">
                <h2 id="settings-maintenance-title">Maintenance</h2>
                <p>Clean temporary history while keeping pinned items safe.</p>
              </div>
              <button
                className="danger-button settings-wide-button"
                type="button"
                onClick={onClearUnpinned}
              >
                Clear unpinned history
              </button>
              <div className="settings-export-actions">
                <button
                  className="ghost-button settings-split-button"
                  type="button"
                  onClick={() => onExportHistory("json")}
                >
                  Export JSON
                </button>
                <button
                  className="ghost-button settings-split-button"
                  type="button"
                  onClick={() => onExportHistory("csv")}
                >
                  Export CSV
                </button>
              </div>
            </section>

            <section className="settings-card" aria-labelledby="settings-diagnostics-title">
              <div className="settings-card-head">
                <h2 id="settings-diagnostics-title">Diagnostics</h2>
                <p>
                  ClipStack keeps a log of every show, start and error. Send
                  it along if the overlay ever stops responding.
                </p>
              </div>
              <div className="settings-export-actions">
                <button className="ghost-button settings-split-button" type="button" onClick={onOpenLogs}>
                  Open logs
                </button>
                <button className="ghost-button settings-split-button" type="button" onClick={onRestart}>
                  Restart app
                </button>
              </div>
            </section>
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
