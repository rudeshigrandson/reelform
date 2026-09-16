import { z } from "zod";
import type { Channel } from "../ipc/contracts";

/**
 * Export file sink channels (ENGINEERING_SPEC §3 `export:*`, §10.1/§10.7):
 * the renderer muxer streams bytes to a temp file in the destination folder,
 * then `export:finish` renames it to a unique final name.
 *
 * Merge into `electron/ipc/contracts.ts` by spreading `exportContracts`.
 */

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

/**
 * Only the fields the sink needs; the full `ExportConfig` (src/export) passes
 * through untouched.
 */
export const ExportSinkConfig = z
  .object({
    /** Absolute destination folder; defaults to the project's `exports/`. */
    destinationDir: z.string().min(1).optional(),
  })
  .passthrough();

const isBinary = (v: unknown): v is ArrayBuffer | Uint8Array =>
  v instanceof ArrayBuffer ||
  v instanceof Uint8Array ||
  Object.prototype.toString.call(v) === "[object ArrayBuffer]";

/** Chunk bytes: `ArrayBuffer` from the renderer (Uint8Array/Buffer also accepted). */
export const ChunkBytes = z.custom<ArrayBuffer | Uint8Array>(isBinary, {
  message: "chunk must be an ArrayBuffer or Uint8Array",
});

export const exportContracts = {
  "export:begin": channel(
    "export:begin",
    z.object({ projectId: z.string().min(1), config: ExportSinkConfig }),
    z.object({ exportId: z.string(), tempPath: z.string() }),
  ),
  "export:writeChunk": channel(
    "export:writeChunk",
    z.object({
      exportId: z.string().min(1),
      chunk: ChunkBytes,
      /** Absolute byte offset (MP4 moov/mdat rewrite). Omitted → append after the furthest byte written. */
      position: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    z.object({ bytesWritten: z.number(), size: z.number() }),
  ),
  "export:finish": channel(
    "export:finish",
    z.object({ exportId: z.string().min(1), finalName: z.string().min(1) }),
    z.object({ path: z.string() }),
  ),
  "export:cancel": channel(
    "export:cancel",
    z.object({ exportId: z.string().min(1) }),
    z.object({ cancelled: z.boolean() }),
  ),
  /**
   * PCM WAV fallback (§10.1/§10.5): mux the WAV into the finished silent video
   * as AAC (mp4) or Opus (webm), replace the video in place, delete the WAV.
   * Fails with FFMPEG_UNAVAILABLE when no ffmpeg binary is found.
   */
  "export:muxAudio": channel(
    "export:muxAudio",
    z.object({
      videoPath: z.string().min(1).max(4096),
      wavPath: z.string().min(1).max(4096),
      container: z.enum(["mp4", "webm"]),
    }),
    z.object({
      ok: z.literal(true),
      outputPath: z.string(),
      /** Size of the muxed video on disk. */
      bytes: z.number().int().nonnegative().optional(),
    }),
  ),
} as const;

export type ExportContracts = typeof exportContracts;

export type ExportHandlers = {
  [K in keyof ExportContracts]: (
    req: z.infer<ExportContracts[K]["request"]>,
  ) => Promise<z.infer<ExportContracts[K]["response"]>>;
};
