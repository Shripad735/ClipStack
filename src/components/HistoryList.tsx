import type { ClipboardEntry } from '../lib/tauri'
import { HistoryRow } from './HistoryRow'

type HistoryListProps = {
  items: ClipboardEntry[]
  query: string
  selectedIndex: number
  expandedItemId: number | null
  onHover: (index: number) => void
  onToggleExpand: (id: number) => void
  onSelect: (id: number) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
}

export function HistoryList({
  items,
  query,
  selectedIndex,
  expandedItemId,
  onHover,
  onToggleExpand,
  onSelect,
  onDelete,
  onTogglePin,
}: HistoryListProps) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>No clipboard items match yet.</p>
        <span>Copy text anywhere on Windows and it will appear here.</span>
      </div>
    )
  }

  return (
    <div
      className="history-list"
      role="listbox"
      aria-activedescendant={items[selectedIndex] ? String(items[selectedIndex].id) : undefined}
    >
      {items.map((item, index) => (
        <HistoryRow
          key={item.id}
          item={item}
          query={query}
          isSelected={index === selectedIndex}
          isExpanded={expandedItemId === item.id}
          onMouseEnter={() => onHover(index)}
          onToggleExpand={() => onToggleExpand(item.id)}
          onSelect={() => onSelect(item.id)}
          onDelete={() => onDelete(item.id)}
          onTogglePin={() => onTogglePin(item.id)}
        />
      ))}
    </div>
  )
}
