import { z } from "zod";

/**
 * Typed message protocol between the GIF encoder client (renderer main thread)
 * and `gif.worker.ts`.
 *
 * client → worker: init, sample*, addFrame*, finish | cancel
 * worker → client: progress (per frame), chunk (file bytes, in order), done, error
 *
 * Frame pixels travel as a transferred RGBA `ArrayBuffer` (ImageData.data.buffer).
 */

export const gifEncoderOptionsSchema = z.object({
  width: z.number().int().min(1).max(65_535),
  height: z.number().int().min(1).max(65_535),
  fps: z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30)]),
  colors: z.number().int().min(2).max(256),
  dither: z.enum(["none", "bayer4", "bayer8", "floyd-steinberg"]),
  loop: z.boolean(),
  adaptivePalette: z.boolean().optional(),
  frameDiff: z.boolean().optional(),
  alpha: z.boolean().optional(),
  totalFrames: z.number().int().min(0).optional(),
});

const frameFields = {
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  buffer: z.instanceof(ArrayBuffer),
};

export const gifWorkerRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), options: gifEncoderOptionsSchema }),
  z.object({ type: z.literal("sample"), ...frameFields }),
  z.object({ type: z.literal("addFrame"), index: z.number().int().min(0), ...frameFields }),
  z.object({ type: z.literal("finish") }),
  z.object({ type: z.literal("cancel") }),
]);

export type GifWorkerRequest = z.infer<typeof gifWorkerRequestSchema>;

export interface GifProgressMessage {
  type: "progress";
  /** Index of the frame that just finished encoding. */
  frameIndex: number;
  framesEncoded: number;
  totalFrames: number | null;
  /** Bytes already delivered via `chunk` messages. */
  bytesWritten: number;
  /** Extrapolated final size (null until 2 frames encoded or total unknown). */
  estimatedBytes: number | null;
  /** Estimate is based on ≥ 2s of frames. */
  estimateSettled: boolean;
}

export interface GifChunkMessage {
  type: "chunk";
  bytes: ArrayBuffer;
}

export interface GifDoneMessage {
  type: "done";
  totalBytes: number;
  frames: number;
}

export interface GifErrorMessage {
  type: "error";
  message: string;
}

export type GifWorkerResponse =
  | GifProgressMessage
  | GifChunkMessage
  | GifDoneMessage
  | GifErrorMessage;
