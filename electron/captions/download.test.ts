import { describe, expect, it } from "vitest";
import { type DownloadProgress, downloadFile, parseContentRange, partialPathFor } from "./download";
import { isCaptionsError } from "./errors";
import { MemFs, bytes, fakeServer, realHasher, sha256Hex } from "./testUtils";

const DEST = "/models/ggml-tiny.en-q5_1.bin";
const PART = partialPathFor(DEST);
const URL_ = "https://example.test/model.bin";

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.unreachable("expected rejection");
  } catch (err) {
    expect(isCaptionsError(err) ? err.code : err).toBe(code);
  }
}

describe("parseContentRange", () => {
  it("parses valid headers and rejects junk", () => {
    expect(parseContentRange("bytes 10-99/100")).toEqual({ start: 10, end: 99, total: 100 });
    expect(parseContentRange("bytes 0-9/*")).toEqual({ start: 0, end: 9, total: null });
    expect(parseContentRange("bytes 9-1/100")).toBeNull();
    expect(parseContentRange("items 0-1/2")).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe("downloadFile", () => {
  const data = bytes(50_000);
  const sha = sha256Hex(data);

  it("downloads, verifies and renames the partial into place", async () => {
    const fs = new MemFs();
    const server = fakeServer({ data });
    const progress: DownloadProgress[] = [];
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: sha, onProgress: (p) => progress.push(p) },
      { fetch: server.fetch, fs, createHash: realHasher },
    );
    expect(res).toEqual({ path: DEST, sha256: sha, verified: true, resumedFrom: 0 });
    expect(fs.files.get(DEST)).toEqual(data);
    expect(fs.files.has(PART)).toBe(false);
    expect(server.requests[0]).toEqual({});
    expect(progress.at(-1)).toEqual({ receivedBytes: 50_000, totalBytes: 50_000, progress: 1 });
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]?.receivedBytes).toBeGreaterThanOrEqual(
        progress[i - 1]?.receivedBytes ?? 0,
      );
    }
  });

  it("resumes from the partial's byte offset with a Range request", async () => {
    const fs = new MemFs();
    fs.files.set(PART, data.slice(0, 12_345));
    const server = fakeServer({ data });
    const progress: DownloadProgress[] = [];
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: sha, onProgress: (p) => progress.push(p) },
      { fetch: server.fetch, fs, createHash: realHasher },
    );
    expect(server.requests[0]).toEqual({ Range: "bytes=12345-" });
    expect(res.resumedFrom).toBe(12_345);
    expect(res.verified).toBe(true);
    expect(fs.files.get(DEST)).toEqual(data);
    expect(progress[0]?.receivedBytes).toBe(12_345);
  });

  it("interrupted download keeps the partial, and the retry resumes to a verified file", async () => {
    const fs = new MemFs();
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        {
          fetch: fakeServer({ data, failAfter: 20_000, chunkSize: 5000 }).fetch,
          fs,
          createHash: realHasher,
        },
      ),
      "download-failed",
    );
    expect(fs.files.get(PART)?.byteLength).toBe(20_000);

    const retry = fakeServer({ data, chunkSize: 5000 });
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: sha },
      { fetch: retry.fetch, fs, createHash: realHasher },
    );
    expect(retry.requests[0]).toEqual({ Range: "bytes=20000-" });
    expect(res.resumedFrom).toBe(20_000);
    expect(fs.files.get(DEST)).toEqual(data);
  });

  it("truncated stream (connection closed early) keeps the partial", async () => {
    const fs = new MemFs();
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        { fetch: fakeServer({ data, cutAfter: 8192 }).fetch, fs, createHash: realHasher },
      ),
      "download-failed",
    );
    expect(fs.files.get(PART)?.byteLength).toBe(8192);
    expect(fs.files.has(DEST)).toBe(false);
  });

  it("sha mismatch deletes the partial and does not install", async () => {
    const fs = new MemFs();
    const wrong = "0".repeat(64);
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: wrong },
        { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher },
      ),
      "checksum-mismatch",
    );
    expect(fs.files.has(PART)).toBe(false);
    expect(fs.files.has(DEST)).toBe(false);
  });

  it("sha mismatch after resuming a corrupt partial deletes it", async () => {
    const fs = new MemFs();
    const corrupt = data.slice(0, 10_000);
    corrupt[5] = (corrupt[5] ?? 0) ^ 0xff;
    fs.files.set(PART, corrupt);
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher },
      ),
      "checksum-mismatch",
    );
    expect(fs.files.has(PART)).toBe(false);
  });

  it("restarts from zero when the server ignores Range", async () => {
    const fs = new MemFs();
    fs.files.set(PART, bytes(777, 99));
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: sha },
      { fetch: fakeServer({ data, ignoreRange: true }).fetch, fs, createHash: realHasher },
    );
    expect(res.resumedFrom).toBe(0);
    expect(fs.files.get(DEST)).toEqual(data);
  });

  it("416 with a complete partial verifies and installs without a body", async () => {
    const fs = new MemFs();
    fs.files.set(PART, data.slice());
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: sha },
      { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher },
    );
    expect(res).toMatchObject({ verified: true, resumedFrom: 50_000 });
    expect(fs.files.get(DEST)).toEqual(data);
  });

  it("rejects a 206 whose range does not start at the offset", async () => {
    const fs = new MemFs();
    fs.files.set(PART, data.slice(0, 100));
    const fetch = fakeServer({ data }).fetch;
    const lying: typeof fetch = (url, init) =>
      fetch(url, { ...init, headers: { Range: "bytes=50-" } });
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        { fetch: lying, fs, createHash: realHasher },
      ),
      "download-failed",
    );
  });

  it("maps HTTP errors and network failures to download-failed", async () => {
    const fs = new MemFs();
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        { fetch: fakeServer({ data, status: 404 }).fetch, fs, createHash: realHasher },
      ),
      "download-failed",
    );
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        {
          fetch: async () => {
            throw new TypeError("fetch failed");
          },
          fs,
          createHash: realHasher,
        },
      ),
      "download-failed",
    );
  });

  it("releases the unread body of an error response", async () => {
    let released = false;
    async function* body(): AsyncGenerator<Uint8Array> {
      try {
        yield new Uint8Array([1]);
      } finally {
        released = true;
      }
    }
    const it404 = body();
    // Start the generator so `return()` runs its finally block.
    await it404.next();
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        {
          fetch: async () => ({ status: 404, headers: { get: () => null }, body: it404 }),
          fs: new MemFs(),
          createHash: realHasher,
        },
      ),
      "download-failed",
    );
    expect(released).toBe(true);
  });

  it("maps a failure while re-hashing the partial to download-failed", async () => {
    const fs = new MemFs();
    fs.files.set(PART, data.slice(0, 1000));
    fs.readChunks = async function* () {
      yield new Uint8Array(0);
      throw new Error("EIO");
    };
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha },
        { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher },
      ),
      "download-failed",
    );
    // The partial is kept: the failure was local, not a checksum problem.
    expect(fs.files.get(PART)?.byteLength).toBe(1000);
  });

  it("cancel mid-stream keeps the partial for a later resume", async () => {
    const fs = new MemFs();
    const controller = new AbortController();
    const server = fakeServer({
      data,
      chunkSize: 1000,
      onChunk: (sent) => {
        if (sent >= 3000) controller.abort();
      },
    });
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha, signal: controller.signal },
        { fetch: server.fetch, fs, createHash: realHasher },
      ),
      "cancelled",
    );
    expect(fs.files.get(PART)?.byteLength).toBe(3000);
    expect(fs.files.has(DEST)).toBe(false);
  });

  it("an already-aborted signal does nothing", async () => {
    const fs = new MemFs();
    const server = fakeServer({ data });
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: sha, signal: AbortSignal.abort() },
        { fetch: server.fetch, fs, createHash: realHasher },
      ),
      "cancelled",
    );
    expect(server.requests).toHaveLength(0);
  });

  it("requires a checksum unless unverified installs are allowed", async () => {
    const fs = new MemFs();
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: null },
        { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher },
      ),
      "checksum-unavailable",
    );
    const res = await downloadFile(
      { url: URL_, destPath: DEST, expectedSha256: null },
      { fetch: fakeServer({ data }).fetch, fs, createHash: realHasher, allowUnverified: true },
    );
    expect(res).toMatchObject({ verified: false, sha256: sha });
  });

  it("rejects a malformed expected hash", async () => {
    await expectCode(
      downloadFile(
        { url: URL_, destPath: DEST, expectedSha256: "abc" },
        { fetch: fakeServer({ data }).fetch, fs: new MemFs(), createHash: realHasher },
      ),
      "download-failed",
    );
  });
});
