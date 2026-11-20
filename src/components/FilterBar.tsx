import type { EntryFilter, SortMode } from "../lib/entryType";

type FilterBarProps = {
  activeType: EntryFilter;
  onTypeChange: (next: EntryFilter) => void;
  pinnedOnly: boolean;
  onPinnedToggle: () => void;
  sortMode: SortMode;
  onSortChange: (next: SortMode) => void;
};

const TYPE_FILTERS: Array<{ value: EntryFilter; label: string; title: string }> = [
  { value: "all", label: "All", title: "Show every entry" },
  { value: "text", label: "Text", title: "Plain text entries" },
  { value: "code", label: "Code", title: "Code snippets" },
  { value: "url", label: "Links", title: "URLs" },
  { value: "email", label: "Email", title: "Email addresses" },
  { value: "path", label: "Paths", title: "File paths" },
  { value: "image", label: "Images", title: "Image entries" },
];

export function FilterBar({
  activeType,
  onTypeChange,
  pinnedOnly,
  onPinnedToggle,
  sortMode,
  onSortChange,
}: FilterBarProps) {
  return (
    <div className="filter-bar" role="toolbar" aria-label="Filter and sort history">
      <div className="filter-chips" role="group" aria-label="Filter by type">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`filter-chip${activeType === filter.value ? " filter-chip-active" : ""}`}
            aria-pressed={activeType === filter.value}
            title={filter.title}
            onClick={() => onTypeChange(filter.value)}
            tabIndex={-1}
          >
            {filter.label}
          </button>
        ))}
        <button
          type="button"
          className={`filter-chip filter-chip-pin${pinnedOnly ? " filter-chip-active" : ""}`}
          aria-pressed={pinnedOnly}
          title={pinnedOnly ? "Showing pinned only — click to show all" : "Show pinned entries only"}
          onClick={onPinnedToggle}
          tabIndex={-1}
        >
          <svg className="filter-pin-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M14 3h7v7l-3.3-3.3-6 6-1.4-1.4 6-6L14 3ZM10 21H3v-7l3.3 3.3 6-6 1.4 1.4-6 6L10 21Z"
              fill="currentColor"
            />
          </svg>
          Pinned
        </button>
      </div>
      <div className="sort-segment" role="group" aria-label="Sort history">
        <button
          type="button"
          className={`sort-option${sortMode === "recent" ? " sort-option-active" : ""}`}
          aria-pressed={sortMode === "recent"}
          title="Most recent first"
          onClick={() => onSortChange("recent")}
          tabIndex={-1}
        >
          Recent
        </button>
        <button
          type="button"
          className={`sort-option${sortMode === "top" ? " sort-option-active" : ""}`}
          aria-pressed={sortMode === "top"}
          title="Most pasted first"
          onClick={() => onSortChange("top")}
          tabIndex={-1}
        >
          Top
        </button>
      </div>
    </div>
  );
}
