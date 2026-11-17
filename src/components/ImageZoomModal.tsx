import { useEffect } from "react";

type ImageZoomModalProps = {
  imageSrc: string | null;
  dimensionsLabel: string | null;
  itemId: number;
  onClose: () => void;
  onSave: () => void;
  onReveal: () => void;
  isBusy: boolean;
};

export function ImageZoomModal({
  imageSrc,
  dimensionsLabel,
  itemId,
  onClose,
  onSave,
  onReveal,
  isBusy,
}: ImageZoomModalProps) {
  // Close on Escape without hiding the whole overlay twice:
  // the parent collapses/ignores overlay-hide while the zoom is open.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      className="image-zoom-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Clipboard image ${itemId} preview`}
      onClick={onClose}
    >
      <div
        className="image-zoom-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="image-zoom-header">
          <span className="pill pill-type type-image">Image</span>
          {dimensionsLabel ? (
            <span className="pill pill-muted">{dimensionsLabel}</span>
          ) : null}
          <span className="image-zoom-spacer" />
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            title="Close zoom (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="image-zoom-body">
          {imageSrc ? (
            <img
              className="image-zoom-img"
              src={imageSrc}
              alt={
                dimensionsLabel
                  ? `Clipboard image ${dimensionsLabel}`
                  : "Clipboard image full preview"
              }
            />
          ) : (
            <div className="history-image-placeholder" role="img" aria-label="Image preview unavailable">
              <span>Image preview unavailable</span>
            </div>
          )}
        </div>
        <div className="image-zoom-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onSave}
            disabled={isBusy}
            title="Save a PNG copy to Pictures/ClipStack"
          >
            Save As
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onReveal}
            disabled={isBusy}
            title="Show the stored file in Explorer"
          >
            Reveal
          </button>
        </div>
      </div>
    </div>
  );
}
