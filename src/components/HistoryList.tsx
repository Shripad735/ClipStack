import type { ClipboardEntry } from '../lib/tauri'
import { HistoryRow } from './HistoryRow'

type HistoryListProps = {
  items: ClipboardEntry[]
  query: string
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (id: number) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
}

export function HistoryList({
  items,
  query,
  selectedIndex,
  onHover,
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
          onMouseEnter={() => onHover(index)}
          onSelect={() => onSelect(item.id)}
          onDelete={() => onDelete(item.id)}
          onTogglePin={() => onTogglePin(item.id)}
        />
      ))}
    </div>
  )
}
