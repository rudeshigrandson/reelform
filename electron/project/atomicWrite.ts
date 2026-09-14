import * as path from "node:path";
import type { FsLike } from "./fsTypes";

/**
 * Atomic replace (ENGINEERING_SPEC §4 "Save semantics"): write `<file>.tmp`,
 * fsync it, rename over the target, then best-effort fsync the directory so
 * the rename itself survives power loss. A failure at any step removes the
 * temp file and leaves the previous target untouched.
 */
export async function atomicWriteFile(
  fs: FsLike,
  filePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const tmp = `${filePath}.tmp`;
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await handle.write(
          bytes,
          offset,
          bytes.byteLength - offset,
          offset,
        );
        if (bytesWritten <= 0) throw new Error("Short write");
        offset += bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
  await syncDir(fs, path.dirname(filePath));
}

/** fsync a directory; unsupported on Windows (EPERM/EISDIR) so errors are ignored. */
async function syncDir(fs: FsLike, dir: string): Promise<void> {
  try {
    const h = await fs.open(dir, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  } catch {
    // Directory fsync is advisory.
  }
}
