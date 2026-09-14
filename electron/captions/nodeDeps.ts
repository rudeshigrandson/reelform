import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";
import type { DownloadFs, FetchLike, Hasher } from "./download";
import type { TranscribeFs } from "./transcribe";

/**
 * Node implementations of the injected download/transcribe ports. Electron-free
 * so the resume path can be exercised against a real HTTP server in vitest.
 */

export const nodeDownloadFs: DownloadFs = {
  async size(path) {
    try {
      const st = await fsp.stat(path);
      return st.isFile() ? st.size : null;
    } catch {
      return null;
    }
  },
  async *readChunks(path) {
    for await (const chunk of createReadStream(path)) {
      yield chunk as Uint8Array;
    }
  },
  async openWriter(path, { append }) {
    const handle = await fsp.open(path, append ? "a" : "w");
    return {
      write: async (chunk) => {
        // FileHandle.write may write fewer bytes than asked; loop until done.
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (bytesWritten <= 0) throw new Error("write returned 0 bytes");
          offset += bytesWritten;
        }
      },
      close: () => handle.close(),
    };
  },
  rename: (from, to) => fsp.rename(from, to),
  unlink: (path) => fsp.unlink(path),
};

export const nodeTranscribeFs: TranscribeFs = {
  mkdtemp: (prefix) => fsp.mkdtemp(prefix),
  rm: (path) => fsp.rm(path, { recursive: true, force: true }),
  readText: (path) => fsp.readFile(path, "utf8"),
  exists: async (path) => {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  },
};

export function nodeSha256(): Hasher {
  const h = createHash("sha256");
  return {
    update: (chunk) => {
      h.update(chunk);
    },
    digest: () => h.digest("hex"),
  };
}

/** Adapts global `fetch` (Node 18+/Electron) to {@link FetchLike}. */
export const nodeFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, {
    headers: init.headers,
    signal: init.signal ?? null,
    redirect: "follow",
  });
  return {
    status: res.status,
    headers: res.headers,
    // Web ReadableStream is async-iterable in Node/Electron.
    body: res.body as unknown as AsyncIterable<Uint8Array> | null,
  };
};
