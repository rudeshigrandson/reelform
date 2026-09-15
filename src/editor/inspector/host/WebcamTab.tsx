import { type ReactElement, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import type { ProjectMeta } from "../../persistence";
import { useEditorStore } from "../../store";
import { detectFaceCenter } from "../../webcam/faceDetect";
import { type InspectorMessageKey, useInspectorT, withDetail } from "../i18n";
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
  const t = useInspectorT();
  const webcam = useEditorStore((s) => s.webcam);
  const meta = useProjectSession((s) => s.meta);
  const webcamUrl = useProjectSession((s) => s.webcamUrl);
  const micUrl = useProjectSession((s) => s.micUrl);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const importWebcam = async (labelKey: InspectorMessageKey) => {
    setNotice(null);
    const label = t(labelKey);
    try {
      const picked = await host.pickFile({ title: label, filters: VIDEO_FILTERS });
      if (!picked) return;
      const media = await host.importMedia("webcam", picked);
      host.metaUpdate(label, (m) => withWebcamSource(m, media), {
        webcam: { ...useEditorStore.getState().webcam, enabled: true, crop: null, syncOffsetMs: 0 },
      });
      useProjectSession.getState().setSession({ webcamUrl: media.url });
    } catch (err) {
      setNotice(withDetail(t, "inspector.webcam.error.add", errorMessage(err, "")));
    }
  };

  const remove = () => {
    setNotice(null);
    host.metaUpdate(t("inspector.webcam.removeWebcam"), withoutWebcamSource);
    useProjectSession.getState().setSession({ webcamUrl: null });
  };

  const autoSync = async () => {
    if (!webcamUrl || !micUrl) {
      setNotice(t("inspector.webcam.sync.needsAudio"));
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
        setNotice(t("inspector.webcam.sync.needsAudio"));
        return;
      }
      const result = await estimateSyncOffsetOffThread(
        { samples: toMono(mic.channels), sampleRate: mic.sampleRate },
        { samples: toMono(cam.channels), sampleRate: cam.sampleRate },
      );
      if (!result) {
        setNotice(t("inspector.webcam.sync.noMatch"));
        return;
      }
      const syncOffsetMs = clampSyncOffset(result.offsetMs);
      host.documentUpdate(t("inspector.webcam.history.autoSync"), {
        webcam: { ...useEditorStore.getState().webcam, syncOffsetMs },
      });
      setNotice(
        t("inspector.webcam.sync.done", {
          offset: `${syncOffsetMs > 0 ? "+" : ""}${syncOffsetMs}`,
        }),
      );
    } catch (err) {
      setNotice(withDetail(t, "inspector.webcam.error.sync", errorMessage(err, "")));
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
        host.documentUpdate(t("inspector.webcam.settings"), { webcam: next }, "webcam-settings")
      }
      source={source}
      sourceSize={cam ? { width: cam.width, height: cam.height } : undefined}
      onUpload={() => void importWebcam("inspector.webcam.addVideo")}
      onReplace={() => void importWebcam("inspector.webcam.replaceVideo")}
      onRemove={remove}
      onAutoSync={() => void autoSync()}
      syncing={syncing}
      syncNotice={notice}
      onCenterOnFace={webcamUrl ? () => detectFace(webcamUrl) : undefined}
    />
  );
}
