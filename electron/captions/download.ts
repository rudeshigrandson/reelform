import { CaptionsError } from "./errors";
import { isSha256Hex } from "./models";

/**
 * Resumable model download (ENGINEERING_SPEC §9.6).
 *
 * Bytes stream into `<dest>.part`. A later attempt resumes from the partial
 * file's size with an HTTP `Range` request; the sha256 covers the partial bytes
 * already on disk plus the new ones. On success the partial is renamed over
 * `dest`; on checksum mismatch it is deleted; on cancel it is kept so the next
 * attempt resumes. Network, filesystem and hashing are injected.
 */

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal | undefined },
) => Promise<FetchResponseLike>;

export interface FileWriter {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface DownloadFs {
  /** Byte size of the file, or null when it does not exist. */
  size(path: string): Promise<number | null>;
  /** Stream a file's bytes (used to re-hash a partial before resuming). */
  readChunks(path: string): AsyncIterable<Uint8Array>;
  /** Open for writing; `append: false` truncates. Creates the file if missing. */
  openWriter(path: string, opts: { append: boolean }): Promise<FileWriter>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface Hasher {
  update(chunk: Uint8Array): void;
  /** Lower-case hex digest. */
  digest(): string;
}

export interface DownloadDeps {
  fetch: FetchLike;
  fs: DownloadFs;
  createHash(): Hasher;
  /** Install even when no expected sha256 is known. Default false. */
  allowUnverified?: boolean | undefined;
}

export interface DownloadProgress {
  receivedBytes: number;
  /** Null when the server did not disclose a length. */
  totalBytes: number | null;
  /** 0–1, or null when the total is unknown. */
  progress: number | null;
}

export interface DownloadRequest {
  url: string;
  destPath: string;
  /** Expected lower-case hex sha256; null → unverified (needs `allowUnverified`). */
  expectedSha256: string | null;
  signal?: AbortSignal | undefined;
  onProgress?: ((p: DownloadProgress) => void) | undefined;
}

export interface DownloadResult {
  path: string;
  sha256: string;
  verified: boolean;
  /** Bytes that were already on disk before this attempt (resume offset). */
  resumedFrom: number;
}

export const partialPathFor = (destPath: string): string => `${destPath}.part`;

/** Parse `bytes <start>-<end>/<total|*>`. */
export function parseContentRange(
  header: string | null,
): { start: number; end: number; total: number | null } | null {
  if (header === null) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === "*" ? null : Number(m[3]);
  if (end < start) return null;
  return { start, end, total };
}

function parseLength(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === "AbortError";
}

const cancelled = (): CaptionsError => new CaptionsError("cancelled", "Download cancelled");

/** Release a response body we will not read, so the connection is not held open. */
async function discardBody(response: FetchResponseLike): Promise<void> {
  const body = response.body;
  if (body === null) return;
  try {
    await body[Symbol.asyncIterator]().return?.();
  } catch {
    // Best effort: the body is being thrown away anyway.
  }
}

/** Feed an existing partial file into the hasher; fs errors become `download-failed`. */
async function hashPartial(fs: DownloadFs, path: string, hasher: Hasher): Promise<void> {
  try {
    for await (const chunk of fs.readChunks(path)) hasher.update(chunk);
  } catch (err) {
    throw new CaptionsError("download-failed", "Could not read the partial download", {
      cause: String(err),
    });
  }
}

export async function downloadFile(
  req: DownloadRequest,
  deps: DownloadDeps,
): Promise<DownloadResult> {
  const expected = req.expectedSha256?.toLowerCase() ?? null;
  if (expected !== null && !isSha256Hex(expected)) {
    throw new CaptionsError("download-failed", "Expected sha256 is not a 64-char hex digest");
  }
  if (expected === null && !deps.allowUnverified) {
    throw new CaptionsError("checksum-unavailable", "No checksum known for this download");
  }
  if (req.signal?.aborted) throw cancelled();

  const part = partialPathFor(req.destPath);
  let offset = (await deps.fs.size(part)) ?? 0;
  let resumedFrom = offset;
  const hasher = deps.createHash();

  const verifyAndInstall = async (): Promise<DownloadResult> => {
    const actual = hasher.digest().toLowerCase();
    if (expected !== null && actual !== expected) {
      await deps.fs.unlink(part).catch(() => undefined);
      throw new CaptionsError("checksum-mismatch", "Downloaded file failed sha256 verification", {
        expected,
        actual,
      });
    }
    await deps.fs.rename(part, req.destPath);
    return { path: req.destPath, sha256: actual, verified: expected !== null, resumedFrom };
  };

  let response: FetchResponseLike;
  try {
    const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    response = await deps.fetch(req.url, { headers, signal: req.signal });
  } catch (err) {
    if (isAbort(err, req.signal)) throw cancelled();
    throw new CaptionsError("download-failed", "Network request failed", { cause: String(err) });
  }

  let append: boolean;
  let totalBytes: number | null;
  if (offset > 0 && response.status === 206) {
    const range = parseContentRange(response.headers.get("content-range"));
    if (range === null || range.start !== offset) {
      await discardBody(response);
      throw new CaptionsError("download-failed", "Server returned an unexpected byte range", {
        offset,
        contentRange: response.headers.get("content-range"),
      });
    }
    append = true;
    totalBytes = range.total;
  } else if (offset > 0 && response.status === 416) {
    // Range not satisfiable: the partial already holds every byte. Verify it.
    await discardBody(response);
    await hashPartial(deps.fs, part, hasher);
    return verifyAndInstall();
  } else if (response.status === 200) {
    // Fresh download, or a server that ignored Range: restart from zero.
    append = false;
    offset = 0;
    resumedFrom = 0;
    totalBytes = parseLength(response.headers.get("content-length"));
  } else {
    await discardBody(response);
    throw new CaptionsError("download-failed", `HTTP ${response.status}`, {
      status: response.status,
    });
  }

  if (append) {
    try {
      await hashPartial(deps.fs, part, hasher);
    } catch (err) {
      await discardBody(response);
      throw err;
    }
  }

  const writer = await deps.fs.openWriter(part, { append });
  let received = offset;
  const report = (): void => {
    req.onProgress?.({
      receivedBytes: received,
      totalBytes,
      progress: totalBytes ? Math.min(1, received / totalBytes) : null,
    });
  };
  try {
    report();
    if (response.body !== null) {
      for await (const chunk of response.body) {
        if (req.signal?.aborted) throw cancelled();
        await writer.write(chunk);
        hasher.update(chunk);
        received += chunk.byteLength;
        report();
      }
    }
    if (req.signal?.aborted) throw cancelled();
  } catch (err) {
    await writer.close().catch(() => undefined);
    if (err instanceof CaptionsError) throw err;
    if (isAbort(err, req.signal)) throw cancelled();
    throw new CaptionsError("download-failed", "Download interrupted", { cause: String(err) });
  }
  await writer.close();

  if (totalBytes !== null && received !== totalBytes) {
    // Truncated stream: keep the partial so a retry resumes.
    throw new CaptionsError("download-failed", "Download ended early", { received, totalBytes });
  }
  return verifyAndInstall();
}
