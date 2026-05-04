import { useEffect, useState } from 'react'
import {
  type AppSettings,
  type ClipboardEntry,
  clearUnpinnedHistory,
  copyHistoryItem,
  defaultSettings,
  deleteHistoryItem,
  desktopListen,
  getHistory,
  getSettings,
  isTauriRuntime,
  toggleHistoryPin,
  updateSettings as persistSettings,
} from '../lib/tauri'

export function useClipboardHistory() {
  const [history, setHistory] = useState<ClipboardEntry[]>([])
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    setIsLoading(true)
    try {
      const [items, nextSettings] = await Promise.all([getHistory(), getSettings()])
      setHistory(items)
      setSettings(nextSettings)
      setError('')
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Unable to load clipboard history.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    let unlistenHistory: (() => void) | undefined
    let unlistenSettings: (() => void) | undefined

    void desktopListen('history-changed', () => {
      void refresh()
    }).then((unsubscribe) => {
      unlistenHistory = unsubscribe
    })

    void desktopListen('settings-changed', () => {
      void refresh()
    }).then((unsubscribe) => {
      unlistenSettings = unsubscribe
    })

    return () => {
      unlistenHistory?.()
      unlistenSettings?.()
    }
  }, [])

  return {
    history,
    settings,
    error,
    isDesktop: isTauriRuntime(),
    isLoading,
    refresh,
    copyItem: async (id: number) => {
      await copyHistoryItem(id)
    },
    deleteItem: async (id: number) => {
      await deleteHistoryItem(id)
      await refresh()
    },
    togglePin: async (id: number) => {
      await toggleHistoryPin(id)
      await refresh()
    },
    clearUnpinned: async () => {
      await clearUnpinnedHistory()
      await refresh()
    },
    updateSettings: async (next: AppSettings) => {
      setSettings(next)
      await persistSettings(next)
      await refresh()
    },
  }
}
