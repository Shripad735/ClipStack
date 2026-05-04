import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react'
import { HistoryList } from './components/HistoryList'
import { OverlayShell } from './components/OverlayShell'
import { SearchInput } from './components/SearchInput'
import { useClipboardHistory } from './hooks/useClipboardHistory'
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation'
import { hideOverlay } from './lib/tauri'

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
  } = useClipboardHistory()
  const [query, setQuery] = useState('')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const filteredHistory = normalizedQuery
    ? history.filter((item) => item.content.toLowerCase().includes(normalizedQuery))
    : history

  const handleSelect = useEffectEvent(async (id: number) => {
    await copyItem(id)
    setQuery('')
  })

  const handleDelete = useEffectEvent(async (id: number) => {
    await deleteItem(id)
  })

  const handlePin = useEffectEvent(async (id: number) => {
    await togglePin(id)
  })

  const { selectedIndex, setSelectedIndex, onKeyDown } = useKeyboardNavigation({
    itemCount: filteredHistory.length,
    searchValue: query,
    onEnter: (index) => {
      const item = filteredHistory[index]
      if (item) {
        void handleSelect(item.id)
      }
    },
    onDelete: (index) => {
      const item = filteredHistory[index]
      if (item) {
        void handleDelete(item.id)
      }
    },
    onPin: (index) => {
      const item = filteredHistory[index]
      if (item) {
        void handlePin(item.id)
      }
    },
    onSpace: (index) => {
      const item = filteredHistory[index]
      if (item) {
        setExpandedItemId((current) => (current === item.id ? null : item.id))
      }
    },
    onEscape: () => {
      void hideOverlay()
    },
  })

  useEffect(() => {
    setSelectedIndex(0)
    setExpandedItemId(null)
  }, [normalizedQuery, setSelectedIndex])

  useEffect(() => {
    const focusSearch = () => {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }

    const hideOnBlur = () => {
      void hideOverlay()
    }

    focusSearch()
    window.addEventListener('focus', focusSearch)
    window.addEventListener('blur', hideOnBlur)

    return () => {
      window.removeEventListener('focus', focusSearch)
      window.removeEventListener('blur', hideOnBlur)
    }
  }, [])

  return (
    <OverlayShell
      isDesktop={isDesktop}
      isLoading={isLoading}
      itemCount={history.length}
      captureEnabled={settings.captureEnabled}
      isSettingsOpen={isSettingsOpen}
      onClearUnpinned={() => void clearUnpinned()}
      onRefresh={() => void refresh()}
      onToggleSettings={() => setIsSettingsOpen((open) => !open)}
      settings={settings}
      onSettingsChange={(next) => void updateSettings(next)}
    >
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
        expandedItemId={expandedItemId}
        onHover={setSelectedIndex}
        onToggleExpand={(id) => setExpandedItemId((current) => (current === id ? null : id))}
        onSelect={(id) => void handleSelect(id)}
        onDelete={(id) => void handleDelete(id)}
        onTogglePin={(id) => void handlePin(id)}
      />
      {error ? <div className="status-banner status-banner-error">{error}</div> : null}
    </OverlayShell>
  )
}

export default App
