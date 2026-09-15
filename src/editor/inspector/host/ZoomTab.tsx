import { Button } from "@design/components";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import type { SuggestedZoom } from "../../autozoom";
import { usePlaybackStore } from "../../playback";
import { useEditorStore, useEditorUiStore } from "../../store";
import { useInspectorT } from "../i18n";
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
  const t = useInspectorT();
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

  // Suggestions awaiting Keep / Review / Dismiss are the pending set (timeline ghosts, §8).
  const offered = pending?.mode === "toast" ? pending.suggestions : null;
  useEffect(() => {
    if (!offered || offered.length === 0) return;
    useEditorUiStore.getState().setPendingSuggestions(offered.map((s) => s.id));
    return () => useEditorUiStore.getState().clearPendingSuggestions();
  }, [offered]);

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
          setError(err instanceof Error ? err.message : t("inspector.zoom.analyzeFailed"));
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
      commit(next.kept, t("inspector.zoom.history.keepReviewed"));
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
        <output aria-label={t("inspector.zoom.suggestions.label")} style={toastStyle}>
          <span>{suggestionsToastText(pending.suggestions.length)}</span>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            {pending.suggestions.length > 0 && (
              <>
                <Button
                  variant="primary"
                  onClick={() =>
                    commit(pending.suggestions, t("inspector.zoom.history.keepSuggestions"))
                  }
                >
                  {t("inspector.zoom.suggestions.keepAll")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const first = pending.suggestions[0];
                    if (first) seek(first.startMs);
                    setPending({ mode: "review", review: startReview(pending.suggestions) });
                  }}
                >
                  {t("inspector.zoom.suggestions.review")}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("inspector.zoom.suggestions.dismiss")}
            </Button>
          </div>
        </output>
      )}
      {pending?.mode === "review" && (
        <ReviewCard review={pending.review} onDecide={decide} onCancel={() => setPending(null)} />
      )}
      <ZoomInspector
        settings={e.zoom}
        onSettingsChange={(zoom) =>
          host.documentUpdate(t("inspector.zoom.history.settings"), { zoom }, "zoom-settings")
        }
        selectedRegion={selectedRegion}
        onRegionChange={(next) =>
          host.documentUpdate(
            t("inspector.zoom.history.edit"),
            { zoomRegions: e.zoomRegions.map((r) => (r.id === next.id ? next : r)) },
            `zoom-edit-${next.id}`,
          )
        }
        onDuplicate={(id) => {
          const regions = duplicateRegion(e.zoomRegions, id, e.durationMs, hostId("zoom"));
          if (regions)
            host.documentUpdate(t("inspector.zoom.history.duplicate"), { zoomRegions: regions });
        }}
        onDelete={(id) =>
          host.documentUpdate(t("inspector.zoom.history.delete"), {
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
  const t = useInspectorT();
  const current = review.suggestions[review.index];
  if (!current) return null;
  return (
    <fieldset aria-label={t("inspector.zoom.review.label")} style={{ ...toastStyle, minWidth: 0 }}>
      <span>
        {t("inspector.zoom.review.position", {
          index: review.index + 1,
          total: review.suggestions.length,
        })}{" "}
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>
          {formatTimecode(current.startMs)}–{formatTimecode(current.endMs)}
        </span>
      </span>
      <span style={{ color: "var(--text-2)" }}>
        {t("inspector.zoom.review.reason", { reason: current.reason })}
      </span>
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <Button variant="primary" onClick={() => onDecide("keep")}>
          {t("inspector.common.keep")}
        </Button>
        <Button variant="secondary" onClick={() => onDecide("skip")}>
          {t("inspector.zoom.review.skip")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("inspector.common.cancel")}
        </Button>
      </div>
    </fieldset>
  );
}
