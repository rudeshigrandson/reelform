import { segmentCaptions } from "../../src/editor/captions/segment";
import type { Caption, Word } from "../../src/editor/captions/types";
import { MAX_CHUNK_MS, type TimeSpan, planChunks } from "./chunks";
import { CaptionsError } from "./errors";
import type { ModelSpec } from "./models";
import { type SpawnFn, buildWhisperArgs, runWhisper } from "./whisperCli";
import { parseWhisperJson } from "./whisperJson";

/**
 * Transcription pipeline (ENGINEERING_SPEC §9.6):
 * WAV of the timeline range (injected extractor) → silence split into ≤ 5 min
 * chunks (injected splitter) → whisper-cli `--output-json-full` per chunk →
 * parse words, offset by chunk start → segment into captions.
 */

/** A source range in timeline order; `rate` is the playback speed (default 1). */
export interface AudioRange {
  startMs: number;
  endMs: number;
  rate?: number | undefined;
}

/** Builds a 16 kHz mono WAV of `ranges` (media-ffmpeg module owns the args). */
export type WavExtractor = (req: {
  input: string;
  output: string;
  ranges: readonly AudioRange[];
  signal?: AbortSignal | undefined;
  onProgress?: ((fraction: number) => void) | undefined;
}) => Promise<{ durationMs: number }>;

export interface SilenceSplitter {
  /** Silent spans in the WAV, ms. */
  detectSilences(req: { wavPath: string; signal?: AbortSignal | undefined }): Promise<TimeSpan[]>;
  /** Write `[startMs, endMs)` of `input` to `output` as WAV. */
  cut(req: {
    input: string;
    output: string;
    startMs: number;
    endMs: number;
    signal?: AbortSignal | undefined;
  }): Promise<void>;
}

export interface TranscribeFs {
  mkdtemp(prefix: string): Promise<string>;
  rm(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface TranscribeDeps {
  join(...parts: string[]): string;
  fs: TranscribeFs;
  tempPrefix: string;
  spawn: SpawnFn;
  extractWav: WavExtractor;
  splitter: SilenceSplitter;
  threads?: number | undefined;
  maxChunkMs?: number | undefined;
}

export type TranscribeStage = "extracting" | "transcribing" | "segmenting";

export interface TranscribeProgress {
  stage: TranscribeStage;
  /** 0–1 over the whole job. */
  progress: number;
  /** Audio transcribed so far / total, ms. */
  doneMs: number;
  totalMs: number;
}

export interface TranscribeRequest {
  input: string;
  ranges: readonly AudioRange[];
  model: ModelSpec;
  modelPath: string;
  whisperBin: string;
  /** Whisper language code, or "auto" / undefined for detection. */
  language?: string | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((p: TranscribeProgress) => void) | undefined;
}

export interface TranscribeResult {
  captions: Caption[];
  language: string | null;
  durationMs: number;
}

/** Share of the progress bar spent on WAV extraction. */
export const EXTRACT_WEIGHT = 0.1;

/** §9.6 segmentation parameters. */
export const CAPTION_SEGMENT_OPTIONS = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDurationMs: 700,
  pauseSplitMs: 350,
} as const;

export function effectiveLanguage(model: ModelSpec, language: string | undefined): string {
  if (model.englishOnly) return "en";
  return language && language.length > 0 ? language : "auto";
}

const cancelled = (): CaptionsError => new CaptionsError("cancelled", "Transcription cancelled");

async function wrapStep<T>(
  code: "extract-failed" | "split-failed",
  message: string,
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CaptionsError) throw err;
    if (signal?.aborted) throw cancelled();
    throw new CaptionsError(code, message, { cause: String(err) });
  }
}

export async function transcribe(
  req: TranscribeRequest,
  deps: TranscribeDeps,
): Promise<TranscribeResult> {
  const { signal } = req;
  const checkAbort = (): void => {
    if (signal?.aborted) throw cancelled();
  };
  checkAbort();
  if (!(await deps.fs.exists(req.modelPath))) {
    throw new CaptionsError("model-not-installed", `Model ${req.model.id} is not downloaded`);
  }

  let totalMs = 0;
  const emit = (stage: TranscribeStage, progress: number, doneMs: number): void =>
    req.onProgress?.({ stage, progress: Math.min(1, Math.max(0, progress)), doneMs, totalMs });

  const tmp = await deps.fs.mkdtemp(deps.tempPrefix);
  try {
    const wavPath = deps.join(tmp, "audio.wav");
    emit("extracting", 0, 0);
    const { durationMs } = await wrapStep("extract-failed", "Audio extraction failed", signal, () =>
      deps.extractWav({
        input: req.input,
        output: wavPath,
        ranges: req.ranges,
        signal,
        onProgress: (f) => emit("extracting", EXTRACT_WEIGHT * f, 0),
      }),
    );
    checkAbort();
    totalMs = durationMs;
    if (!(durationMs > 0)) throw new CaptionsError("no-speech", "No audio in the selected range");

    const maxChunkMs = deps.maxChunkMs ?? MAX_CHUNK_MS;
    const silences =
      durationMs > maxChunkMs
        ? await wrapStep("split-failed", "Silence detection failed", signal, () =>
            deps.splitter.detectSilences({ wavPath, signal }),
          )
        : [];
    const chunks = planChunks(durationMs, silences, maxChunkMs);
    const language = effectiveLanguage(req.model, req.language);

    const words: Word[] = [];
    let detected: string | null = null;
    emit("transcribing", EXTRACT_WEIGHT, 0);
    for (const [i, chunk] of chunks.entries()) {
      checkAbort();
      let chunkWav = wavPath;
      if (chunks.length > 1) {
        chunkWav = deps.join(tmp, `chunk-${i}.wav`);
        await wrapStep("split-failed", "Could not cut audio chunk", signal, () =>
          deps.splitter.cut({
            input: wavPath,
            output: chunkWav,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            signal,
          }),
        );
      }
      const outBase = deps.join(tmp, `chunk-${i}`);
      const span = chunk.endMs - chunk.startMs;
      await runWhisper(deps.spawn, {
        bin: req.whisperBin,
        args: buildWhisperArgs({
          modelPath: req.modelPath,
          wavPath: chunkWav,
          outBase,
          language,
          threads: deps.threads,
        }),
        signal,
        onProgress: (f) => {
          const doneMs = chunk.startMs + span * f;
          emit(
            "transcribing",
            EXTRACT_WEIGHT + (1 - EXTRACT_WEIGHT) * (doneMs / durationMs),
            doneMs,
          );
        },
      });
      let json: string;
      try {
        json = await deps.fs.readText(`${outBase}.json`);
      } catch (err) {
        throw new CaptionsError("whisper-output-invalid", "whisper-cli produced no JSON output", {
          cause: String(err),
        });
      }
      const parsed = parseWhisperJson(json, chunk.startMs);
      detected ??= parsed.language;
      // Words past the chunk end would duplicate the next chunk's audio.
      for (const w of parsed.words) {
        if (w.t0 < chunk.endMs) words.push({ ...w, t1: Math.min(w.t1, chunk.endMs) });
      }
    }
    checkAbort();

    if (words.length === 0) throw new CaptionsError("no-speech", "No speech detected");
    emit("segmenting", 1, durationMs);
    const captions = segmentCaptions(words, CAPTION_SEGMENT_OPTIONS);
    return { captions, language: detected, durationMs };
  } finally {
    await deps.fs.rm(tmp).catch(() => undefined);
  }
}
