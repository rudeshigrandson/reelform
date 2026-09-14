import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CaptionsProgressSchema, captionsContracts, captionsEvents } from "./contracts";
import type { CaptionsProgress } from "./contracts";
import { partialPathFor } from "./download";
import { type CaptionsDeps, DOWNLOAD_EMIT_BYTES, createCaptionsHandlers } from "./handlers";
import { type ModelSpec, findModel } from "./models";
import { MemFs, argAfter, bytes, fakeServer, fakeSpawn, realHasher } from "./testUtils";

const fixture = readFileSync(new URL("./__fixtures__/whisper-full.json", import.meta.url), "utf8");
const MODELS = "/userData/models";
const payload = bytes(30_000);

function setup(opts: { whisper?: string | null; gate?: Promise<void> } = {}) {
  const fs = new MemFs();
  const events: CaptionsProgress[] = [];
  const server = fakeServer({ data: payload, chunkSize: 1000 });
  const gatedFetch: CaptionsDeps["fetch"] = async (url, init) => {
    await opts.gate;
    return server.fetch(url, init);
  };
  const { spawn } = fakeSpawn((args, child) => {
    fs.writeText(`${argAfter(args, "-of")}.json`, fixture);
    child.emit("close", 0, null);
  });
  const deps: CaptionsDeps = {
    modelsDir: MODELS,
    join: (...p) => p.join("/"),
    isAbsolute: (p) => p.startsWith("/"),
    mkdirp: async (d) => void fs.dirs.add(d),
    fetch: gatedFetch,
    downloadFs: fs,
    // Real catalog hashes can't match fake bytes: tests patch the catalog entry via withFakeHash.
    createHash: realHasher,
    allowUnverified: true,
    resolveWhisperBinary: () => (opts.whisper === undefined ? "/bin/whisper-cli" : opts.whisper),
    emit: (e) => events.push(e),
    fs,
    tempPrefix: "/tmp/cap-",
    spawn,
    extractWav: async (req) => {
      fs.writeText(req.output, "RIFF");
      return { durationMs: 7200 };
    },
    splitter: { detectSilences: async () => [], cut: async () => undefined },
  };
  return { fs, deps, events, server, handlers: createCaptionsHandlers(deps) };
}

/** Temporarily point a catalog entry at the fake payload's hash. */
function withFakeHash<T>(model: ModelSpec, sha: string | null, fn: () => Promise<T>): Promise<T> {
  const original = model.sha256;
  model.sha256 = sha;
  return fn().finally(() => {
    model.sha256 = original;
  });
}

const tiny = findModel("tiny.en-q5_1");
if (!tiny) throw new Error("catalog missing tiny");

describe("captions contracts", () => {
  it("channel names match their keys and use the captions domain", () => {
    for (const [key, ch] of Object.entries(captionsContracts)) {
      expect(ch.name).toBe(key);
      expect(key.startsWith("captions:")).toBe(true);
    }
    expect(Object.keys(captionsContracts).sort()).toEqual([
      "captions:cancelDownload",
      "captions:download",
      "captions:models",
      "captions:transcribe",
    ]);
    expect(captionsEvents["captions:progress"].name).toBe("captions:progress");
  });

  it("validates transcribe requests", () => {
    const req = captionsContracts["captions:transcribe"].request;
    const ok = {
      jobId: "j",
      audio: { path: "/a.m4a" },
      ranges: [{ startMs: 0, endMs: 10 }],
      model: "base-q5_1",
    };
    expect(req.safeParse(ok).success).toBe(true);
    expect(req.safeParse({ ...ok, language: "auto" }).success).toBe(true);
    expect(req.safeParse({ ...ok, language: "English" }).success).toBe(false);
    expect(req.safeParse({ ...ok, ranges: [] }).success).toBe(false);
    expect(req.safeParse({ ...ok, ranges: [{ startMs: 10, endMs: 10 }] }).success).toBe(false);
    expect(req.safeParse({ ...ok, ranges: [{ startMs: 10, endMs: 5 }] }).success).toBe(false);
    expect(req.safeParse({ ...ok, ranges: [{ startMs: 0, endMs: 5, rate: 0 }] }).success).toBe(
      false,
    );
    expect(req.safeParse({ ...ok, model: "large" }).success).toBe(false);
  });
});

