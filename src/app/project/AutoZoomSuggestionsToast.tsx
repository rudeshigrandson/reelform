import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, useEffect, useState } from "react";
import type { SuggestedZoom } from "../../editor/autozoom";
import {
  type ReviewState,
  reviewDone,
  reviewStep,
  startReview,
  suggestionsToastText,
} from "../../editor/inspector/host/zoomSuggestions";
import { formatTimecode } from "../../editor/inspector/zoom/zoomLogic";
import { SHELL_LAYOUT } from "../../editor/shell/types";
import { useNarrowLayout } from "../../editor/shell/useNarrowLayout";
import type { DocumentUpdate } from "../../editor/state";
import { useEditorStore, useEditorUiStore } from "../../editor/store";
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
  /** Editor layout the card anchors to; follows the window width when omitted. */
  narrow?: boolean | undefined;
}

/**
 * Shared `.toast` card (S28 sheet), laid out as the S12/01 in-canvas card: 306px,
 * stacked rows, anchored 16px inside the bottom-right corner of the canvas well.
 */
function toastStyle(narrow: boolean): CSSProperties {
  const geo = narrow ? SHELL_LAYOUT.narrow : SHELL_LAYOUT.wide;
  return {
    position: "fixed",
    right: `${geo.inspector + 16}px`,
    bottom: `${geo.playback + geo.timeline + 16}px`,
    zIndex: 10,
    boxSizing: "border-box",
    width: "306px",
    maxWidth: `calc(100vw - ${geo.inspector + 32}px)`,
    flexDirection: "column",
    alignItems: "stretch",
    gap: "10px",
    margin: 0,
    padding: "14px",
    fontFamily: "var(--font-body)",
    lineHeight: 1.45,
  };
}

const headStyle: CSSProperties = { display: "flex", gap: "10px", alignItems: "flex-start" };

const rowStyle: CSSProperties = { display: "flex", gap: "8px", alignItems: "center" };

const pill: CSSProperties = {
  borderRadius: "var(--radius-full)",
  padding: "7px 14px",
  fontSize: "12px",
};

const secondaryPill: CSSProperties = { ...pill, background: "var(--bg-panel)" };

const dismissPill: CSSProperties = {
  ...pill,
  padding: "7px 10px",
  marginLeft: "auto",
  color: "var(--text-2)",
};

/** "We suggested 6 zooms" → the count phrase in bold (design S12/01). */
function SuggestionSummary({ text }: { text: string }): ReactElement {
  const m = /^(.*?)(\d+\s+\S+)$/.exec(text);
  return (
    <span>
      {m ? (
        <>
          {m[1]}
          <b>{m[2]}</b>
        </>
      ) : (
        text
      )}{" "}
      from your cursor activity. Nothing is applied yet.
    </span>
  );
}

export function AutoZoomSuggestionsToast({
  suggestions,
  documentUpdate,
  seek,
  onClose,
  narrow: narrowProp,
}: AutoZoomSuggestionsToastProps): ReactElement | null {
  const [review, setReview] = useState<ReviewState | null>(null);
  const narrow = useNarrowLayout(narrowProp);

  // Suggestions on the timeline draw as ghosts only while this toast awaits a decision.
  useEffect(() => {
    const ui = useEditorUiStore.getState();
    if (suggestions.length === 0) return;
    ui.setPendingSuggestions(suggestions.map((s) => s.id));
    return () => useEditorUiStore.getState().clearPendingSuggestions();
  }, [suggestions]);

  const close = () => {
    useEditorUiStore.getState().clearPendingSuggestions();
    onClose();
  };

  const removeUntouched = (label: string, ids: readonly string[]) => {
    if (ids.length > 0) {
      const current = useEditorStore.getState().zoomRegions;
      documentUpdate(label, { zoomRegions: withoutUntouchedSuggestions(current, ids) });
    }
    close();
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
  const style = toastStyle(narrow);

  if (review) {
    const current = review.suggestions[review.index];
    if (!current) return null;
    return (
      <fieldset
        aria-label="Review zoom suggestions"
        className="toast"
        style={{ ...style, minWidth: 0 }}
      >
        <div style={headStyle}>
          <span aria-hidden="true" className="toast-icon">
            ✦
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>
              Zoom {review.index + 1} of {review.suggestions.length} ·{" "}
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 400,
                  color: "var(--text-2)",
                }}
              >
                {formatTimecode(current.startMs)}–{formatTimecode(current.endMs)}
              </span>
            </span>
            <span style={{ color: "var(--text-2)", fontSize: "11px" }}>
              Zoomed because: {current.reason}
            </span>
          </span>
        </div>
        <div style={rowStyle}>
          <Button variant="primary" style={pill} onClick={() => decide("keep")}>
            Keep
          </Button>
          <Button variant="secondary" style={secondaryPill} onClick={() => decide("skip")}>
            Skip
          </Button>
          <Button variant="ghost" style={dismissPill} onClick={close}>
            Cancel
          </Button>
        </div>
      </fieldset>
    );
  }

  return (
    <output aria-label="Zoom suggestions" className="toast" style={style}>
      <div style={headStyle}>
        <span aria-hidden="true" className="toast-icon">
          ✦
        </span>
        <SuggestionSummary text={suggestionsToastText(suggestions.length)} />
      </div>
      <div style={rowStyle}>
        <Button variant="primary" style={pill} onClick={close}>
          Keep all
        </Button>
        <Button
          variant="secondary"
          style={secondaryPill}
          onClick={() => {
            const first = suggestions[0];
            if (first) seek(first.startMs);
            // Reviewing is a decision in progress: the regions draw solid while stepped through.
            useEditorUiStore.getState().clearPendingSuggestions();
            setReview(startReview(suggestions));
          }}
        >
          Review
        </Button>
        <Button
          variant="ghost"
          style={dismissPill}
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
