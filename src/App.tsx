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
import { hideOverlay } from "./lib/tauri";

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
    setQuery("");
  });

  const handleDelete = useEffectEvent(async (id: number) => {
    await deleteItem(id);
  });

  const handlePin = useEffectEvent(async (id: number) => {
    await togglePin(id);
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
      onSpace: () => {},
      onEscape: () => {
        void hideOverlay();
      },
    });

  useEffect(() => {
    setSelectedIndex(0);
  }, [normalizedQuery, setSelectedIndex]);

  useEffect(() => {
    const hideTimer = window.setTimeout(() => {
      setShowShortcutHintBar(false);
    }, 4500);
    return () => window.clearTimeout(hideTimer);
  }, []);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        setShowShortcutHintBar(true);
        return;
      }

      onWindowKeyDown(event);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [onWindowKeyDown]);

  useEffect(() => {
    const hideOnBlur = () => {
      void hideOverlay();
    };

    window.addEventListener("blur", hideOnBlur);

    return () => {
      window.removeEventListener("blur", hideOnBlur);
    };
  }, []);

  return (
    <OverlayShell
      isDesktop={isDesktop}
      isLoading={isLoading}
      itemCount={history.length}
      captureEnabled={settings.captureEnabled}
      isSettingsOpen={isSettingsOpen}
      onClearUnpinned={() => void clearUnpinned()}
      onExportHistory={(format) => void handleExport(format)}
      onRefresh={() => void refresh()}
      onToggleSettings={() => setIsSettingsOpen((open) => !open)}
      settings={settings}
      onSettingsChange={(next) => void updateSettings(next)}
    >
      <div className="tab-strip">
        <button
          type="button"
          className={`ghost-button${activeTab === "history" ? " tab-active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        <button
          type="button"
          className={`ghost-button${activeTab === "snippets" ? " tab-active" : ""}`}
          onClick={() => setActiveTab("snippets")}
        >
          Snippets
        </button>
      </div>
      {activeTab === "history" ? (
        <div className="history-pane">
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={onKeyDown}
          />
          <HistoryList
            items={filteredHistory}
            query={normalizedQuery}
            selectedIndex={selectedIndex}
            onHover={setSelectedIndex}
            onSelect={(id) => void handleSelect(id)}
            onDelete={(id) => void handleDelete(id)}
            onTogglePin={(id) => void handlePin(id)}
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
