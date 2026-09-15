import { type ReactElement, useCallback, useEffect, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import { parseSidecar, serializeSidecar } from "../../captions/sidecar";
import { usePlaybackStore } from "../../playback";
import { useEditorStore } from "../../store";
import { CaptionsInspector } from "../captions";
import type { GenerationStatus } from "../captions/types";
import { fileNameOf } from "./audioPeaks";
import {
  NOTHING_TO_TRANSCRIBE_MESSAGE,
  NO_AUDIO_MESSAGE,
  NO_SPEECH_MESSAGE,
  captionsErrorMessage,
  mapTranscribedCaptions,
  modelIdForTier,
  pickAudioCandidate,
  sidecarFileName,
  statusFromProgress,
} from "./captionsFlow";
import { hostId } from "./hooks";
import { deriveTranscribeRanges, timelineClips, toIpcRanges } from "./timeMap";
import type { InspectorHost } from "./types";

/** Captions tab wired to `captions:*` (guide S18, SPEC §9.6). */

const setStatus = (captionStatus: GenerationStatus) =>
  useEditorStore.getState().update({ captionStatus });

export function CaptionsTab({ host }: { host: InspectorHost }): ReactElement {
  const e = useEditorStore();
  const currentMs = usePlaybackStore((p) => p.currentMs);
  const seek = usePlaybackStore((p) => p.seek);
  const meta = useProjectSession((s) => s.meta);
  const projectPath = useProjectSession((s) => s.projectPath);
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const modelId = modelIdForTier(e.captionModel);

  const refreshModels = useCallback(async () => {
    try {
      const models = await host.captions.models();
      setInstalled(new Set(models.filter((m) => m.installed).map((m) => m.id)));
    } catch {
      setInstalled(new Set());
    }
  }, [host]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const download = async () => {
    const id = modelId;
    setStatus({ kind: "downloading", progress: 0 });
    const off = host.captions.onProgress((ev) => {
      const s = statusFromProgress(ev, id);
      if (s) setStatus(s);
    });
    try {
      await host.captions.download(id);
      setStatus({ kind: "idle" });
      await refreshModels();
    } catch (err) {
      const msg = captionsErrorMessage(err, "download");
      setStatus(msg === "Cancelled." ? { kind: "idle" } : { kind: "error", message: msg });
    } finally {
      off();
    }
  };

  const generate = async () => {
    const candidate = pickAudioCandidate(meta, projectPath);
    if (!candidate) {
      setStatus({ kind: "error", message: NO_AUDIO_MESSAGE });
      return;
    }
    const state0 = useEditorStore.getState();
    const ranges = deriveTranscribeRanges(timelineClips(state0.clips, meta), state0.speedRegions);
    if (ranges.length === 0) {
      setStatus({ kind: "error", message: NOTHING_TO_TRANSCRIBE_MESSAGE });
      return;
    }
    const jobId = hostId("captions");
    const totalMs = ranges.reduce((s, r) => s + (r.endMs - r.startMs) / (r.rate ?? 1), 0);
    setStatus({ kind: "transcribing", progress: 0, doneMs: 0, totalMs });
    const off = host.captions.onProgress((ev) => {
      const s = statusFromProgress(ev, jobId);
      if (s) setStatus(s);
    });
    try {
      const state = useEditorStore.getState();
      const res = await host.captions.transcribe({
        jobId,
        audioPath: candidate.path,
        ranges: toIpcRanges(ranges),
        model: modelIdForTier(state.captionModel),
        language: state.captionLanguage,
      });
      const captions = mapTranscribedCaptions(res.captions, ranges);
      if (captions.length === 0) {
        setStatus({ kind: "error", message: NO_SPEECH_MESSAGE });
        return;
      }
      host.documentUpdate("Generate captions", { captions });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: captionsErrorMessage(err, "transcribe") });
    } finally {
      off();
    }
  };

  const exportSidecar = async (format: "srt" | "vtt") => {
    setNotice(null);
    try {
      const saved = await host.saveFile({
        title: `Export .${format}`,
        defaultName: sidecarFileName(meta?.name ?? "captions", format),
        filters: [{ name: format === "srt" ? "SubRip" : "WebVTT", extensions: [format] }],
        contents: serializeSidecar(useEditorStore.getState().captions, format),
      });
      if (saved) setNotice(`Saved ${fileNameOf(saved)}`);
    } catch (err) {
      setNotice(err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save the file.");
    }
  };

  const importSidecar = async () => {
    setNotice(null);
    try {
      const path = await host.pickFile({
        title: "Import captions",
        filters: [{ name: "Captions", extensions: ["srt", "vtt"] }],
      });
      if (!path) return;
      const text = await host.readTextFile(path);
      const parsed = parseSidecar(text, undefined, path);
      if (parsed.captions.length === 0) {
        setNotice("No captions found in that file.");
        return;
      }
      host.documentUpdate("Import captions", { captions: parsed.captions });
      setNotice(`Imported ${parsed.captions.length} captions`);
    } catch (err) {
      setNotice(
        err instanceof Error ? `Couldn't import: ${err.message}` : "Couldn't import the file.",
      );
    }
  };

  return (
    <CaptionsInspector
      captions={e.captions}
      onCaptionsChange={(captions) =>
        host.documentUpdate("Edit captions", { captions }, "captions-edit")
      }
      style={e.captionStyle}
      onStyleChange={(captionStyle) =>
        host.documentUpdate("Caption style", { captionStyle }, "caption-style")
      }
      status={e.captionStatus}
      modelDownloaded={installed.has(modelId)}
      model={e.captionModel}
      onModelChange={(captionModel) => host.documentUpdate("Caption model", { captionModel })}
      language={e.captionLanguage}
      onLanguageChange={(captionLanguage) =>
        host.documentUpdate("Caption language", { captionLanguage })
      }
      onGenerate={() => void generate()}
      onDownloadModel={() => void download()}
      onCancelDownload={() => void host.captions.cancelDownload(modelId).catch(() => {})}
      onSeek={seek}
      currentMs={currentMs}
      durationMs={e.durationMs}
      burnIn={e.burnInCaptions}
      onBurnInChange={(burnInCaptions) =>
        host.documentUpdate("Burn in captions", { burnInCaptions })
      }
      onExportSrt={() => void exportSidecar("srt")}
      onExportVtt={() => void exportSidecar("vtt")}
      onImportSidecar={() => void importSidecar()}
      exportNotice={notice}
    />
  );
}
