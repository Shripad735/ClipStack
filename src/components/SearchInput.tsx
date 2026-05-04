import { forwardRef } from "react";
import type { KeyboardEvent } from "react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocusRequest: () => void;
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, onKeyDown, onFocusRequest }, ref) => (
    <div className="search-shell">
      <button
        type="button"
        className="search-focus-button"
        aria-label="Focus search"
        onClick={onFocusRequest}
      >
        🔍
      </button>
      <input
        ref={ref}
        type="search"
        className="search-input"
        placeholder="Search clipboard"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="search-hint">Enter paste | P pin | Del remove</span>
    </div>
  ),
);

SearchInput.displayName = "SearchInput";
