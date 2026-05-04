import { forwardRef } from 'react'
import type { KeyboardEvent } from 'react'

type SearchInputProps = {
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onChange, onKeyDown }, ref) => (
    <div className="search-shell">
      <span className="search-prefix">/</span>
      <input
        ref={ref}
        className="search-input"
        placeholder="Search clipboard"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <span className="search-hint">Enter pastes | P pins | Del removes</span>
    </div>
  ),
)

SearchInput.displayName = 'SearchInput'
