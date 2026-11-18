import { forwardRef } from "react";
import type { KeyboardEvent } from "react";

type SearchInputProps = {
  value: string;
  resultCount?: number;
  totalCount?: number;
  onChange: (value: string) => void;
  onClear?: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, resultCount, totalCount, onChange, onClear, onKeyDown }, ref) => {
    const showCount =
      typeof resultCount === "number" && typeof totalCount === "number";
    const showClear = value.length > 0 && onClear;
    return (
      <div className="search-shell">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M11 4a7 7 0 1 0 4.9 12l3.6 3.6a1 1 0 0 0 1.4-1.4l-3.6-3.6A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
            fill="currentColor"
          />
        </svg>
        <input
          ref={ref}
          type="search"
          className="search-input"
          placeholder="Search clipboard"
          aria-label="Search clipboard history"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {showClear ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            title="Clear search (Esc)"
            onClick={onClear}
            tabIndex={-1}
          >
            ×
          </button>
        ) : null}
        {showCount ? (
          <span
            className="search-count"
            aria-live="polite"
            title={`${resultCount} of ${totalCount} items shown`}
          >
            {resultCount}/{totalCount}
          </span>
        ) : (
          <span className="search-hint">↵ paste · Space expand</span>
        )}
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
