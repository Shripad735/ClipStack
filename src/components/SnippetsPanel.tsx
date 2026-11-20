import { useEffect, useRef, useState } from "react";
import { isTauriRuntime, pasteSnippet } from "../lib/tauri";

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
    return parsed.filter(
      (item): item is Snippet =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Snippet).id === "string" &&
        typeof (item as Snippet).content === "string",
    );
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

/** Expands {date}, {time} and {datetime} placeholders at use time. */
function expandVariables(value: string) {
  const now = new Date();
  return value
    .replaceAll(
      "{date}",
      now.toLocaleDateString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    )
    .replaceAll(
      "{time}",
      now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    )
    .replaceAll("{datetime}", now.toLocaleString());
}

function normalizeImported(raw: unknown): Snippet[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const now = Date.now();
  const normalized: Snippet[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const content = entry.trim();
      if (content) {
        normalized.push({
          id: crypto.randomUUID(),
          title: "Untitled snippet",
          content,
          createdAt: now,
        });
      }
      continue;
    }
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const candidate = entry as Partial<Snippet>;
    const content =
      typeof candidate.content === "string" ? candidate.content.trim() : "";
    if (!content) {
      continue;
    }
    normalized.push({
      id:
        typeof candidate.id === "string" && candidate.id
          ? candidate.id
          : crypto.randomUUID(),
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : "Untitled snippet",
      content,
      createdAt:
        typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : now,
    });
  }
  return normalized;
}