describe("createCaptionsHandlers", () => {
  it("lists models with install and partial state", async () => {
    const s = setup();
    s.fs.writeText(`${MODELS}/ggml-small-q5_1.bin`, "x");
    s.fs.files.set(partialPathFor(`${MODELS}/ggml-medium-q5_0.bin`), bytes(1234));
    const models = await s.handlers["captions:models"]();
    expect(captionsContracts["captions:models"].response.parse(models)).toEqual(models);
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    expect(byId["small-q5_1"]).toMatchObject({
      installed: true,
      partialBytes: 0,
      tier: "balanced",
      displaySize: "190 MB",
    });
    expect(byId["medium-q5_0"]).toMatchObject({ installed: false, partialBytes: 1234 });
    expect(byId["tiny.en-q5_1"]).toMatchObject({ installed: false, downloading: false });
  });

  it("downloads into userData/models, emits valid throttled progress, dedupes concurrent calls", async () => {
    const s = setup();
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(payload).digest("hex");
    await withFakeHash(tiny, sha, async () => {
      const [a, b] = await Promise.all([
        s.handlers["captions:download"]({ model: "tiny.en-q5_1" }),
        s.handlers["captions:download"]({ model: "tiny.en-q5_1" }),
      ]);
      expect(a).toEqual({
        model: "tiny.en-q5_1",
        path: `${MODELS}/ggml-tiny.en-q5_1.bin`,
        verified: true,
        alreadyInstalled: false,
      });
      expect(b).toEqual(a);
    });
    expect(s.server.requests).toHaveLength(1);
    expect(s.fs.dirs.has(MODELS)).toBe(true);
    expect(s.events.length).toBeGreaterThan(2);
    for (const e of s.events) expect(CaptionsProgressSchema.safeParse(e).success).toBe(true);
    expect(s.events.at(-1)).toMatchObject({
      kind: "download",
      taskId: "tiny.en-q5_1",
      progress: 1,
    });

    const again = await s.handlers["captions:download"]({ model: "tiny.en-q5_1" });
    expect(again.alreadyInstalled).toBe(true);
    expect(s.server.requests).toHaveLength(1);
  });

  it("throttles by bytes when the server sends no length", async () => {
    const s = setup();
    const big = bytes(3 * DOWNLOAD_EMIT_BYTES + 10);
    const server = fakeServer({ data: big, chunkSize: 64 * 1024 });
    s.deps.fetch = async (url, init) => {
      const res = await server.fetch(url, init);
      return { ...res, headers: { get: () => null } };
    };
    const handlers = createCaptionsHandlers(s.deps);
    await withFakeHash(tiny, null, () => handlers["captions:download"]({ model: "tiny.en-q5_1" }));
    const received = s.events.map((e) => (e.kind === "download" ? e.receivedBytes : -1));
    // First event plus one per MiB: not one per 64 KiB chunk, and not stuck at the first.
    expect(received[0]).toBe(0);
    expect(received.length).toBeGreaterThanOrEqual(4);
    expect(received.length).toBeLessThanOrEqual(5);
    for (const e of s.events) expect(e).toMatchObject({ totalBytes: null, progress: null });
  });

  it("alreadyInstalled reports verified only when the catalog pins a sha256", async () => {
    const s = setup();
    s.fs.writeText(`${MODELS}/ggml-tiny.en-q5_1.bin`, "x");
    expect(await s.handlers["captions:download"]({ model: "tiny.en-q5_1" })).toMatchObject({
      alreadyInstalled: true,
      verified: true,
    });
    await withFakeHash(tiny, null, async () => {
      expect(await s.handlers["captions:download"]({ model: "tiny.en-q5_1" })).toMatchObject({
        alreadyInstalled: true,
        verified: false,
      });
    });
    expect(s.server.requests).toHaveLength(0);
  });

  it("cancelDownload aborts and keeps the partial; next download resumes", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const s = setup({ gate });
    s.fs.files.set(partialPathFor(`${MODELS}/ggml-tiny.en-q5_1.bin`), payload.slice(0, 5000));
    await withFakeHash(tiny, null, async () => {
      const pending = s.handlers["captions:download"]({ model: "tiny.en-q5_1" });
      await Promise.resolve();
      const models = await s.handlers["captions:models"]();
      expect(models.find((m) => m.id === "tiny.en-q5_1")?.downloading).toBe(true);
      const cancel = s.handlers["captions:cancelDownload"]({ model: "tiny.en-q5_1" });
      release();
      await expect(pending).rejects.toMatchObject({ code: "cancelled" });
      expect(await cancel).toEqual({ cancelled: true });
      expect(s.fs.files.get(partialPathFor(`${MODELS}/ggml-tiny.en-q5_1.bin`))?.byteLength).toBe(
        5000,
      );
      expect(await s.handlers["captions:cancelDownload"]({ model: "tiny.en-q5_1" })).toEqual({
        cancelled: false,
      });

      const res = await s.handlers["captions:download"]({ model: "tiny.en-q5_1" });
      expect(res.verified).toBe(false);
      expect(s.server.requests.at(-1)).toEqual({ Range: "bytes=5000-" });
    });
  });

  it("transcribes with progress events tagged by jobId", async () => {
    const s = setup();
    s.fs.writeText(`${MODELS}/ggml-base-q5_1.bin`, "ggml");
    const res = await s.handlers["captions:transcribe"]({
      jobId: "job-1",
      audio: { path: "/p/mic.m4a" },
      ranges: [{ startMs: 0, endMs: 7200 }],
      model: "base-q5_1",
    });
    expect(captionsContracts["captions:transcribe"].response.parse(res)).toBeTruthy();
    expect(res.captions).toHaveLength(2);
    const tagged = s.events.filter((e) => e.kind === "transcribe");
    expect(tagged.length).toBeGreaterThan(0);
    for (const e of tagged) {
      expect(e.taskId).toBe("job-1");
      expect(CaptionsProgressSchema.safeParse(e).success).toBe(true);
    }
  });

  it("errors: unknown model, missing runtime, relative audio path, missing model", async () => {
    const s = setup({ whisper: null });
    const base = { jobId: "j", audio: { path: "/a.m4a" }, ranges: [{ startMs: 0, endMs: 1 }] };
    await expect(
      s.handlers["captions:download"]({ model: "large" as never }),
    ).rejects.toMatchObject({ code: "unknown-model" });
    await expect(
      s.handlers["captions:transcribe"]({ ...base, model: "base-q5_1" }),
    ).rejects.toMatchObject({ code: "runtime-not-found" });
    const t = setup();
    await expect(
      t.handlers["captions:transcribe"]({
        ...base,
        audio: { path: "rel.m4a" },
        model: "base-q5_1",
      }),
    ).rejects.toMatchObject({ code: "extract-failed" });
    await expect(
      t.handlers["captions:transcribe"]({ ...base, model: "base-q5_1" }),
    ).rejects.toMatchObject({ code: "model-not-installed" });
  });
});
