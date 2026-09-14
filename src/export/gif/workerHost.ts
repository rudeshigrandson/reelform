import { GifEncoder } from "./encoder";
import { type GifWorkerResponse, gifWorkerRequestSchema } from "./protocol";

/**
 * Worker-side message handler, independent of the Worker global so it can be
 * tested in node. `gif.worker.ts` wires it to `self`.
 */

export type GifWorkerPost = (message: GifWorkerResponse, transfer: ArrayBuffer[]) => void;

export interface GifWorkerHost {
  handle(message: unknown): void;
}

export function createGifWorkerHost(post: GifWorkerPost): GifWorkerHost {
  let encoder: GifEncoder | null = null;
  let totalFrames: number | null = null;
  let closed = false;

  const emit = (chunks: Uint8Array[]): void => {
    for (const c of chunks) {
      // `toBytes()` chunks own their buffer exactly, so it can be transferred.
      const buf =
        c.byteOffset === 0 && c.byteLength === c.buffer.byteLength ? c.buffer : c.slice().buffer;
      post({ type: "chunk", bytes: buf as ArrayBuffer }, [buf as ArrayBuffer]);
    }
  };

  const fail = (err: unknown): void => {
    closed = true;
    encoder = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }, []);
  };

  const frameOf = (m: { width: number; height: number; buffer: ArrayBuffer }) => ({
    width: m.width,
    height: m.height,
    data: new Uint8Array(m.buffer),
  });

  return {
    handle(raw) {
      if (closed) return;
      const parsed = gifWorkerRequestSchema.safeParse(raw);
      if (!parsed.success) {
        fail(
          new Error(`invalid GIF worker message: ${parsed.error.issues[0]?.message ?? "unknown"}`),
        );
        return;
      }
      const msg = parsed.data;
      try {
        switch (msg.type) {
          case "init":
            if (encoder) throw new Error("GIF worker already initialised");
            encoder = new GifEncoder(msg.options);
            totalFrames = msg.options.totalFrames ?? null;
            return;
          case "cancel":
            closed = true;
            encoder = null;
            return;
          case "sample":
            requireEncoder(encoder).addSample(frameOf(msg));
            return;
          case "addFrame": {
            const enc = requireEncoder(encoder);
            emit(enc.addFrame(frameOf(msg)));
            const est = enc.estimate();
            post(
              {
                type: "progress",
                frameIndex: msg.index,
                framesEncoded: enc.framesAdded,
                totalFrames,
                bytesWritten: enc.bytesEmitted,
                estimatedBytes: est?.estimatedBytes ?? null,
                estimateSettled: est?.settled ?? false,
              },
              [],
            );
            return;
          }
          case "finish": {
            const enc = requireEncoder(encoder);
            emit(enc.finish());
            closed = true;
            post({ type: "done", totalBytes: enc.bytesEmitted, frames: enc.framesAdded }, []);
            return;
          }
        }
      } catch (err) {
        fail(err);
      }
    },
  };
}

function requireEncoder(encoder: GifEncoder | null): GifEncoder {
  if (!encoder) throw new Error("GIF worker not initialised");
  return encoder;
}
