import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadFile, partialPathFor } from "./download";
import { isCaptionsError } from "./errors";
import { nodeDownloadFs, nodeFetch, nodeSha256, nodeTranscribeFs } from "./nodeDeps";
import { bytes, sha256Hex } from "./testUtils";

/** Real HTTP server + real filesystem: exercises the Range resume path end to end. */

const data = Buffer.from(bytes(200_000, 3));
const sha = sha256Hex(data);
const rangeHeaders: (string | undefined)[] = [];
let baseUrl = "";
let dir = "";
const server = createServer((req, res) => {
  rangeHeaders.push(req.headers.range);
  if (req.url === "/redirect") {
    res.writeHead(302, { location: "/model.bin" }).end();
    return;
  }
  const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
  if (m?.[1] !== undefined) {
    const start = Number(m[1]);
    if (start >= data.length) {
      res.writeHead(416, { "content-range": `bytes */${data.length}` }).end();
      return;
    }
    res.writeHead(206, {
      "content-range": `bytes ${start}-${data.length - 1}/${data.length}`,
      "content-length": data.length - start,
    });
    res.end(data.subarray(start));
    return;
  }
  res.writeHead(200, { "content-length": data.length });
  res.end(data);
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), "reelform-captions-test-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const deps = () => ({ fetch: nodeFetch, fs: nodeDownloadFs, createHash: nodeSha256 });

describe("node deps against a real HTTP server", () => {
  it("resumes a partial file on disk via Range and installs a verified model", async () => {
    const dest = join(dir, "resume.bin");
    await writeFile(partialPathFor(dest), data.subarray(0, 65_536));
    rangeHeaders.length = 0;
    const res = await downloadFile(
      { url: `${baseUrl}/redirect`, destPath: dest, expectedSha256: sha },
      deps(),
    );
    expect(rangeHeaders).toContain("bytes=65536-");
    expect(res).toMatchObject({ verified: true, resumedFrom: 65_536 });
    expect(Buffer.compare(await readFile(dest), data)).toBe(0);
    await expect(stat(partialPathFor(dest))).rejects.toThrow();
  });

  it("deletes the partial on sha mismatch", async () => {
    const dest = join(dir, "bad.bin");
    try {
      await downloadFile(
        { url: `${baseUrl}/model.bin`, destPath: dest, expectedSha256: "f".repeat(64) },
        deps(),
      );
      expect.unreachable();
    } catch (err) {
      expect(isCaptionsError(err, "checksum-mismatch")).toBe(true);
    }
    expect(await nodeDownloadFs.size(partialPathFor(dest))).toBeNull();
    expect(await nodeTranscribeFs.exists(dest)).toBe(false);
  });

  it("transcribe fs helpers round-trip text and clean temp dirs", async () => {
    const tmp = await nodeTranscribeFs.mkdtemp(join(dir, "job-"));
    await writeFile(join(tmp, "a.json"), '{"ok":true}');
    expect(await nodeTranscribeFs.readText(join(tmp, "a.json"))).toBe('{"ok":true}');
    await nodeTranscribeFs.rm(tmp);
    expect(await nodeTranscribeFs.exists(tmp)).toBe(false);
  });
});
