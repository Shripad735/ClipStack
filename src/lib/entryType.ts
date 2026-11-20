import type { ClipboardEntry } from "./tauri";

export type EntryFilter = "all" | "text" | "code" | "url" | "email" | "path" | "image";

export type EntryType = Exclude<EntryFilter, "all">;

export type SortMode = "recent" | "top";

/** Single shared classifier: mirrors the row badge logic exactly. */
export function getEntryType(item: ClipboardEntry): EntryType {
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
    return "path";
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
