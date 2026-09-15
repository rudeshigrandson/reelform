import { type ReactElement, useMemo } from "react";
import { type ProjectSessionData, useProjectSession } from "../../../app/project/session";
import { mixToMono, rmsEnvelope } from "../../audio";
import { SILENCE_WINDOW_MS } from "../../audio/silence";
import { type EditorData, useEditorStore } from "../../store";
import { type TimelineDoc, clipsDurationMs, removeTimelineRange } from "../../timelineBinding";
import { EffectsInspector } from "../effects";
import type { AudioEnvelope, SpeedRegionEdit, TimeRange } from "../effects/types";
import { useDecodedAudio } from "./hooks";
import { cursorSamplesFromTelemetry } from "./telemetryInputs";
import { sourceRangesToTimeline, timelineClips } from "./timeMap";
import type { InspectorHost } from "./types";

/** Effects tab: remove silence as ripple clip cuts, auto speed-up idle (guide S20, SPEC §9.8). */

/** Mic preferred, else system. */
export function silenceSourceUrl(
  s: Pick<ProjectSessionData, "micUrl" | "systemAudioUrl">,
): string | null {
  return s.micUrl ?? s.systemAudioUrl;
}

export interface SilenceCutResult {
  /** One store patch: clips, duration and every timeline item rippled. */
  patch: Pick<
    EditorData,
    "clips" | "durationMs" | "zoomRegions" | "speedRegions" | "annotations" | "captions" | "audio"
  >;
  removedMs: number;
}

/**
 * Remove-silence gaps are in mic/source ms. Map them onto the timeline through
 * the clips, then ripple each range out latest-first with the same
 * `removeTimelineRange` the timeline uses, so zooms, speeds, annotations,
 * captions and audio regions after a cut shift with the video (SPEC §9.8).
 * Null when nothing would be removed.
 */
export function applySilenceCuts(
  doc: TimelineDoc,
  gaps: readonly TimeRange[],
): SilenceCutResult | null {
  const ranges = sourceRangesToTimeline(doc.clips, gaps);
  let cur: TimelineDoc = doc;
  let changed = false;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i] as { startMs: number; endMs: number };
    const next = removeTimelineRange(cur, r.startMs, r.endMs);
    if (!next) continue;
    cur = { ...cur, ...next };
    changed = true;
  }
  if (!changed) return null;
  const { clips, durationMs, zoomRegions, speedRegions, annotations, captions, audio } = cur;
  return {
    patch: { clips, durationMs, zoomRegions, speedRegions, annotations, captions, audio },
    removedMs: clipsDurationMs(doc.clips) - clipsDurationMs(clips),
  };
}

/** Speed regions that don't overlap the existing ones (auto idle never stacks rates). */
export function nonOverlappingRegions(
  existing: readonly SpeedRegionEdit[],
  added: readonly SpeedRegionEdit[],
): SpeedRegionEdit[] {
  const out = [...existing];
  for (const r of added) {
    if (out.some((o) => o.startMs < r.endMs && r.startMs < o.endMs)) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

export function EffectsTab({ host }: { host: InspectorHost }): ReactElement {
  const e = useEditorStore();
  const meta = useProjectSession((s) => s.meta);
  const telemetry = useProjectSession((s) => s.telemetry);
  const url = useProjectSession((s) => silenceSourceUrl(s));
  const decoded = useDecodedAudio(host, url);

  const envelope = useMemo<AudioEnvelope | null>(() => {
    if (decoded.state !== "ready") return null;
    return rmsEnvelope(
      mixToMono(decoded.audio.channels),
      decoded.audio.sampleRate,
      SILENCE_WINDOW_MS,
    );
  }, [decoded]);

  const clips = useMemo(() => timelineClips(e.clips, meta), [e.clips, meta]);
  const cursorSamples = useMemo(
    () => cursorSamplesFromTelemetry(telemetry?.telemetry ?? null, clips),
    [telemetry, clips],
  );

  const selectedSpeedRegion = e.speedRegions.find((r) => r.id === e.selectedSpeedId) ?? null;

  return (
    <EffectsInspector
      value={e.effects}
      onChange={(effects) => host.documentUpdate("Effects", { effects }, "effects-settings")}
      selectedSpeedRegion={selectedSpeedRegion}
      onSpeedRegionChange={(next) =>
        host.documentUpdate(
          "Edit speed",
          { speedRegions: e.speedRegions.map((r) => (r.id === next.id ? next : r)) },
          `speed-edit-${next.id}`,
        )
      }
      envelope={envelope}
      onApplyRemoveSilence={(gaps) => {
        const s = useEditorStore.getState();
        const result = applySilenceCuts(
          {
            durationMs: s.durationMs,
            clips: timelineClips(s.clips, useProjectSession.getState().meta),
            zoomRegions: s.zoomRegions,
            speedRegions: s.speedRegions,
            annotations: s.annotations,
            captions: s.captions,
            audio: s.audio,
          },
          gaps,
        );
        if (!result) return;
        host.documentUpdate("Remove silence", result.patch);
      }}
      cursorSamples={cursorSamples}
      onAutoSpeedIdle={(regions) =>
        host.documentUpdate("Auto speed-up idle", {
          speedRegions: nonOverlappingRegions(useEditorStore.getState().speedRegions, regions),
        })
      }
    />
  );
}
