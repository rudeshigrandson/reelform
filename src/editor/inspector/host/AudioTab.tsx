import { type ReactElement, useEffect, useState } from "react";
import { type ProjectSessionData, useProjectSession } from "../../../app/project/session";
import { usePlaybackStore } from "../../playback";
import { useEditorStore } from "../../store";
import { AudioInspector, WAVEFORM_BARS, addRegion } from "../audio";
import type { AvailableTracks } from "../audio/types";
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
      const picked = await host.pickFile({ title: "Add audio", filters: AUDIO_FILTERS });
      if (!picked) return;
      setAdding(true);
      const media = await host.importMedia("audio", picked);
      const decoded = await decodeCached(host, media.url);
      const lengthMs = media.durationMs ?? decoded?.durationMs ?? 0;
      if (!(lengthMs > 0)) throw new Error("The file has no readable audio.");
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
      host.documentUpdate("Add audio", { audio: next });
    } catch (err) {
      setError(`Couldn't add audio. ${errorMessage(err, "")}`.trim());
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
      onChange={(next) => host.documentUpdate("Audio settings", { audio: next }, "audio-settings")}
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
