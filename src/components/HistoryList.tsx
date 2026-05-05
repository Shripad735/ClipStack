import { useEffect, useMemo, useRef } from "react";
import type { ClipboardEntry } from "../lib/tauri";
import { HistoryRow } from "./HistoryRow";

type HistoryListProps = {
  items: ClipboardEntry[];
  query: string;
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number) => void;
};

type IndexedItem = { item: ClipboardEntry; index: number };
type FlatRow =
  | { type: "header"; key: string; title: string }
  | { type: "item"; key: string; item: ClipboardEntry; index: number };

function isSameLocalDay(timestamp: number, comparison: Date) {
  const date = new Date(timestamp);
  return (
    date.getFullYear() === comparison.getFullYear() &&
    date.getMonth() === comparison.getMonth() &&
    date.getDate() === comparison.getDate()
  );
}

function buildRows(items: ClipboardEntry[], query: string): FlatRow[] {
  const shouldGroup = query.trim().length === 0;
  if (!shouldGroup) {
    return items.map((item, index) => ({
      type: "item",
      key: `item-${item.id}`,
      item,
      index,
    }));
  }

  const indexedItems = items.map((item, index) => ({ item, index }));
  const now = new Date();
  const pinned = indexedItems.filter(({ item }) => item.pinned);
  const today = indexedItems.filter(
    ({ item }) => !item.pinned && isSameLocalDay(item.createdAt, now),
  );
  const earlier = indexedItems.filter(
    ({ item }) => !item.pinned && !isSameLocalDay(item.createdAt, now),
  );

  const rows: FlatRow[] = [];
  const pushSection = (title: string, entries: IndexedItem[]) => {
    if (entries.length === 0) return;
    rows.push({ type: "header", key: `header-${title}`, title });
    rows.push(
      ...entries.map(({ item, index }) => ({
        type: "item" as const,
        key: `item-${item.id}`,
        item,
        index,
      })),
    );
  };

  pushSection("Pinned", pinned);
  pushSection("Today", today);
  pushSection("Earlier", earlier);
  return rows;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const flatRows = useMemo(() => buildRows(items, query), [items, query]);

  // Scroll the keyboard-selected row into view without jumping
  useEffect(() => {
    const container = containerRef.current;
    if (!container || items.length === 0) return;

    const selectedItem = items[selectedIndex];
    if (!selectedItem) return;

    const elById = document.getElementById(String(selectedItem.id));
    if (!elById) return;

    const itemTop = elById.offsetTop - container.offsetTop;
    const itemBottom = itemTop + elById.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (itemTop < viewTop) {
      container.scrollTop = itemTop - 4;
    } else if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - container.clientHeight + 4;
    }
  }, [selectedIndex, items]);

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>No clipboard items match yet.</p>
        <span>
          Copy text or images anywhere on Windows and they will appear here.
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="history-list"
      role="listbox"
      aria-activedescendant={
        items[selectedIndex] ? String(items[selectedIndex].id) : undefined
      }
    >
      {flatRows.map((row) => {
        if (row.type === "header") {
          return (
            <h2 key={row.key} className="history-group-title">
              {row.title}
            </h2>
          );
        }

        return (
          <HistoryRow
            key={row.key}
            item={row.item}
            query={query}
            isSelected={row.index === selectedIndex}
            onMouseEnter={() => onHover(row.index)}
            onSelect={() => onSelect(row.item.id)}
            onDelete={() => onDelete(row.item.id)}
            onTogglePin={() => onTogglePin(row.item.id)}
          />
        );
      })}
    </div>
  );
}
