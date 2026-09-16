import { DEFAULT_MODEL_FOR_TIER, type ModelId } from "../../../../electron/captions/models";
import type { ProjectMeta } from "../../persistence";
import type { Caption, CaptionModel, GenerationStatus } from "../captions/types";
import { ti } from "../i18n";
import { absoluteSourcePath } from "./projectInfo";
import { type MappedRange, wavToTimelineMs } from "./timeMap";
import type { CaptionsProgressEvent, TranscribedCaption } from "./types";

/** Captions host glue (SPEC §9.6). Pure pieces; the tab wires them to the port. */

export function modelIdForTier(tier: CaptionModel): ModelId {
  return DEFAULT_MODEL_FOR_TIER[tier];
}

export interface AudioCandidate {
  role: "mic" | "system" | "video";
  path: string;
}

/** Mic preferred, else system, else the video's own audio; null when none. */
export function pickAudioCandidate(
  meta: Pick<ProjectMeta, "sources"> | null,
  projectPath: string | null,
): AudioCandidate | null {
  if (!meta) return null;
  const { mic, system, video } = meta.sources;
  const pick = mic
    ? { role: "mic" as const, rel: mic.path }
    : system
      ? { role: "system" as const, rel: system.path }
      : video.hasAudio
        ? { role: "video" as const, rel: video.path }
        : null;
  return pick ? { role: pick.role, path: absoluteSourcePath(projectPath, pick.rel) } : null;
}

/** Whisper output (WAV ms) → timeline captions. */
export function mapTranscribedCaptions(
  captions: readonly TranscribedCaption[],
  ranges: readonly MappedRange[],
): Caption[] {
  const map = (ms: number) => Math.round(wavToTimelineMs(ranges, ms));
  return captions
    .map((c) => {
      const startMs = map(c.startMs);
      const endMs = Math.max(startMs + 1, map(c.endMs));
      return {
        id: c.id,
        startMs,
        endMs,
        text: c.text,
        words: c.words.map((w) => ({ t0: map(w.t0), t1: map(w.t1), text: w.text })),
      };
    })
    .filter((c) => c.text.trim() !== "");
}

/** Status for a progress event belonging to `taskId`; null when it isn't ours. */
export function statusFromProgress(
  e: CaptionsProgressEvent,
  taskId: string,
): GenerationStatus | null {
  if (e.taskId !== taskId) return null;
  if (e.kind === "download") return { kind: "downloading", progress: e.progress ?? 0 };
  return { kind: "transcribing", progress: e.progress, doneMs: e.doneMs, totalMs: e.totalMs };
}

export const noSpeechMessage = (): string => ti("inspector.captions.error.noSpeech");
export const noAudioMessage = (): string => ti("inspector.captions.error.noAudio");
export const nothingToTranscribeMessage = (): string =>
  ti("inspector.captions.error.emptyTimeline");

/** True when a rejected captions call was cancelled by the user (not an error to show). */
export function isCaptionsCancel(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "cancelled" || code === "aborted";
}

/** Human message for a rejected captions call. */
export function captionsErrorMessage(err: unknown, action: "download" | "transcribe"): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "no-speech") return noSpeechMessage();
  if (isCaptionsCancel(err)) return ti("inspector.captions.error.cancelled");
  const detail = err instanceof Error && err.message ? err.message : "";
  return ti(
    action === "download"
      ? "inspector.captions.error.download"
      : "inspector.captions.error.transcribe",
    { detail },
  ).trim();
}

export function sidecarFileName(projectName: string, ext: "srt" | "vtt"): string {
  const base = projectName.replace(/[\\/:*?"<>|]+/g, " ").trim() || "captions";
  return `${base}.${ext}`;
}
