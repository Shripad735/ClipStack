import type { KeyboardEvent } from 'react'
import { useState } from 'react'

type UseKeyboardNavigationOptions = {
  itemCount: number
  searchValue: string
  onEnter: (index: number) => void
  onDelete: (index: number) => void
  onPin: (index: number) => void
  onSpace: (index: number) => void
  onEscape: () => void
}

export function useKeyboardNavigation({
  itemCount,
  searchValue,
  onEnter,
  onDelete,
  onPin,
  onSpace,
  onEscape,
}: UseKeyboardNavigationOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const clampIndex = (index: number) => {
    if (itemCount <= 0) {
      return 0
    }
    return Math.max(0, Math.min(index, itemCount - 1))
  }

  const handleKey = (
    key: string,
    ctrlKey: boolean,
    metaKey: boolean,
    preventDefault: () => void,
  ) => {
    const hasSearchText = searchValue.trim().length > 0

    switch (key) {
      case 'ArrowDown':
        preventDefault()
        setSelectedIndex((current) => clampIndex(current + 1))
        return
      case 'ArrowUp':
        preventDefault()
        setSelectedIndex((current) => clampIndex(current - 1))
        return
      case 'Enter':
        preventDefault()
        onEnter(selectedIndex)
        return
      case 'Delete':
        if (!hasSearchText) {
          preventDefault()
          onDelete(selectedIndex)
        }
        return
      case 'Escape':
        preventDefault()
        onEscape()
        return
      case ' ':
        if (!hasSearchText) {
          preventDefault()
          onSpace(selectedIndex)
        }
        return
      default:
        if (key.toLowerCase() === 'p' && (ctrlKey || metaKey)) {
          preventDefault()
          onPin(selectedIndex)
        }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    handleKey(event.key, event.ctrlKey, event.metaKey, () => event.preventDefault())
  }

  const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    const target = event.target
    if (target instanceof HTMLElement) {
      if (target.tagName === 'TEXTAREA') {
        return
      }
      if (target.tagName === 'INPUT' && target.getAttribute('type') !== 'search') {
        return
      }
    }

    handleKey(event.key, event.ctrlKey, event.metaKey, () => event.preventDefault())
  }

  return {
    selectedIndex,
    setSelectedIndex,
    onKeyDown,
    onWindowKeyDown,
  }
}
