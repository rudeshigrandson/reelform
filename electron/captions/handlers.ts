import type { z } from "zod";
import type { CaptionsContracts, CaptionsProgress } from "./contracts";
import {
  type DownloadFs,
  type FetchLike,
  type Hasher,
  downloadFile,
  partialPathFor,
} from "./download";
import { CaptionsError } from "./errors";
import { MODEL_CATALOG, type ModelId, type ModelSpec, findModel } from "./models";
import { type TranscribeDeps, transcribe } from "./transcribe";

/**
 * IPC handlers for the captions domain. Pure factory: network, filesystem,
 * hashing, process spawning, audio extraction and event emission come in
 * through {@link CaptionsDeps}.
 */

export interface CaptionsDeps extends TranscribeDeps {
  /** `userData/models`. */
  modelsDir: string;
  isAbsolute(p: string): boolean;
  mkdirp(path: string): Promise<void>;
  fetch: FetchLike;
  downloadFs: DownloadFs;
  createHash(): Hasher;
  allowUnverified?: boolean | undefined;
  /** Resolved lazily so a missing runtime only fails transcription. */
  resolveWhisperBinary(): string | null;
  emit(event: CaptionsProgress): void;
}

export type CaptionsHandlers = {
  [K in keyof CaptionsContracts]: (
    req: z.infer<CaptionsContracts[K]["request"]>,
  ) => Promise<z.infer<CaptionsContracts[K]["response"]>>;
};

/** Emit a download event only when progress moved by at least this much. */
const DOWNLOAD_EMIT_STEP = 0.005;
/** When the server gives no length, emit every this many bytes instead. */
export const DOWNLOAD_EMIT_BYTES = 1024 * 1024;

type DownloadResponse = Awaited<ReturnType<CaptionsHandlers["captions:download"]>>;

export function createCaptionsHandlers(deps: CaptionsDeps): CaptionsHandlers {
  const inFlight = new Map<
    ModelId,
    { controller: AbortController; promise: Promise<DownloadResponse> }
  >();

  const requireModel = (id: string): ModelSpec => {
    const spec = findModel(id);
    if (!spec) throw new CaptionsError("unknown-model", `Unknown model: ${id}`);
    return spec;
  };
  const modelPath = (spec: ModelSpec): string => deps.join(deps.modelsDir, spec.fileName);

  const startDownload = (spec: ModelSpec): Promise<DownloadResponse> => {
    const controller = new AbortController();
    const dest = modelPath(spec);
    let lastEmitted = -1;
    let lastEmittedBytes = -1;
    const run = async (): Promise<DownloadResponse> => {
      await deps.mkdirp(deps.modelsDir);
      const result = await downloadFile(
        {
          url: spec.url,
          destPath: dest,
          expectedSha256: spec.sha256,
          signal: controller.signal,
          onProgress: (p) => {
            const done = p.totalBytes !== null && p.receivedBytes >= p.totalBytes;
            const first = lastEmittedBytes < 0;
            const moved =
              p.progress !== null
                ? p.progress - lastEmitted >= DOWNLOAD_EMIT_STEP
                : p.receivedBytes - lastEmittedBytes >= DOWNLOAD_EMIT_BYTES;
            if (!done && !first && !moved) return;
            lastEmitted = p.progress ?? 0;
            lastEmittedBytes = p.receivedBytes;
            deps.emit({ kind: "download", taskId: spec.id, ...p });
          },
        },
        {
          fetch: deps.fetch,
          fs: deps.downloadFs,
          createHash: deps.createHash,
          allowUnverified: deps.allowUnverified,
        },
      );
      return {
        model: spec.id,
        path: result.path,
        verified: result.verified,
        alreadyInstalled: false,
      };
    };
    const promise = run().finally(() => inFlight.delete(spec.id));
    inFlight.set(spec.id, { controller, promise });
    return promise;
  };

  return {
    "captions:models": async () =>
      Promise.all(
        MODEL_CATALOG.map(async (spec) => {
          const dest = modelPath(spec);
          const installed = await deps.fs.exists(dest);
          const partialBytes = installed
            ? 0
            : ((await deps.downloadFs.size(partialPathFor(dest))) ?? 0);
          return {
            id: spec.id,
            tier: spec.tier,
            label: spec.label,
            displaySize: spec.displaySize,
            sizeBytes: spec.sizeBytes,
            installed,
            partialBytes,
            downloading: inFlight.has(spec.id),
          };
        }),
      ),

    "captions:download": async ({ model }) => {
      const spec = requireModel(model);
      const existing = inFlight.get(spec.id);
      if (existing) return existing.promise;
      if (await deps.fs.exists(modelPath(spec))) {
        // Files only land at the final path after verification, so this is
        // verified exactly when the catalog pins a checksum.
        return {
          model: spec.id,
          path: modelPath(spec),
          verified: spec.sha256 !== null,
          alreadyInstalled: true,
        };
      }
      // A concurrent call may have started the download while we awaited `exists`.
      return inFlight.get(spec.id)?.promise ?? startDownload(spec);
    },

    "captions:cancelDownload": async ({ model }) => {
      const job = inFlight.get(model);
      if (!job) return { cancelled: false };
      job.controller.abort();
      await job.promise.catch(() => undefined);
      return { cancelled: true };
    },

    "captions:transcribe": async ({ jobId, audio, ranges, model, language }) => {
      const spec = requireModel(model);
      if (!deps.isAbsolute(audio.path)) {
        throw new CaptionsError("extract-failed", "Audio path must be absolute");
      }
      const whisperBin = deps.resolveWhisperBinary();
      if (whisperBin === null) {
        throw new CaptionsError("runtime-not-found", "whisper-cli runtime is missing");
      }
      const result = await transcribe(
        {
          input: audio.path,
          ranges,
          model: spec,
          modelPath: modelPath(spec),
          whisperBin,
          language,
          onProgress: (p) => deps.emit({ kind: "transcribe", taskId: jobId, ...p }),
        },
        deps,
      );
      // Segmenter output is readonly; IPC payloads are plain mutable copies.
      return { ...result, captions: result.captions.map((c) => ({ ...c, words: [...c.words] })) };
    },
  };
}
