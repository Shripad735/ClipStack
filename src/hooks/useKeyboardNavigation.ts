import type { KeyboardEvent } from 'react'
import { useState } from 'react'

type UseKeyboardNavigationOptions = {
  itemCount: number
  searchValue: string
  onEnter: (index: number) => void
  onDelete: (index: number) => void
  onPin: (index: number) => void
  onEscape: () => void
}

export function useKeyboardNavigation({
  itemCount,
  searchValue,
  onEnter,
  onDelete,
  onPin,
  onEscape,
}: UseKeyboardNavigationOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const clampIndex = (index: number) => {
    if (itemCount <= 0) {
      return 0
    }
    return Math.max(0, Math.min(index, itemCount - 1))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const hasSearchText = searchValue.trim().length > 0

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setSelectedIndex((current) => clampIndex(current + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setSelectedIndex((current) => clampIndex(current - 1))
        break
      case 'Enter':
        event.preventDefault()
        onEnter(selectedIndex)
        break
      case 'Delete':
        if (!hasSearchText) {
          event.preventDefault()
          onDelete(selectedIndex)
        }
        break
      case 'Escape':
        event.preventDefault()
        onEscape()
        break
      default:
        if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          onPin(selectedIndex)
        }
    }
  }

  return {
    selectedIndex,
    setSelectedIndex,
    onKeyDown,
  }
}