export function SnippetsPanel({ onStatus }: SnippetsPanelProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [flashLabel, setFlashLabel] = useState("Copied!");
  const [busyId, setBusyId] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editAreaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    window.dispatchEvent(new Event("clipstack-snippets-changed"));
  }, [snippets]);

  useEffect(() => {
    if (!flashId) {
      return;
    }
    const timer = window.setTimeout(() => setFlashId(null), 1100);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleSnippets = normalizedSearch
    ? snippets.filter(
        (snippet) =>
          snippet.title.toLowerCase().includes(normalizedSearch) ||
          snippet.content.toLowerCase().includes(normalizedSearch),
      )
    : snippets;

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
    if (editingId === id) {
      setEditingId(null);
    }
    onStatus("Snippet removed.");
  };

  const flash = (id: string, label: string) => {
    setFlashLabel(label);
    setFlashId(id);
  };

  const handleCopy = async (snippet: Snippet, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    try {
      await copyText(expandVariables(snippet.content));
      flash(snippet.id, "Copied!");
      onStatus(`Copied snippet: ${snippet.title}`);
    } catch {
      onStatus("Unable to copy snippet.");
    }
  };

  const handleInsert = async (snippet: Snippet, event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation();
    }
    if (busyId === snippet.id) {
      return;
    }
    const expanded = expandVariables(snippet.content);
    if (!isTauriRuntime()) {
      try {
        await copyText(expanded);
        flash(snippet.id, "Copied!");
        onStatus("Desktop runtime unavailable — snippet copied instead.");
      } catch {
        onStatus("Unable to copy snippet.");
      }
      return;
    }
    setBusyId(snippet.id);
    try {
      await pasteSnippet(expanded);
      flash(snippet.id, "Inserted!");
      onStatus(`Inserted snippet: ${snippet.title}`);
    } catch (insertError) {
      onStatus(
        insertError instanceof Error
          ? insertError.message
          : "Unable to insert snippet.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (snippet: Snippet, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingId(snippet.id);
    setEditTitle(snippet.title === "Untitled snippet" ? "" : snippet.title);
    setEditContent(snippet.content);
    window.setTimeout(() => editAreaRef.current?.focus(), 20);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  };

  const saveEdit = (id: string) => {
    const trimmedContent = editContent.trim();
    if (!trimmedContent) {
      onStatus("Snippet content cannot be empty.");
      return;
    }
    const trimmedTitle = editTitle.trim();
    setSnippets((current) =>
      current.map((snippet) =>
        snippet.id === id
          ? {
              ...snippet,
              title: trimmedTitle || "Untitled snippet",
              content: trimmedContent,
            }
          : snippet,
      ),
    );
    cancelEdit();
    onStatus("Snippet updated.");
  };

  const insertVariable = (token: "{date}" | "{time}" | "{datetime}") => {
    const area = editorRef.current;
    if (!area) {
      setContent((current) => (current ? `${current}${token}` : token));
      return;
    }
    const start = area.selectionStart ?? content.length;
    const end = area.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    window.setTimeout(() => {
      area.focus();
      const caret = start + token.length;
      area.setSelectionRange(caret, caret);
    }, 0);
  };

  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(snippets, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `clipstack-snippets-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      onStatus(`Exported ${snippets.length} snippet${snippets.length === 1 ? "" : "s"}.`);
    } catch {
      onStatus("Unable to export snippets.");
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const imported = normalizeImported(JSON.parse(text));
      if (imported.length === 0) {
        onStatus("No snippets found in that file.");
        return;
      }
      setSnippets((current) => {
        const existingIds = new Set(current.map((snippet) => snippet.id));
        const existingBodies = new Set(
          current.map((snippet) => `${snippet.title}\n${snippet.content}`),
        );
        const fresh = imported.filter(
          (snippet) =>
            !existingIds.has(snippet.id) &&
            !existingBodies.has(`${snippet.title}\n${snippet.content}`),
        );
        return [...fresh, ...current];
      });
      const dedupNote =
        imported.length === 1 ? "" : " (duplicates skipped)";
      onStatus(`Imported ${imported.length} snippet${imported.length === 1 ? "" : "s"}${dedupNote}.`);
    } catch {
      onStatus("Could not read that file as snippets JSON.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="snippets-panel">
      <div className="snippets-editor">
        <input
          className="snippet-title-input"
          placeholder="Snippet title (optional)"
          aria-label="New snippet title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          ref={editorRef}
          className="snippet-textarea"
          placeholder="Paste reusable text template... supports {date} {time} {datetime}"
          aria-label="New snippet content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="snippet-var-row" aria-label="Insert variable">
          <span className="snippet-var-hint">Variables:</span>
          {(["{date}", "{time}", "{datetime}"] as const).map((token) => (
            <button
              key={token}
              type="button"
              className="var-chip"
              title={`Insert ${token} (expands on copy/insert)`}
              onClick={() => insertVariable(token)}
            >
              {token}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="snippets-save-button"
          onClick={addSnippet}
          disabled={!content.trim()}
        >
          Save snippet
        </button>
      </div>

      <div className="snippets-toolbar">
        <div className="snippet-search-shell">
          <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M11 4a7 7 0 1 0 4.9 12l3.6 3.6a1 1 0 0 0 1.4-1.4l-3.6-3.6A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"
              fill="currentColor"
            />
          </svg>
          <input
            className="snippet-search-input"
            placeholder="Search snippets"
            aria-label="Search snippets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {search ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear snippet search"
              onClick={() => setSearch("")}
              tabIndex={-1}
            >
              ×
            </button>
          ) : null}
          <span className="search-count" aria-live="polite">
            {visibleSnippets.length}/{snippets.length}
          </span>
        </div>
        <div className="snippets-io">
          <button
            className="icon-button"
            type="button"
            onClick={handleExport}
            disabled={snippets.length === 0}
            title="Download snippets as JSON"
          >
            Export
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import snippets from a JSON file"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="snippet-file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImportFile(file);
              }
            }}
          />
        </div>
      </div>

      {snippets.length === 0 ? (
        <div className="empty-state">
          <p>No snippets yet.</p>
          <span>Save templates here for quick re-use.</span>
        </div>
      ) : visibleSnippets.length === 0 ? (
        <div className="empty-state">
          <p>No snippets match “{search.trim()}”.</p>
          <span>Try a different search term.</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setSearch("")}
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="snippets-list">
          {visibleSnippets.map((snippet) => (
            <article
              key={snippet.id}
              className="snippet-row"
              onClick={() => void handleCopy(snippet)}
            >
              {flashId === snippet.id && (
                <div className="snippet-copied-indicator">{flashLabel}</div>
              )}
              {editingId === snippet.id ? (
                <div
                  className="snippet-edit-form"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    className="snippet-title-input"
                    aria-label="Edit snippet title"
                    placeholder="Snippet title (optional)"
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                  />
                  <textarea
                    ref={editAreaRef}
                    className="snippet-textarea"
                    aria-label="Edit snippet content"
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                  />
                  <div className="snippet-edit-actions">
                    <button
                      className="snippets-save-button"
                      type="button"
                      onClick={() => saveEdit(snippet.id)}
                    >
                      Save
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="snippet-row-main">
                    <div className="snippet-row-header">
                      <h3
                        className={`snippet-row-title${!snippet.title || snippet.title === "Untitled snippet" ? " snippet-row-title-muted" : ""}`}
                      >
                        {snippet.title || "Untitled snippet"}
                      </h3>
                      <span className="pill pill-muted timestamp-pill">
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
                      className="icon-button snippet-insert-button"
                      type="button"
                      disabled={busyId === snippet.id}
                      title={
                        isTauriRuntime()
                          ? "Paste into the active app"
                          : "Desktop runtime unavailable — copies instead"
                      }
                      onClick={(e) => void handleInsert(snippet, e)}
                    >
                      Insert
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={(e) => void handleCopy(snippet, e)}
                    >
                      Copy
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="Edit snippet"
                      onClick={(e) => startEdit(snippet, e)}
                    >
                      Edit
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
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
