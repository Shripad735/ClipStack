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
  const shouldGroup = query.trim().length === 0

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
      {shouldGroup ? (
        <GroupedHistoryRows
          items={items}
          query={query}
          selectedIndex={selectedIndex}
          expandedItemId={expandedItemId}
          onHover={onHover}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
        />
      ) : (
        items.map((item, index) => (
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
        ))
      )}
    </div>
  )
}

type IndexedItem = { item: ClipboardEntry; index: number }

function isSameLocalDay(timestamp: number, comparison: Date) {
  const date = new Date(timestamp)
  return (
    date.getFullYear() === comparison.getFullYear() &&
    date.getMonth() === comparison.getMonth() &&
    date.getDate() === comparison.getDate()
  )
}

function GroupedHistoryRows({
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
  const indexedItems = items.map((item, index) => ({ item, index }))
  const now = new Date()
  const pinned = indexedItems.filter(({ item }) => item.pinned)
  const today = indexedItems.filter(({ item }) => !item.pinned && isSameLocalDay(item.createdAt, now))
  const earlier = indexedItems.filter(({ item }) => !item.pinned && !isSameLocalDay(item.createdAt, now))

  return (
    <>
      <GroupedSection
        title="Pinned"
        entries={pinned}
        query={query}
        selectedIndex={selectedIndex}
        expandedItemId={expandedItemId}
        onHover={onHover}
        onToggleExpand={onToggleExpand}
        onSelect={onSelect}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
      />
      <GroupedSection
        title="Today"
        entries={today}
        query={query}
        selectedIndex={selectedIndex}
        expandedItemId={expandedItemId}
        onHover={onHover}
        onToggleExpand={onToggleExpand}
        onSelect={onSelect}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
      />
      <GroupedSection
        title="Earlier"
        entries={earlier}
        query={query}
        selectedIndex={selectedIndex}
        expandedItemId={expandedItemId}
        onHover={onHover}
        onToggleExpand={onToggleExpand}
        onSelect={onSelect}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
      />
    </>
  )
}

type GroupedSectionProps = {
  title: string
  entries: IndexedItem[]
  query: string
  selectedIndex: number
  expandedItemId: number | null
  onHover: (index: number) => void
  onToggleExpand: (id: number) => void
  onSelect: (id: number) => void
  onDelete: (id: number) => void
  onTogglePin: (id: number) => void
}

function GroupedSection({
  title,
  entries,
  query,
  selectedIndex,
  expandedItemId,
  onHover,
  onToggleExpand,
  onSelect,
  onDelete,
  onTogglePin,
}: GroupedSectionProps) {
  if (entries.length === 0) {
    return null
  }

  return (
    <section className="history-group" aria-label={title}>
      <h2 className="history-group-title">{title}</h2>
      {entries.map(({ item, index }) => (
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
    </section>
  )
}
