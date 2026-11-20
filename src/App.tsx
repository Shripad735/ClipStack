import Fuse from "fuse.js";
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { HistoryList } from "./components/HistoryList";
import { OverlayShell } from "./components/OverlayShell";
import { SearchInput } from "./components/SearchInput";
import { SnippetsPanel } from "./components/SnippetsPanel";
import { useClipboardHistory } from "./hooks/useClipboardHistory";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import {
  desktopListen,
  fetchRuntimeInfo,
  hideOverlay,
  markOverlayReady,
  openLogsFolder,
  restartApplication,
  sendHeartbeat,
  type RuntimeInfo,
} from "./lib/tauri";

function readSnippetCount() {
  try {
    const raw = localStorage.getItem("clipstack.snippets.v1");
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function App() {
  const {
    history,
    settings,
    isDesktop,
    isLoading,
    error,
    refresh,
    copyItem,
    deleteItem,
    togglePin,
    clearUnpinned,
    updateSettings,
    exportHistory,
  } = useClipboardHistory();
  const [query, setQuery] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showShortcutHintBar, setShowShortcutHintBar] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"history" | "snippets">("history");
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [snippetCount, setSnippetCount] = useState(() => readSnippetCount());
  const inputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(""), 2500);
  };

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const fuse = useMemo(
    () =>
      new Fuse(history, {
        includeScore: true,
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 2,
        keys: [{ name: "content", weight: 1 }],
      }),
    [history],
  );
  const filteredHistory = useMemo(() => {
    if (!normalizedQuery) {
      return history;
    }

    const exactMatches = history.filter((item) =>
      item.content.toLowerCase().includes(normalizedQuery),
    );
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    return fuse.search(normalizedQuery).map((match) => match.item);
  }, [fuse, history, normalizedQuery]);

  const handleSelect = useEffectEvent(async (id: number) => {
    await copyItem(id);
    setExpandedId(null);
    setQuery("");
  });

  const handleDelete = useEffectEvent(async (id: number) => {
    await deleteItem(id);
  });

  const handlePin = useEffectEvent(async (id: number) => {
    await togglePin(id);
  });

  const handleToggleExpand = useEffectEvent((id: number) => {
    setExpandedId((current) => (current === id ? null : id));
  });

  const handleCollapseExpanded = useEffectEvent(() => {
    setExpandedId(null);
  });

  const handleExport = useEffectEvent(async (format: "json" | "csv") => {
    try {
      const outputPath = await exportHistory(format);
      showToast(`Exported ${format.toUpperCase()} to ${outputPath}`);
    } catch (exportError) {
      showToast(
        exportError instanceof Error
          ? exportError.message
          : "Unable to export history.",
      );
    }
  });

  const { selectedIndex, setSelectedIndex, onKeyDown, onWindowKeyDown } =
    useKeyboardNavigation({
      itemCount: filteredHistory.length,
      searchValue: query,
      onEnter: (index) => {
        const item = filteredHistory[index];
        if (item) {
          void handleSelect(item.id);
        }
      },
      onDelete: (index) => {
        const item = filteredHistory[index];
        if (item) {
          void handleDelete(item.id);
        }
      },
      onPin: (index) => {
        const item = filteredHistory[index];
        if (item) {
          void handlePin(item.id);
        }
      },
      onSpace: (index) => {
        const item = filteredHistory[index];
        if (item) {
          handleToggleExpand(item.id);
        }
      },
      onEscape: () => {
        if (expandedId !== null) {
          handleCollapseExpanded();
          return;
        }
        void hideOverlay();
      },
    });

  useEffect(() => {
    setSelectedIndex(0);
  }, [normalizedQuery, setSelectedIndex]);

  // Keep the Snippets tab badge in sync with the panel's localStorage store.
  useEffect(() => {
    const refreshSnippetCount = () => setSnippetCount(readSnippetCount());
    refreshSnippetCount();
    window.addEventListener("clipstack-snippets-changed", refreshSnippetCount);
    window.addEventListener("storage", refreshSnippetCount);
    return () => {
      window.removeEventListener("clipstack-snippets-changed", refreshSnippetCount);
      window.removeEventListener("storage", refreshSnippetCount);
    };
  }, []);

  // Collapse the Quick-Look preview when its item is filtered out or removed.
  useEffect(() => {
    if (expandedId === null) {
      return;
    }
    const stillVisible = history.some((item) => item.id === expandedId);
    if (!stillVisible) {
      setExpandedId(null);
    }
  }, [history, expandedId]);

  useEffect(() => {
    const hideTimer = window.setTimeout(() => {
      setShowShortcutHintBar(false);
    }, 4500);
    return () => window.clearTimeout(hideTimer);
  }, []);

  // The overlay window stays hidden until the renderer reports its first paint,
  // so a broken WebView2 can never present an invisible always-on-top window.
  // `requestAnimationFrame` does not run while the window is hidden, so the
  // mount itself is the readiness signal.
  useEffect(() => {
    let cancelled = false;

    void markOverlayReady();

    void fetchRuntimeInfo()
      .then((info) => {
        if (!cancelled) {
          setRuntimeInfo(info);
        }
      })
      .catch(() => undefined);

    inputRef.current?.focus();

    return () => {
      cancelled = true;
    };
  }, []);

  // Renderer heartbeat. requestAnimationFrame pauses while the window is hidden
  // and stops entirely if the renderer wedges, which is exactly the signal the
  // Rust watchdog needs.
  useEffect(() => {
    let frame = 0;
    let lastSent = 0;

    const tick = (time: number) => {
      if (time - lastSent >= 500) {
        lastSent = time;
        void sendHeartbeat();
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Re-focus the search box every time the overlay is shown.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    void desktopListen("overlay-focus", () => {
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 10);
    }).then((stop) => {
      unsubscribe = stop;
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      // Escape closes the settings panel before it closes the overlay itself.
      if (event.key === "Escape" && isSettingsOpen) {
        event.preventDefault();
        setIsSettingsOpen(false);
        return;
      }

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        setShowShortcutHintBar(true);
        return;
      }

      onWindowKeyDown(event);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [isSettingsOpen, onWindowKeyDown]);

  useEffect(() => {
    const hideOnBlur = () => {
      void hideOverlay();
    };

    window.addEventListener("blur", hideOnBlur);

    return () => {
      window.removeEventListener("blur", hideOnBlur);
    };
  }, []);

  const handleOpenLogs = () => {
    void openLogsFolder()
      .then(() => showToast("Opened the ClipStack log folder."))
      .catch((logsError) => {
        showToast(
          logsError instanceof Error
            ? logsError.message
            : "Unable to open the log folder.",
        );
      });
  };

  const handleRestart = () => {
    void restartApplication();
  };

  return (
    <OverlayShell
      isDesktop={isDesktop}
      isLoading={isLoading}
      itemCount={history.length}
      captureEnabled={settings.captureEnabled}
      isSettingsOpen={isSettingsOpen}
      safeMode={runtimeInfo?.safeMode ?? false}
      runtimeInfo={runtimeInfo}
      onClearUnpinned={() => void clearUnpinned()}
      onExportHistory={(format) => void handleExport(format)}
      onRefresh={() => void refresh()}
      onToggleSettings={() => setIsSettingsOpen((open) => !open)}
      onOpenLogs={handleOpenLogs}
      onRestart={handleRestart}
      settings={settings}
      onSettingsChange={(next) => void updateSettings(next)}
    >
      <div className="tab-strip tab-segmented" role="tablist" aria-label="Panel view">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "history"}
          className={`ghost-button tab-segment${activeTab === "history" ? " tab-active" : ""}`}
          title={`${history.length} clipboard ${history.length === 1 ? "item" : "items"}`}
          onClick={() => {
            setActiveTab("history");
            setExpandedId(null);
          }}
        >
          <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 4a8 8 0 1 0 7.7 10h-2.1A6 6 0 1 1 12 6v4l4.5 2.7.8-1.3L13.5 9V4H12Zm1 0h4v4h-1.5V5.5H13V4Z"
              fill="currentColor"
            />
          </svg>
          <span>History</span>
          <span className="tab-count" aria-hidden="true">
            {history.length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "snippets"}
          className={`ghost-button tab-segment${activeTab === "snippets" ? " tab-active" : ""}`}
          title={`${snippetCount} saved ${snippetCount === 1 ? "snippet" : "snippets"}`}
          onClick={() => {
            setActiveTab("snippets");
            setExpandedId(null);
          }}
        >
          <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.2L5 21V4a1 1 0 0 1 1-1Zm1 2v13.7l5-3 5 3V5H7Z"
              fill="currentColor"
            />
          </svg>
          <span>Snippets</span>
          <span className="tab-count" aria-hidden="true">
            {snippetCount}
          </span>
        </button>
      </div>
      {activeTab === "history" ? (
        <div className="history-pane">
          <SearchInput
            ref={inputRef}
            value={query}
            resultCount={filteredHistory.length}
            totalCount={history.length}
            onChange={setQuery}
            onClear={() => setQuery("")}
            onKeyDown={onKeyDown}
          />
          <HistoryList
            items={filteredHistory}
            query={normalizedQuery}
            selectedIndex={selectedIndex}
            expandedId={expandedId}
            onHover={setSelectedIndex}
            onSelect={(id) => void handleSelect(id)}
            onDelete={(id) => void handleDelete(id)}
            onTogglePin={(id) => void handlePin(id)}
            onToggleExpand={(id) => handleToggleExpand(id)}
            onStatus={showToast}
          />
        </div>
      ) : (
        <SnippetsPanel onStatus={showToast} />
      )}
      {activeTab === "history" ? (
        <div
          className={`shortcut-hint-bar${showShortcutHintBar ? " shortcut-hint-bar-visible" : ""}`}
        >
          P Pin | Ctrl+Shift+P Pin | Del Remove | ↑↓ Navigate | Enter Paste |
          Space Preview | ? Shortcuts
        </div>
      ) : null}
      {statusMessage ? (
        <div className="status-banner status-banner-success">
          {statusMessage}
        </div>
      ) : null}
      {error ? (
        <div className="status-banner status-banner-error">{error}</div>
      ) : null}
    </OverlayShell>
  );
}

export default App;
