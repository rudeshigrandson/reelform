import { Button } from "@design/components";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import type { SuggestedZoom } from "../../autozoom";
import { usePlaybackStore } from "../../playback";
import { useEditorStore } from "../../store";
import { ZoomInspector, deleteRegion, duplicateRegion } from "../zoom";
import { formatTimecode } from "../zoom/zoomLogic";
import { hostId } from "./hooks";
import { timelineClips } from "./timeMap";
import type { InspectorHost } from "./types";
import {
  type ReviewState,
  generateSuggestions,
  mergeZoomSuggestions,
  reviewDone,
  reviewStep,
  startReview,
  suggestionsToastText,
} from "./zoomSuggestions";

/**
 * Zoom tab with real auto-zoom (guide S15, SPEC §8): generate → toast
 * "We suggested N zooms · Keep all / Review / Dismiss" → commit as one command.
 */

type Pending =
  | { mode: "toast"; suggestions: readonly SuggestedZoom[] }
  | { mode: "review"; review: ReviewState }
  | null;

const toastStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-2)",
  margin: "var(--space-2) var(--space-3) 0",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-panel-raised)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
};

export function ZoomTab({ host }: { host: InspectorHost }): ReactElement {
  const e = useEditorStore();
  const telemetry = useProjectSession((s) => s.telemetry);
  const meta = useProjectSession((s) => s.meta);
  const sourceSize = useProjectSession((s) => s.sourceSize);
  const seek = usePlaybackStore((p) => p.seek);
  const [analyzing, setAnalyzing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const hasTelemetry = telemetry !== null && telemetry.telemetry.points.length > 0;

  const generate = () => {
    if (!telemetry || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setPending(null);
    host.defer(() => {
      try {
        const suggestions = generateSuggestions({
          telemetry: telemetry.telemetry,
          sourceSize,
          clips: timelineClips(useEditorStore.getState().clips, meta),
          settings: useEditorStore.getState().zoom.autoZoom,
        });
        if (live.current) setPending({ mode: "toast", suggestions });
      } catch (err) {
        if (live.current)
          setError(err instanceof Error ? err.message : "Couldn't analyze cursor activity.");
      } finally {
        if (live.current) setAnalyzing(false);
      }
    });
  };

  const commit = (accepted: readonly SuggestedZoom[], label: string) => {
    const current = useEditorStore.getState().zoomRegions;
    host.documentUpdate(label, { zoomRegions: mergeZoomSuggestions(current, accepted) });
    setPending(null);
  };

  const decide = (decision: "keep" | "skip") => {
    if (pending?.mode !== "review") return;
    const next = reviewStep(pending.review, decision);
    if (reviewDone(next)) {
      commit(next.kept, "Keep reviewed zooms");
      return;
    }
    const upcoming = next.suggestions[next.index];
    if (upcoming) seek(upcoming.startMs);
    setPending({ mode: "review", review: next });
  };

  const selectedRegion = e.zoomRegions.find((r) => r.id === e.selectedZoomId) ?? null;

  return (
    <>
      {error && (
        <div role="alert" style={{ ...toastStyle, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {pending?.mode === "toast" && (
        <output aria-label="Zoom suggestions" style={toastStyle}>
          <span>{suggestionsToastText(pending.suggestions.length)}</span>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            {pending.suggestions.length > 0 && (
              <>
                <Button
                  variant="primary"
                  onClick={() => commit(pending.suggestions, "Keep zoom suggestions")}
                >
                  Keep all
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const first = pending.suggestions[0];
                    if (first) seek(first.startMs);
                    setPending({ mode: "review", review: startReview(pending.suggestions) });
                  }}
                >
                  Review
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => setPending(null)}>
              Dismiss
            </Button>
          </div>
        </output>
      )}
      {pending?.mode === "review" && (
        <ReviewCard review={pending.review} onDecide={decide} onCancel={() => setPending(null)} />
      )}
      <ZoomInspector
        settings={e.zoom}
        onSettingsChange={(zoom) => host.documentUpdate("Zoom settings", { zoom }, "zoom-settings")}
        selectedRegion={selectedRegion}
        onRegionChange={(next) =>
          host.documentUpdate(
            "Edit zoom",
            { zoomRegions: e.zoomRegions.map((r) => (r.id === next.id ? next : r)) },
            `zoom-edit-${next.id}`,
          )
        }
        onDuplicate={(id) => {
          const regions = duplicateRegion(e.zoomRegions, id, e.durationMs, hostId("zoom"));
          if (regions) host.documentUpdate("Duplicate zoom", { zoomRegions: regions });
        }}
        onDelete={(id) =>
          host.documentUpdate("Delete zoom", {
            zoomRegions: deleteRegion(e.zoomRegions, id),
            selectedZoomId: null,
          })
        }
        onGenerate={generate}
        status={analyzing ? "analyzing" : "idle"}
        hasTelemetry={hasTelemetry}
        hasSuggestions={e.zoomRegions.some((r) => r.source === "auto")}
        timelineDurationMs={e.durationMs}
      />
    </>
  );
}

function ReviewCard({
  review,
  onDecide,
  onCancel,
}: {
  review: ReviewState;
  onDecide: (d: "keep" | "skip") => void;
  onCancel: () => void;
}): ReactElement | null {
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
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <Button variant="primary" onClick={() => onDecide("keep")}>
          Keep
        </Button>
        <Button variant="secondary" onClick={() => onDecide("skip")}>
          Skip
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}
