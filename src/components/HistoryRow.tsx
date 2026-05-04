import type { ClipboardEntry } from '../lib/tauri'

type HistoryRowProps = {
  item: ClipboardEntry
  query: string
  isSelected: boolean
  onMouseEnter: () => void
  onSelect: () => void
  onDelete: () => void
  onTogglePin: () => void
}

function highlightContent(content: string, query: string) {
  if (!query) {
    return content
  }

  const lowerContent = content.toLowerCase()
  const startIndex = lowerContent.indexOf(query)
  if (startIndex === -1) {
    return content
  }

  const endIndex = startIndex + query.length
  return (
    <>
      {content.slice(0, startIndex)}
      <mark>{content.slice(startIndex, endIndex)}</mark>
      {content.slice(endIndex)}
    </>
  )
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function HistoryRow({
  item,
  query,
  isSelected,
  onMouseEnter,
  onSelect,
  onDelete,
  onTogglePin,
}: HistoryRowProps) {
  return (
    <article
      id={String(item.id)}
      className={`history-row${isSelected ? ' history-row-selected' : ''}`}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
    >
      <div className="history-row-main">
        <div className="history-row-tags">
          <span className="pill">{formatTimestamp(item.createdAt)}</span>
          {item.pinned ? <span className="pill pill-pinned">Pinned</span> : null}
        </div>
        <p className="history-content">{highlightContent(item.content, query)}</p>
      </div>
      <div className="history-row-actions">
        <button
          type="button"
          className="icon-button"
          onClick={(event) => {
            event.stopPropagation()
            onTogglePin()
          }}
        >
          {item.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          type="button"
          className="icon-button icon-button-danger"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          Delete
        </button>
      </div>
    </article>
  )
}
