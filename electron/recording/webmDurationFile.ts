import { WEBM_HEAD_BYTES, patchWebmDuration } from "../../src/recording/webmDuration";

/**
 * Apply the pure WebM duration patcher to a file on disk (§5.2), so a
 * MediaRecorder track that is never remuxed is still seekable. An existing
 * Duration is overwritten in place; otherwise the head grows by one element
 * and the file is rewritten (head + the unchanged rest) through `ops`.
 */

export interface WebmFileOps {
  /** Up to `maxBytes` from the start of the file. */
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
  /** Overwrite the first `bytes.length` bytes without truncating. */
  writeHead(path: string, bytes: Uint8Array): Promise<void>;
  /** Replace the first `replacedBytes` bytes with `head`, keeping the rest of the file. */
  replaceHead(path: string, replacedBytes: number, head: Uint8Array): Promise<void>;
}

/** `true` when the file now declares `durationMs`; `false` when it is not a patchable WebM. */
export async function fixWebmDurationFile(
  ops: WebmFileOps,
  path: string,
  durationMs: number,
): Promise<boolean> {
  const head = await ops.readHead(path, WEBM_HEAD_BYTES);
  const patch = patchWebmDuration(head, durationMs);
  if (!patch) return false;
  if (patch.inPlace) await ops.writeHead(path, patch.head);
  else await ops.replaceHead(path, patch.replacedBytes, patch.head);
  return true;
}
