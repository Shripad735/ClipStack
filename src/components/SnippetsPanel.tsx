import { useEffect, useState } from "react";

type Snippet = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
};

type SnippetsPanelProps = {
  onStatus: (message: string) => void;
};

const STORAGE_KEY = "clipstack.snippets.v1";

function loadSnippets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [] as Snippet[];
    }
    const parsed = JSON.parse(raw) as Snippet[];
    if (!Array.isArray(parsed)) {
      return [] as Snippet[];
    }
    return parsed;
  } catch {
    return [] as Snippet[];
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export function SnippetsPanel({ onStatus }: SnippetsPanelProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  }, [snippets]);

  const addSnippet = () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return;
    }

    const nextSnippet: Snippet = {
      id: crypto.randomUUID(),
      title: trimmedTitle || "Untitled snippet",
      content: trimmedContent,
      createdAt: Date.now(),
    };

    setSnippets((current) => [nextSnippet, ...current]);
    setTitle("");
    setContent("");
    onStatus("Snippet saved.");
  };

  const removeSnippet = (id: string) => {
    setSnippets((current) => current.filter((snippet) => snippet.id !== id));
    onStatus("Snippet removed.");
  };

  const handleCopy = async (snippet: Snippet, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    try {
      await copyText(snippet.content);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId(null), 1000);
      onStatus(`Copied snippet: ${snippet.title}`);
    } catch {
      onStatus("Unable to copy snippet.");
    }
  };

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
        <button
          type="button"
          className="snippets-save-button"
          onClick={addSnippet}
        >
          Save snippet
        </button>
      </div>

      {snippets.length === 0 ? (
        <div className="empty-state">
          <p>No snippets yet.</p>
          <span>Save templates here for quick re-use.</span>
        </div>
      ) : (
        <div className="snippets-list">
          {snippets.map((snippet) => (
            <article
              key={snippet.id}
              className="snippet-row"
              onClick={() => void handleCopy(snippet)}
            >
              {copiedId === snippet.id && (
                <div className="snippet-copied-indicator">Copied!</div>
              )}
              <div className="snippet-row-main">
                <div className="snippet-row-header">
                  <h3
                    className={`snippet-row-title${!snippet.title || snippet.title === "Untitled snippet" ? " snippet-row-title-muted" : ""}`}
                  >
                    {snippet.title || "Untitled snippet"}
                  </h3>
                  <span className="pill pill-muted">
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(snippet.createdAt))}
                  </span>
                </div>
                <p className="snippet-row-content">{snippet.content}</p>
              </div>
              <div className="snippet-row-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={(e) => void handleCopy(snippet, e)}
                >
                  Copy
                </button>
                <button
                  className="icon-button icon-button-danger"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSnippet(snippet.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
