export type ClipboardEntry = {
  id: number
  content: string
  createdAt: number
  pinned: boolean
  lastCopiedAt: number | null
}

export type AppSettings = {
  historyLimit: number
  retentionDays: number
  captureEnabled: boolean
  launchOnLogin: boolean
  pasteOnSelect: boolean
  hideAfterCopy: boolean
  showOnLaunch: boolean
}

export const defaultSettings: AppSettings = {
  historyLimit: 250,
  retentionDays: 30,
  captureEnabled: true,
  launchOnLogin: true,
  pasteOnSelect: true,
  hideAfterCopy: true,
  showOnLaunch: true,
}

const previewHistory: ClipboardEntry[] = [
  {
    id: 1,
    content: 'cargo tauri dev',
    createdAt: Date.now() - 5 * 60_000,
    pinned: true,
    lastCopiedAt: null,
  },
  {
    id: 2,
    content: 'SELECT * FROM clipboard_entries ORDER BY created_at DESC LIMIT 25;',
    createdAt: Date.now() - 16 * 60_000,
    pinned: false,
    lastCopiedAt: null,
  },
  {
    id: 3,
    content: 'https://v2.tauri.app/plugin/global-shortcut/',
    createdAt: Date.now() - 38 * 60_000,
    pinned: false,
    lastCopiedAt: null,
  },
]

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error('Desktop runtime unavailable. Open ClipStack with Tauri to use clipboard features.')
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function desktopListen<T>(event: string, handler: (payload: T) => void) {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (message) => handler(message.payload))
}

export async function hideOverlay() {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('hide_overlay')
}

export async function getHistory() {
  if (!isTauriRuntime()) {
    return previewHistory
  }

  return invokeCommand<ClipboardEntry[]>('get_history')
}

export async function getSettings() {
  if (!isTauriRuntime()) {
    return defaultSettings
  }

  return invokeCommand<AppSettings>('get_settings')
}

export async function copyHistoryItem(id: number) {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('copy_item', { id })
}

export async function toggleHistoryPin(id: number) {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('toggle_pin', { id })
}

export async function deleteHistoryItem(id: number) {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('delete_item', { id })
}

export async function clearUnpinnedHistory() {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('clear_unpinned')
}

export async function updateSettings(settings: AppSettings) {
  if (!isTauriRuntime()) {
    return settings
  }

  return invokeCommand<AppSettings>('update_settings', { settings })
}
