import { type ReactElement, useEffect, useRef, useState } from "react";
import { type ProjectSessionData, useProjectSession } from "../../../app/project/session";
import { measureLoudness, tracksToMeasure } from "../../audio/loudnessRunner";
import { type LoudnessTrack, useLoudnessStore } from "../../audio/loudnessStore";
import { usePlaybackStore } from "../../playback";
import { useEditorStore } from "../../store";
import { AudioInspector, WAVEFORM_BARS, addRegion } from "../audio";
import type { AvailableTracks } from "../audio/types";
import { useInspectorT, withDetail } from "../i18n";
import { fileNameOf, peaksFromAudio } from "./audioPeaks";
import { decodeCached, errorMessage, hostId, useDecodedAudio } from "./hooks";
import type { InspectorHost } from "./types";

/** Audio tab: track availability from the session, decoded waveforms, "Add audio…" (guide S17). */

export const AUDIO_FILTERS = [
  { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] },
];

/** Peaks computed per decoded waveform; enough bars for the mini preview. */
const PEAK_BUCKETS = WAVEFORM_BARS * 4;

export function availableTracksFor(
  s: Pick<ProjectSessionData, "meta" | "micUrl" | "systemAudioUrl">,
): AvailableTracks {
  return {
    mic: s.micUrl !== null || Boolean(s.meta?.sources.mic),
    system: s.systemAudioUrl !== null || Boolean(s.meta?.sources.system),
  };
}

/** Region url: `reelform-media://` base + project-relative path (absolute paths can't be served). */
export function regionUrl(mediaBaseUrl: string | null, path: string): string | null {
  if (!mediaBaseUrl || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return null;
  return `${mediaBaseUrl}${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function AudioTab({ host }: { host: InspectorHost }): ReactElement {
  const t = useInspectorT();
  const audio = useEditorStore((s) => s.audio);
  const durationMs = useEditorStore((s) => s.durationMs);
  const meta = useProjectSession((s) => s.meta);
  const micUrl = useProjectSession((s) => s.micUrl);
  const systemAudioUrl = useProjectSession((s) => s.systemAudioUrl);
  const mediaBaseUrl = useProjectSession((s) => s.mediaBaseUrl);
  const mic = useDecodedAudio(host, micUrl);
  const system = useDecodedAudio(host, systemAudioUrl);
  const [regionPeaks, setRegionPeaks] = useState<Record<string, number[]>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §9.5: measure integrated loudness (off-thread) the first time Normalize is on for a source.
  // Measurements are keyed by source URL in the store, so remounting this tab doesn't
  // re-measure and a replaced source (or another project) never reuses a stale value.
  const measuredUrls = useRef<Partial<Record<LoudnessTrack, string>>>({
    ...useLoudnessStore.getState().sources,
  });
  const micNormalize = audio.tracks.mic.normalize;
  const systemNormalize = audio.tracks.system.normalize;
  useEffect(() => {
    const urls = { mic: micUrl, system: systemAudioUrl };
    const store = useLoudnessStore.getState();
    for (const kind of ["mic", "system"] as const) {
      const measuredFrom = store.sources[kind];
      if ((measuredFrom !== undefined || kind in store.lufs) && measuredFrom !== urls[kind]) {
        store.forget(kind);
        if (measuredUrls.current[kind] === measuredFrom) delete measuredUrls.current[kind];
      }
    }
    const tracks = { mic: { normalize: micNormalize }, system: { normalize: systemNormalize } };
    for (const kind of tracksToMeasure(tracks, urls, measuredUrls.current)) {
      const url = urls[kind];
      if (!url) continue;
      measuredUrls.current[kind] = url;
      const stale = () => measuredUrls.current[kind] !== url;
      decodeCached(host, url)
        .then((decoded) => (decoded ? measureLoudness(decoded) : null))
        .then(
          (lufs) => {
            if (stale()) return;
            if (lufs === null) delete measuredUrls.current[kind];
            else useLoudnessStore.getState().setLufs(kind, lufs, url);
          },
          () => {
            if (!stale()) delete measuredUrls.current[kind];
          },
        );
    }
  }, [host, micUrl, systemAudioUrl, micNormalize, systemNormalize]);

  const regionKey = audio.regions.map((r) => `${r.id}:${r.path}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionKey summarizes audio.regions
  useEffect(() => {
    let live = true;
    for (const r of audio.regions) {
      if (regionPeaks[r.id]) continue;
      const url = regionUrl(mediaBaseUrl, r.path);
      if (!url) continue;
      void decodeCached(host, url).then((decoded) => {
        if (live && decoded)
          setRegionPeaks((p) => ({ ...p, [r.id]: peaksFromAudio(decoded, PEAK_BUCKETS) }));
      });
    }
    return () => {
      live = false;
    };
  }, [host, mediaBaseUrl, regionKey]);

  const addAudio = async () => {
    setError(null);
    try {
      const picked = await host.pickFile({
        title: t("inspector.audio.add"),
        filters: AUDIO_FILTERS,
      });
      if (!picked) return;
      setAdding(true);
      const media = await host.importMedia("audio", picked);
      const decoded = await decodeCached(host, media.url);
      const lengthMs = media.durationMs ?? decoded?.durationMs ?? 0;
      if (!(lengthMs > 0)) throw new Error(t("inspector.audio.error.noAudio"));
      const startMs = Math.min(usePlaybackStore.getState().currentMs, Math.max(0, durationMs - 1));
      const id = hostId("audio");
      const next = addRegion(useEditorStore.getState().audio, {
        id,
        fileName: fileNameOf(picked),
        path: media.path,
        startMs,
        endMs: Math.min(durationMs, startMs + lengthMs),
      });
      if (decoded) setRegionPeaks((p) => ({ ...p, [id]: peaksFromAudio(decoded, PEAK_BUCKETS) }));
      host.documentUpdate(t("inspector.audio.add"), { audio: next });
    } catch (err) {
      setError(withDetail(t, "inspector.audio.error.add", errorMessage(err, "")));
    } finally {
      setAdding(false);
    }
  };

  const available = availableTracksFor({ meta, micUrl, systemAudioUrl });
  const waveforms: Partial<Record<"mic" | "system", number[]>> = {};
  if (mic.state === "ready") waveforms.mic = peaksFromAudio(mic.audio, PEAK_BUCKETS);
  if (system.state === "ready") waveforms.system = peaksFromAudio(system.audio, PEAK_BUCKETS);

  return (
    <AudioInspector
      value={audio}
      onChange={(next) => {
        // "Clicks" mirrors the Cursor tab's click sound volume (one undo entry).
        // `cursor` is always in the patch (same reference when unchanged): a coalesced
        // entry undoes with its first patch's keys and redoes with its last, so the
        // key set must not vary within a drag or the two volumes drift apart.
        const { audio: current, cursor } = useEditorStore.getState();
        host.documentUpdate(
          t("inspector.audio.history.settings"),
          {
            audio: next,
            cursor:
              next.clickVolume === current.clickVolume
                ? cursor
                : { ...cursor, clickSound: { ...cursor.clickSound, volume: next.clickVolume } },
          },
          "audio-settings",
        );
      }}
      availableTracks={available}
      waveforms={waveforms}
      trackDurationMs={durationMs}
      onAddAudio={() => void addAudio()}
      regionWaveforms={regionPeaks}
      addAudioError={error}
      addingAudio={adding}
    />
  );
}
