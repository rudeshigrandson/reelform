import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, useState } from "react";
import type { SuggestedZoom } from "../../editor/autozoom";
import {
  type ReviewState,
  reviewDone,
  reviewStep,
  startReview,
  suggestionsToastText,
} from "../../editor/inspector/host/zoomSuggestions";
import { formatTimecode } from "../../editor/inspector/zoom/zoomLogic";
import type { DocumentUpdate } from "../../editor/state";
import { useEditorStore } from "../../editor/store";
import { withoutUntouchedSuggestions } from "./autoZoomOnOpen";

/**
 * Boot suggestions toast (guide S12 state 1). The suggestions are already on
 * the timeline as ghosts, so: Keep all closes; Dismiss removes the untouched
 * ones (one undo entry); Review steps through them and removes the skipped
 * ones on finish (one undo entry). Edited regions are `manual` and never removed.
 */

export interface AutoZoomSuggestionsToastProps {
  suggestions: readonly SuggestedZoom[];
  documentUpdate: DocumentUpdate;
  seek: (ms: number) => void;
  onClose: () => void;
}

const toastStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "var(--space-4)",
  transform: "translateX(-50%)",
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  maxWidth: "calc(100% - 2 * var(--space-4))",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel-raised)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  boxShadow: "var(--shadow-md)",
};

const rowStyle: CSSProperties = { display: "flex", gap: "var(--space-1)", flexWrap: "wrap" };

export function AutoZoomSuggestionsToast({
  suggestions,
  documentUpdate,
  seek,
  onClose,
}: AutoZoomSuggestionsToastProps): ReactElement | null {
  const [review, setReview] = useState<ReviewState | null>(null);

  const removeUntouched = (label: string, ids: readonly string[]) => {
    if (ids.length > 0) {
      const current = useEditorStore.getState().zoomRegions;
      documentUpdate(label, { zoomRegions: withoutUntouchedSuggestions(current, ids) });
    }
    onClose();
  };

  const decide = (decision: "keep" | "skip") => {
    if (!review) return;
    const next = reviewStep(review, decision);
    if (reviewDone(next)) {
      const kept = new Set(next.kept.map((s) => s.id));
      const skipped = next.suggestions.filter((s) => !kept.has(s.id)).map((s) => s.id);
      removeUntouched("Keep reviewed zooms", skipped);
      return;
    }
    const upcoming = next.suggestions[next.index];
    if (upcoming) seek(upcoming.startMs);
    setReview(next);
  };

  if (suggestions.length === 0) return null;

  if (review) {
    const current = review.suggestions[review.index];
    if (!current) return null;
    return (
      <fieldset aria-label="Review zoom suggestions" style={{ ...toastStyle, minWidth: 0 }}>
        <span>
          Zoom {review.index + 1} of {review.suggestions.length} ·{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
            {formatTimecode(current.startMs)}–{formatTimecode(current.endMs)}
          </span>
        </span>
        <span style={{ color: "var(--text-2)" }}>Zoomed because: {current.reason}</span>
        <div style={rowStyle}>
          <Button variant="primary" onClick={() => decide("keep")}>
            Keep
          </Button>
          <Button variant="secondary" onClick={() => decide("skip")}>
            Skip
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </fieldset>
    );
  }

  return (
    <output aria-label="Zoom suggestions" style={toastStyle}>
      <span>{suggestionsToastText(suggestions.length)}</span>
      <div style={rowStyle}>
        <Button variant="primary" onClick={onClose}>
          Keep all
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const first = suggestions[0];
            if (first) seek(first.startMs);
            setReview(startReview(suggestions));
          }}
        >
          Review
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            removeUntouched(
              "Dismiss zoom suggestions",
              suggestions.map((s) => s.id),
            )
          }
        >
          Dismiss
        </Button>
      </div>
    </output>
  );
}
