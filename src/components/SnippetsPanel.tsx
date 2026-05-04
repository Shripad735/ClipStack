import { useEffect, useState } from 'react'

type Snippet = {
  id: string
  title: string
  content: string
  createdAt: number
}

type SnippetsPanelProps = {
  onStatus: (message: string) => void
}

const STORAGE_KEY = 'clipstack.snippets.v1'

function loadSnippets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return [] as Snippet[]
    }
    const parsed = JSON.parse(raw) as Snippet[]
    if (!Array.isArray(parsed)) {
      return [] as Snippet[]
    }
    return parsed
  } catch {
    return [] as Snippet[]
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const area = document.createElement('textarea')
  area.value = value
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.focus()
  area.select()
  document.execCommand('copy')
  document.body.removeChild(area)
}

export function SnippetsPanel({ onStatus }: SnippetsPanelProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets())
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets))
  }, [snippets])

  const addSnippet = () => {
    const trimmedTitle = title.trim()
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      return
    }

    const nextSnippet: Snippet = {
      id: crypto.randomUUID(),
      title: trimmedTitle || 'Untitled snippet',
      content: trimmedContent,
      createdAt: Date.now(),
    }

    setSnippets((current) => [nextSnippet, ...current])
    setTitle('')
    setContent('')
    onStatus('Snippet saved.')
  }

  const removeSnippet = (id: string) => {
    setSnippets((current) => current.filter((snippet) => snippet.id !== id))
    onStatus('Snippet removed.')
  }

  const handleCopy = async (snippet: Snippet) => {
    try {
      await copyText(snippet.content)
      onStatus(`Copied snippet: ${snippet.title}`)
    } catch {
      onStatus('Unable to copy snippet.')
    }
  }

  return (
    <section className="snippets-panel">
      <div className="snippets-editor">
        <input
          className="snippet-title-input"
          placeholder="Snippet title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="snippet-textarea"
          placeholder="Paste reusable text template..."
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <button type="button" className="ghost-button" onClick={addSnippet}>
          Save snippet
        </button>
      </div>

      <div className="history-list">
        {snippets.length === 0 ? (
          <div className="empty-state">
            <p>No snippets yet.</p>
            <span>Save templates here for quick re-use.</span>
          </div>
        ) : (
          snippets.map((snippet) => (
            <article key={snippet.id} className="history-row">
              <div className="history-row-main">
                <div className="history-row-tags">
                  <span className="pill pill-pinned">{snippet.title}</span>
                  <span className="pill">
                    {new Intl.DateTimeFormat(undefined, {
                      month: 'short',
                      day: 'numeric',
                    }).format(new Date(snippet.createdAt))}
                  </span>
                </div>
                <p className="history-content">{snippet.content}</p>
              </div>
              <div className="history-row-actions">
                <button className="icon-button" type="button" onClick={() => void handleCopy(snippet)}>
                  Copy
                </button>
                <button
                  className="icon-button icon-button-danger"
                  type="button"
                  onClick={() => removeSnippet(snippet.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
