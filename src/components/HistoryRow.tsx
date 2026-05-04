import { useEffect, useState } from "react";
import type { ClipboardEntry } from "../lib/tauri";
import { resolveClipboardImageSrc } from "../lib/tauri";

type HistoryRowProps = {
  item: ClipboardEntry;
  query: string;
  isSelected: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
};

type ContentType = "url" | "email" | "filepath" | "code" | "image" | "text";

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a3 3 0 0 1 4.2 4.2l-2.5 2.5a3 3 0 0 1-4.2 0 1 1 0 1 1 1.4-1.4 1 1 0 0 0 1.4 0l2.5-2.5a1 1 0 1 0-1.4-1.4L12 13.4a1 1 0 0 1-1.4 0Z" />
      <path d="M13.4 10.6a1 1 0 0 1 0 1.4L10 15.4a3 3 0 0 1-4.2-4.2l2.5-2.5a3 3 0 0 1 4.2 0 1 1 0 1 1-1.4 1.4 1 1 0 0 0-1.4 0l-2.5 2.5a1 1 0 1 0 1.4 1.4l3.4-3.4a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.7 7.3a1 1 0 0 1 0 1.4L5.4 12l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0Z" />
      <path d="M15.3 7.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4l3.3-3.3-3.3-3.3a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H4Zm16 2v.2l-8 5.3-8-5.3V8h16Zm-16 8v-5.4l7.4 4.9a1 1 0 0 0 1.2 0l7.4-4.9V16H4Z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6a2 2 0 0 1 2-2h4.6a2 2 0 0 1 1.6.8l1 1.2H19a2 2 0 0 1 2 2v1H3V6Zm18 5H3v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7Z" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 5a1 1 0 1 0 0 2h9a1 1 0 1 0 0-2H5Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H5Zm0 2h14a1 1 0 0 1 1 1v6.2l-3.2-3.2a1 1 0 0 0-1.4 0L9 16.2l-1.8-1.8a1 1 0 0 0-1.4 0L4 16.2V7a1 1 0 0 1 1-1Zm-1 11.4 2.5-2.5 1.8 1.8a1 1 0 0 0 1.4 0l6.4-6.4 3.9 3.9V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-.6ZM8 8.5A1.5 1.5 0 1 0 8 11.5 1.5 1.5 0 0 0 8 8.5Z" />
    </svg>
  );
}

function detectType(item: ClipboardEntry): ContentType {
  if (item.kind === "image") {
    return "image";
  }

  const trimmed = item.content.trim();
  if (!trimmed) {
    return "text";
  }

  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    return "url";
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "email";
  }

  if (
    /^[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\?)+$/.test(trimmed) ||
    /^\/(?:[^/\0]+\/?)+$/.test(trimmed)
  ) {
    return "filepath";
  }

  const codeSignals = [
    /```/,
    /\b(function|const|let|class|import|export|SELECT|INSERT|UPDATE|DELETE|CREATE)\b/,
    /[{}()[\];<>]/,
  ];
  const hasCodeSignal = codeSignals.some((pattern) =>
    pattern.test(item.content),
  );
  if (
    (item.content.includes("\n") && hasCodeSignal) ||
    (hasCodeSignal && item.content.length > 40)
  ) {
    return "code";
  }

  return "text";
}

function contentTypeMeta(item: ClipboardEntry) {
  const type = detectType(item);
  if (type === "image") {
    return {
      type,
      label: "Image",
      icon: <ImageIcon />,
      accentClass: "type-image",
    };
  }
  if (type === "url") {
    return {
      type,
      label: "URL",
      icon: <LinkIcon />,
      accentClass: "type-url",
    };
  }
  if (type === "code") {
    return {
      type,
      label: "Code",
      icon: <CodeIcon />,
      accentClass: "type-code",
    };
  }
  if (type === "email") {
    return {
      type,
      label: "Email",
      icon: <MailIcon />,
      accentClass: "type-email",
    };
  }
  if (type === "filepath") {
    return {
      type,
      label: "Path",
      icon: <FolderIcon />,
      accentClass: "type-path",
    };
  }

  return {
    type,
    label: "Text",
    icon: <TextIcon />,
    accentClass: "type-text",
  };
}

function highlightContent(content: string, query: string) {
  if (!query) {
    return content;
  }

  const lowerContent = content.toLowerCase();
  const startIndex = lowerContent.indexOf(query);
  if (startIndex === -1) {
    return content;
  }

  const endIndex = startIndex + query.length;
  return (
    <>
      {content.slice(0, startIndex)}
      <mark>{content.slice(startIndex, endIndex)}</mark>
      {content.slice(endIndex)}
    </>
  );
}

function formatAbsoluteTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatRelativeAge(timestamp: number) {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return "just now";
  }
  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes} min ago`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours} hr ago`;
  }
  if (diffMs < 2 * day) {
    return `Yesterday, ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp))}`;
  }
  return formatAbsoluteTimestamp(timestamp);
}

function formatImageDimensions(item: ClipboardEntry) {
  if (!item.imageWidth || !item.imageHeight) {
    return null;
  }

  return `${item.imageWidth}×${item.imageHeight}`;
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
  const meta = contentTypeMeta(item);
  const createdLabel = formatRelativeAge(item.createdAt);
  const rowClassName = `history-row${isSelected ? " history-row-selected" : ""}`;
  const imageSrc = resolveClipboardImageSrc(item.imagePath, item.content);
  const imageDimensions = formatImageDimensions(item);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc, item.id]);

  return (
    <article
      id={String(item.id)}
      className={rowClassName}
      onMouseEnter={onMouseEnter}
      onClick={onSelect}
    >
      <div className="history-row-meta">
        <span className={`pill pill-type ${meta.accentClass}`}>
          <span className="type-icon">{meta.icon}</span>
          {meta.label}
        </span>
        {imageDimensions ? (
          <span className="pill pill-muted">{imageDimensions}</span>
        ) : null}
        <span className="pill">{createdLabel}</span>
      </div>

      <div className="history-row-content-wrapper">
        {item.kind === "image" ? (
          <div className="history-image-preview-shell">
            {imageSrc && !imageFailed ? (
              <img
                className="history-image-preview"
                src={imageSrc}
                alt={
                  imageDimensions
                    ? `Clipboard image ${imageDimensions}`
                    : "Clipboard image preview"
                }
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div
                className="history-image-placeholder"
                role="img"
                aria-label="Image preview unavailable"
              >
                <span>Image preview unavailable</span>
                {imageDimensions ? <small>{imageDimensions}</small> : null}
              </div>
            )}
          </div>
        ) : (
          <p
            className={`history-content${meta.type === "url" ? " history-content-url" : ""}`}
          >
            {highlightContent(item.content, query)}
          </p>
        )}
      </div>

      <div className="history-row-actions">
        <button
          type="button"
          className="icon-button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
        >
          {item.pinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          className="icon-button icon-button-danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
