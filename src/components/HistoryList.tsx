import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

const GROUP_HEADER_HEIGHT = 26;
const TEXT_ROW_HEIGHT = 110;
const IMAGE_ROW_HEIGHT = 220;
const OVERSCAN_ROWS = 3;

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
    if (entries.length === 0) {
      return;
    }

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

function getRowHeight(row: FlatRow) {
  if (row.type === "header") {
    return GROUP_HEADER_HEIGHT;
  }

  return row.item.kind === "image" ? IMAGE_ROW_HEIGHT : TEXT_ROW_HEIGHT;
}

function findStartIndex(offsets: number[], scrollTop: number) {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= scrollTop) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function findEndIndex(offsets: number[], scrollBottom: number) {
  let low = 0;
  let high = offsets.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] < scrollBottom) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
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
  const [viewportHeight, setViewportHeight] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);

  const flatRows = useMemo(() => buildRows(items, query), [items, query]);
  const metrics = useMemo(() => {
    const heights = flatRows.map((row) => getRowHeight(row));
    const offsets = new Array(flatRows.length);
    let runningTotal = 0;
    for (let index = 0; index < flatRows.length; index += 1) {
      offsets[index] = runningTotal;
      runningTotal += heights[index];
    }

    return { heights, offsets, totalHeight: runningTotal };
  }, [flatRows]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const updateHeight = () => {
      setViewportHeight(node.clientHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const selectedRow = flatRows.find(
      (row) => row.type === "item" && row.index === selectedIndex,
    );
    if (!selectedRow || selectedRow.type !== "item") {
      return;
    }

    const rowPosition = flatRows.findIndex(
      (row) => row.key === selectedRow.key,
    );
    if (rowPosition < 0) {
      return;
    }

    const rowTop = metrics.offsets[rowPosition] ?? 0;
    const rowBottom = rowTop + (metrics.heights[rowPosition] ?? 0);
    const viewportTop = node.scrollTop;
    const viewportBottom = viewportTop + node.clientHeight;

    if (rowTop < viewportTop) {
      node.scrollTop = rowTop;
      setScrollTop(rowTop);
      return;
    }

    if (rowBottom > viewportBottom) {
      const nextScrollTop = rowBottom - node.clientHeight;
      node.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [flatRows, metrics.heights, metrics.offsets, selectedIndex]);

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

  const startIndex = Math.max(
    0,
    findStartIndex(metrics.offsets, scrollTop) - OVERSCAN_ROWS,
  );
  const endIndex = Math.min(
    flatRows.length - 1,
    findEndIndex(metrics.offsets, scrollTop + viewportHeight) + OVERSCAN_ROWS,
  );
  const visibleRows = flatRows.slice(startIndex, endIndex + 1);

  return (
    <div
      ref={containerRef}
      className="history-list"
      role="listbox"
      aria-activedescendant={
        items[selectedIndex] ? String(items[selectedIndex].id) : undefined
      }
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="history-list-spacer"
        style={{ height: metrics.totalHeight }}
      >
        {visibleRows.map((row, visibleIndex) => {
          const rowIndex = startIndex + visibleIndex;
          const top = metrics.offsets[rowIndex] ?? 0;
          const height = metrics.heights[rowIndex] ?? TEXT_ROW_HEIGHT;

          if (row.type === "header") {
            return (
              <div
                key={row.key}
                className="history-list-virtual-row history-list-virtual-header"
                style={{ top, height }}
              >
                <h2 className="history-group-title">{row.title}</h2>
              </div>
            );
          }

          return (
            <div
              key={row.key}
              className="history-list-virtual-row"
              style={{ top, height }}
            >
              <HistoryRow
                item={row.item}
                query={query}
                isSelected={row.index === selectedIndex}
                onMouseEnter={() => onHover(row.index)}
                onSelect={() => onSelect(row.item.id)}
                onDelete={() => onDelete(row.item.id)}
                onTogglePin={() => onTogglePin(row.item.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
