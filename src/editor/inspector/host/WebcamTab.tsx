import { type ReactElement, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import type { ProjectMeta } from "../../persistence";
import { useEditorStore } from "../../store";
import { detectFaceCenter } from "../../webcam/faceDetect";
import { WebcamInspector } from "../webcam";
import { clampSyncOffset } from "../webcam/logic";
import type { WebcamSource } from "../webcam/types";
import { fileNameOf } from "./audioPeaks";
import { decodeCached, errorMessage } from "./hooks";
import type { ImportedMedia, InspectorHost } from "./types";
import { toMono } from "./webcamSync";
import { estimateSyncOffsetOffThread } from "./webcamSyncRunner";

/** Webcam tab: upload / replace / remove via `importMedia`, audio auto-sync (guide S16, SPEC §9.4). */

export const VIDEO_FILTERS = [{ name: "Video", extensions: ["mp4", "mov", "webm", "m4v", "mkv"] }];

/** Label source: files imported through the inspector live under `media/imported/`. */
export function webcamSourceFor(meta: Pick<ProjectMeta, "sources"> | null): WebcamSource | null {
  const cam = meta?.sources.webcam;
  if (!cam) return null;
  return cam.path.includes("imported/")
    ? { kind: "uploaded", name: fileNameOf(cam.path) }
    : { kind: "recorded", durationMs: cam.durationMs };
}

export function withWebcamSource(meta: ProjectMeta, media: ImportedMedia): ProjectMeta {
  return {
    ...meta,
    sources: {
      ...meta.sources,
      webcam: {
        path: media.path,
        durationMs: media.durationMs ?? 0,
        width: media.width ?? 1280,
        height: media.height ?? 720,
        fps: meta.sources.webcam?.fps ?? 30,
        codec: meta.sources.webcam?.codec ?? "unknown",
        hasAudio: media.hasAudio,
      },
    },
  };
}

export function withoutWebcamSource(meta: ProjectMeta): ProjectMeta {
  const { webcam: _removed, ...sources } = meta.sources;
  return { ...meta, sources };
}

export interface WebcamTabProps {
  host: InspectorHost;
  /** Face detector for "Center on face" (tests inject one). */
  detectFace?: ((webcamUrl: string) => Promise<{ x: number; y: number } | null>) | undefined;
}

export function WebcamTab({ host, detectFace = detectFaceCenter }: WebcamTabProps): ReactElement {
  const webcam = useEditorStore((s) => s.webcam);
  const meta = useProjectSession((s) => s.meta);
  const webcamUrl = useProjectSession((s) => s.webcamUrl);
  const micUrl = useProjectSession((s) => s.micUrl);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const importWebcam = async (label: string) => {
    setNotice(null);
    try {
      const picked = await host.pickFile({ title: label, filters: VIDEO_FILTERS });
      if (!picked) return;
      const media = await host.importMedia("webcam", picked);
      host.metaUpdate(label, (m) => withWebcamSource(m, media), {
        webcam: { ...useEditorStore.getState().webcam, enabled: true, crop: null, syncOffsetMs: 0 },
      });
      useProjectSession.getState().setSession({ webcamUrl: media.url });
    } catch (err) {
      setNotice(`Couldn't add the webcam video. ${errorMessage(err, "")}`.trim());
    }
  };

  const remove = () => {
    setNotice(null);
    host.metaUpdate("Remove webcam", withoutWebcamSource);
    useProjectSession.getState().setSession({ webcamUrl: null });
  };

  const autoSync = async () => {
    if (!webcamUrl || !micUrl) {
      setNotice("Auto-sync needs audio in both the webcam video and the microphone track.");
      return;
    }
    setSyncing(true);
    setNotice(null);
    try {
      const [mic, cam] = await Promise.all([
        decodeCached(host, micUrl),
        decodeCached(host, webcamUrl),
      ]);
      if (!mic || !cam) {
        setNotice("Auto-sync needs audio in both the webcam video and the microphone track.");
        return;
      }
      const result = await estimateSyncOffsetOffThread(
        { samples: toMono(mic.channels), sampleRate: mic.sampleRate },
        { samples: toMono(cam.channels), sampleRate: cam.sampleRate },
      );
      if (!result) {
        setNotice("Couldn't find a match — adjust the offset by hand.");
        return;
      }
      const syncOffsetMs = clampSyncOffset(result.offsetMs);
      host.documentUpdate("Auto-sync webcam", {
        webcam: { ...useEditorStore.getState().webcam, syncOffsetMs },
      });
      setNotice(`Synced (${syncOffsetMs > 0 ? "+" : ""}${syncOffsetMs} ms)`);
    } catch (err) {
      setNotice(`Couldn't auto-sync. ${errorMessage(err, "")}`.trim());
    } finally {
      setSyncing(false);
    }
  };

  const source = webcamSourceFor(meta);
  const cam = meta?.sources.webcam;
  return (
    <WebcamInspector
      value={webcam}
      onChange={(next) =>
        host.documentUpdate("Webcam settings", { webcam: next }, "webcam-settings")
      }
      source={source}
      sourceSize={cam ? { width: cam.width, height: cam.height } : undefined}
      onUpload={() => void importWebcam("Add webcam video")}
      onReplace={() => void importWebcam("Replace webcam video")}
      onRemove={remove}
      onAutoSync={() => void autoSync()}
      syncing={syncing}
      syncNotice={notice}
      onCenterOnFace={webcamUrl ? () => detectFace(webcamUrl) : undefined}
    />
  );
}
