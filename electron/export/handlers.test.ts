import * as fsp from "node:fs/promises";
import * as path from "node:path";
import fc from "fast-check";
import { type SpawnCall, scriptedSpawn } from "../media/testUtils";
import { FsIpcError } from "../project/errors";
import { faultyFs, makeTmpDir, realFs, removeDir } from "../project/testHelpers";
import { exportContracts } from "./contracts";
import { type ExportDeps, createExportService, tempFileName } from "./handlers";

let tmp: string;
let exportsDir: string;
let idCounter: number;

const bytes = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

function makeService(overrides: Partial<ExportDeps> = {}) {
  return createExportService({
    fs: realFs,
    newId: () => `exp-${++idCounter}`,
    defaultExportDir: async (projectId) => path.join(tmp, `${projectId}.reelform`, "exports"),
    ...overrides,
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof FsIpcError ? e.code : `other:${String(e)}`;
  }
  return "resolved";
}

beforeEach(async () => {
  tmp = await makeTmpDir("reelform-export-");
  exportsDir = path.join(tmp, "proj.reelform", "exports");
  idCounter = 0;
});
afterEach(async () => {
  await removeDir(tmp);
});

describe("contracts", () => {
  it("names match keys; chunk accepts ArrayBuffer and Uint8Array only", () => {
    for (const [k, ch] of Object.entries(exportContracts)) expect(ch.name).toBe(k);
    const schema = exportContracts["export:writeChunk"].request;
    expect(schema.safeParse({ exportId: "a", chunk: new ArrayBuffer(2) }).success).toBe(true);
    expect(schema.safeParse({ exportId: "a", chunk: new Uint8Array(2), position: 0 }).success).toBe(
      true,
    );
    expect(schema.safeParse({ exportId: "a", chunk: "abc" }).success).toBe(false);
    expect(
      schema.safeParse({ exportId: "a", chunk: new ArrayBuffer(1), position: -1 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ exportId: "a", chunk: new ArrayBuffer(1), position: 1.5 }).success,
    ).toBe(false);
    const begin = exportContracts["export:begin"].request.parse({
      projectId: "p",
      config: { format: "mp4", fps: 60 },
    });
    expect(begin.config).toMatchObject({ format: "mp4", fps: 60 });
  });
});

describe("export sink", () => {
  it("streams appended chunks into a temp file then finishes to the final name", async () => {
    const svc = makeService();
    const h = svc.handlers;
    const { exportId, tempPath } = await h["export:begin"]({ projectId: "proj", config: {} });
    expect(tempPath).toBe(path.join(exportsDir, tempFileName(exportId)));
    expect(svc.openExportIds()).toEqual([exportId]);
    await h["export:writeChunk"]({ exportId, chunk: bytes("hello ") });
    const w = await h["export:writeChunk"]({ exportId, chunk: bytes("world") });
    expect(w).toEqual({ bytesWritten: 5, size: 11 });
    const { path: out } = await h["export:finish"]({ exportId, finalName: "Demo.mp4" });
    expect(out).toBe(path.join(exportsDir, "Demo.mp4"));
    expect(await fsp.readFile(out, "utf8")).toBe("hello world");
    expect(await fsp.readdir(exportsDir)).toEqual(["Demo.mp4"]);
    expect(svc.openExportIds()).toEqual([]);
  });

  it("positional writes patch earlier bytes (moov rewrite) and appends continue at the end", async () => {
    const h = makeService().handlers;
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("XXXXmdat-data") });
    await h["export:writeChunk"]({ exportId, chunk: bytes("moov"), position: 0 });
    await h["export:writeChunk"]({ exportId, chunk: bytes("!") });
    // Sparse write past the end extends the size.
    const far = await h["export:writeChunk"]({ exportId, chunk: bytes("Z"), position: 20 });
    expect(far.size).toBe(21);
    const { path: out } = await h["export:finish"]({ exportId, finalName: "a.mp4" });
    const buf = await fsp.readFile(out);
    expect(buf.subarray(0, 14).toString()).toBe("moovmdat-data!");
    expect(buf.length).toBe(21);
    expect(buf[20]).toBe("Z".charCodeAt(0));
  });

  it("concurrent un-awaited writes land in arrival order", async () => {
    const h = makeService().handlers;
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    const parts = Array.from({ length: 50 }, (_, i) => `${i},`);
    const pending = parts.map((p) => h["export:writeChunk"]({ exportId, chunk: bytes(p) }));
    const finished = h["export:finish"]({ exportId, finalName: "order.txt" });
    await Promise.all(pending);
    expect(await fsp.readFile((await finished).path, "utf8")).toBe(parts.join(""));
  });

  it("property: any sequence of positional/append writes matches an in-memory model", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            data: fc.uint8Array({ minLength: 1, maxLength: 16 }),
            position: fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        async (writes) => {
          const h = makeService().handlers;
          const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
          let model = new Uint8Array(0);
          let end = 0;
          for (const w of writes) {
            const pos = w.position ?? end;
            if (pos + w.data.length > model.length) {
              const next = new Uint8Array(pos + w.data.length);
              next.set(model);
              model = next;
            }
            model.set(w.data, pos);
            end = Math.max(end, pos + w.data.length);
            const r = await h["export:writeChunk"]({
              exportId,
              chunk: w.data,
              position: w.position,
            });
            expect(r.size).toBe(end);
          }
          const { path: out } = await h["export:finish"]({
            exportId,
            finalName: `p-${exportId}.bin`,
          });
          expect(new Uint8Array(await fsp.readFile(out))).toEqual(model);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("uniquifies the final name on collision", async () => {
    const h = makeService().handlers;
    await fsp.mkdir(exportsDir, { recursive: true });
    await fsp.writeFile(path.join(exportsDir, "name.mp4"), "old");
    await fsp.writeFile(path.join(exportsDir, "name (2).mp4"), "old2");
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("new") });
    const { path: out } = await h["export:finish"]({ exportId, finalName: "name.mp4" });
    expect(path.basename(out)).toBe("name (3).mp4");
    expect(await fsp.readFile(path.join(exportsDir, "name.mp4"), "utf8")).toBe("old");
  });

  it("honours config.destinationDir and sanitizes the final name to stay inside it", async () => {
    const dest = path.join(tmp, "Desktop", "out");
    const h = makeService().handlers;
    const { exportId, tempPath } = await h["export:begin"]({
      projectId: "proj",
      config: { destinationDir: dest },
    });
    expect(path.dirname(tempPath)).toBe(dest);
    const { path: out } = await h["export:finish"]({ exportId, finalName: "../../evil/clip.gif" });
    expect(path.dirname(out)).toBe(dest);
    expect(
      await codeOf(
        h["export:begin"]({ projectId: "p", config: { destinationDir: "relative/dir" } }),
      ),
    ).toBe("INVALID_PATH");
  });

  it("an unusable final name is rejected without killing the export", async () => {
    const h = makeService().handlers;
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("abc") });
    expect(await codeOf(h["export:finish"]({ exportId, finalName: ".." }))).toBe("INVALID_NAME");
    await h["export:writeChunk"]({ exportId, chunk: bytes("d") });
    const { path: out } = await h["export:finish"]({ exportId, finalName: "ok.mp4" });
    expect(await fsp.readFile(out, "utf8")).toBe("abcd");
  });

  it("finish is idempotent (sequential and concurrent)", async () => {
    const h = makeService().handlers;
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("x") });
    const [a, b] = await Promise.all([
      h["export:finish"]({ exportId, finalName: "same.mp4" }),
      h["export:finish"]({ exportId, finalName: "same.mp4" }),
    ]);
    const c = await h["export:finish"]({ exportId, finalName: "different.mp4" });
    expect(a.path).toBe(b.path);
    expect(c.path).toBe(a.path);
    expect(await fsp.readdir(exportsDir)).toEqual(["same.mp4"]);
    expect(await codeOf(h["export:writeChunk"]({ exportId, chunk: bytes("late") }))).toBe(
      "EXPORT_CLOSED",
    );
    expect(await h["export:cancel"]({ exportId })).toEqual({ cancelled: false });
    expect(await fsp.readFile(a.path, "utf8")).toBe("x");
  });

  it("cancel deletes the temp, is idempotent, and blocks later writes/finish", async () => {
    const h = makeService().handlers;
    const { exportId, tempPath } = await h["export:begin"]({ projectId: "proj", config: {} });
    const pending = h["export:writeChunk"]({ exportId, chunk: bytes("partial") });
    const [c1, c2] = await Promise.all([
      h["export:cancel"]({ exportId }),
      h["export:cancel"]({ exportId }),
    ]);
    await pending;
    expect([c1.cancelled, c2.cancelled].sort()).toEqual([false, true]);
    await expect(fsp.access(tempPath)).rejects.toThrow();
    expect(await h["export:cancel"]({ exportId })).toEqual({ cancelled: false });
    expect(await codeOf(h["export:writeChunk"]({ exportId, chunk: bytes("x") }))).toBe(
      "EXPORT_CANCELLED",
    );
    expect(await codeOf(h["export:finish"]({ exportId, finalName: "a.mp4" }))).toBe(
      "EXPORT_CANCELLED",
    );
    expect(await fsp.readdir(exportsDir)).toEqual([]);
  });

  it("finish racing a cancel resolves to one consistent outcome", async () => {
    const h = makeService().handlers;
    const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
    const fin = h["export:finish"]({ exportId, finalName: "race.mp4" });
    const can = await h["export:cancel"]({ exportId });
    expect(can.cancelled).toBe(false);
    expect(await fsp.readdir(exportsDir)).toEqual([path.basename((await fin).path)]);
  });

  it("unknown export ids fail with EXPORT_NOT_FOUND on every verb", async () => {
    const h = makeService().handlers;
    const exportId = "never-begun";
    expect(await codeOf(h["export:writeChunk"]({ exportId, chunk: bytes("x") }))).toBe(
      "EXPORT_NOT_FOUND",
    );
    expect(await codeOf(h["export:finish"]({ exportId, finalName: "a" }))).toBe("EXPORT_NOT_FOUND");
    const err = await h["export:cancel"]({ exportId }).catch((e: unknown) => e);
    expect((err as FsIpcError).toIpcError()).toEqual({
      code: "EXPORT_NOT_FOUND",
      message: "Unknown export",
      details: { exportId },
    });
  });

  it("a write failure (disk full) surfaces EXPORT_WRITE_FAILED and finish cleans up", async () => {
    let failNext = false;
    const fs = faultyFs({
      open: (async (p: string, flags: string) => {
        const handle = await fsp.open(p, flags);
        const write = handle.write.bind(handle) as (...a: unknown[]) => Promise<unknown>;
        (handle as unknown as { write: unknown }).write = async (...args: unknown[]) => {
          if (failNext) throw Object.assign(new Error("no space"), { code: "ENOSPC" });
          return write(...args);
        };
        return handle;
      }) as typeof fsp.open,
    });
    const h = makeService({ fs }).handlers;
    const { exportId, tempPath } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("ok") });
    failNext = true;
    const err = await h["export:writeChunk"]({ exportId, chunk: bytes("boom") }).catch(
      (e: unknown) => e,
    );
    expect((err as FsIpcError).toIpcError()).toMatchObject({
      code: "EXPORT_WRITE_FAILED",
      details: { errno: "ENOSPC" },
    });
    failNext = false;
    expect(await codeOf(h["export:writeChunk"]({ exportId, chunk: bytes("more") }))).toBe(
      "EXPORT_WRITE_FAILED",
    );
    expect(await codeOf(h["export:finish"]({ exportId, finalName: "x.mp4" }))).toBe(
      "EXPORT_WRITE_FAILED",
    );
    await expect(fsp.access(tempPath)).rejects.toThrow();
    expect(await codeOf(h["export:finish"]({ exportId, finalName: "x.mp4" }))).toBe(
      "EXPORT_WRITE_FAILED",
    );
    expect(await h["export:cancel"]({ exportId })).toEqual({ cancelled: false });
  });

  it("a failed rename on finish removes the temp and reports EXPORT_WRITE_FAILED", async () => {
    const fs = faultyFs({
      rename: async () => {
        throw Object.assign(new Error("xdev"), { code: "EXDEV" });
      },
    });
    const h = makeService({ fs }).handlers;
    const { exportId, tempPath } = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:writeChunk"]({ exportId, chunk: bytes("x") });
    expect(await codeOf(h["export:finish"]({ exportId, finalName: "x.mp4" }))).toBe(
      "EXPORT_WRITE_FAILED",
    );
    await expect(fsp.access(tempPath)).rejects.toThrow();
  });

  it("cancelAll closes every open export and deletes their temps", async () => {
    const svc = makeService();
    const h = svc.handlers;
    const a = await h["export:begin"]({ projectId: "proj", config: {} });
    const b = await h["export:begin"]({ projectId: "proj", config: {} });
    const c = await h["export:begin"]({ projectId: "proj", config: {} });
    await h["export:finish"]({ exportId: c.exportId, finalName: "kept.mp4" });
    await svc.cancelAll();
    expect(svc.openExportIds()).toEqual([]);
    expect(await fsp.readdir(exportsDir)).toEqual(["kept.mp4"]);
    expect(await codeOf(h["export:writeChunk"]({ exportId: a.exportId, chunk: bytes("x") }))).toBe(
      "EXPORT_CANCELLED",
    );
    expect(b.exportId).not.toBe(a.exportId);
  });

  it("rejects an unsafe or duplicate id from newId", async () => {
    const bad = makeService({ newId: () => "../../x" }).handlers;
    await expect(bad["export:begin"]({ projectId: "p", config: {} })).rejects.toThrow(
      "unusable id",
    );
    const dup = makeService({ newId: () => "same" }).handlers;
    await dup["export:begin"]({ projectId: "proj", config: {} });
    await expect(dup["export:begin"]({ projectId: "proj", config: {} })).rejects.toThrow(
      "unusable id",
    );
  });
});

describe("export:muxAudio", () => {
  const ok = (call: SpawnCall) => call.child.close(0);
  const bins = () => ({ ffmpeg: "/ff", ffprobe: "/fp" });

  /** Video + WAV finalized through this service's sink, like the renderer runner does. */
  async function fixture(svc: ReturnType<typeof makeService>, container: "mp4" | "webm" = "mp4") {
    const finished = async (finalName: string, body: string) => {
      const h = svc.handlers;
      const { exportId } = await h["export:begin"]({ projectId: "proj", config: {} });
      await h["export:writeChunk"]({ exportId, chunk: bytes(body) });
      return (await h["export:finish"]({ exportId, finalName })).path;
    };
    const videoPath = await finished(`Demo.${container}`, "silent-video");
    const wavPath = await finished("Demo.wav", "pcm");
    return { dir: exportsDir, videoPath, wavPath };
  }

  /** Fake ffmpeg: writes the output file named by the last arg, then exits. */
  const writingSpawn = (exit = 0) =>
    scriptedSpawn((call) => {
      const out = call.args.at(-1) ?? "";
      void fsp.writeFile(out, "muxed").then(() => call.child.close(exit));
    });

  it("muxes into a temp file, renames over the video and deletes the WAV", async () => {
    const { spawn, calls } = writingSpawn();
    const svc = makeService({ ffmpeg: { runner: { spawn }, resolveBinaries: bins } });
    const { videoPath, wavPath, dir } = await fixture(svc);
    const res = await svc.handlers["export:muxAudio"]({ videoPath, wavPath, container: "mp4" });
    expect(res).toEqual({ ok: true, outputPath: videoPath });
    expect(exportContracts["export:muxAudio"].response.parse(res)).toEqual(res);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/ff");
    const args = calls[0]?.args ?? [];
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 4)).toEqual([
      "-i",
      videoPath,
      "-i",
      wavPath,
    ]);
    expect(args).toContain("aac");
    expect(path.dirname(args.at(-1) ?? "")).toBe(dir);
    expect(path.basename(args.at(-1) ?? "")).toMatch(/^\.reelform-mux-exp-\d+\.partial\.mp4$/);
    expect(await fsp.readFile(videoPath, "utf8")).toBe("muxed");
    expect(await fsp.readdir(dir)).toEqual(["Demo.mp4"]);
    // The WAV export is consumed: a second mux is refused before ffmpeg runs.
    await fsp.writeFile(wavPath, "pcm");
    expect(
      await codeOf(svc.handlers["export:muxAudio"]({ videoPath, wavPath, container: "mp4" })),
    ).toBe("MUX_INVALID_INPUT");
    expect(calls).toHaveLength(1);
  });

  it("uses libopus for webm", async () => {
    const { spawn, calls } = writingSpawn();
    const svc = makeService({ ffmpeg: { runner: { spawn }, resolveBinaries: bins } });
    const { videoPath, wavPath } = await fixture(svc, "webm");
    await svc.handlers["export:muxAudio"]({ videoPath, wavPath, container: "webm" });
    expect(calls[0]?.args).toContain("libopus");
  });

  it("FFMPEG_UNAVAILABLE without ffmpeg; the files stay put", async () => {
    const plain = makeService();
    const a = await fixture(plain);
    expect(await codeOf(plain.handlers["export:muxAudio"]({ ...a, container: "mp4" }))).toBe(
      "FFMPEG_UNAVAILABLE",
    );
    await removeDir(exportsDir);
    const noBins = makeService({
      ffmpeg: { runner: { spawn: scriptedSpawn(ok).spawn }, resolveBinaries: () => null },
    });
    const b = await fixture(noBins);
    expect(await codeOf(noBins.handlers["export:muxAudio"]({ ...b, container: "mp4" }))).toBe(
      "FFMPEG_UNAVAILABLE",
    );
    expect(await fsp.readFile(b.wavPath, "utf8")).toBe("pcm");
  });

  it("an ffmpeg failure removes the temp file and keeps video + WAV", async () => {
    const { spawn } = writingSpawn(1);
    const svc = makeService({ ffmpeg: { runner: { spawn }, resolveBinaries: bins } });
    const { videoPath, wavPath, dir } = await fixture(svc);
    expect(
      await codeOf(svc.handlers["export:muxAudio"]({ videoPath, wavPath, container: "mp4" })),
    ).toBe("MUX_FAILED");
    expect((await fsp.readdir(dir)).sort()).toEqual(["Demo.mp4", "Demo.wav"]);
    expect(await fsp.readFile(videoPath, "utf8")).toBe("silent-video");
  });

  it("rejects mismatched extensions, other folders, unexported and missing files before running ffmpeg", async () => {
    const { spawn, calls } = scriptedSpawn(ok);
    const svc = makeService({ ffmpeg: { runner: { spawn }, resolveBinaries: bins } });
    const { videoPath, wavPath, dir } = await fixture(svc);
    const mux = svc.handlers["export:muxAudio"];
    expect(await codeOf(mux({ videoPath, wavPath, container: "webm" }))).toBe("MUX_INVALID_INPUT");
    expect(await codeOf(mux({ videoPath, wavPath: videoPath, container: "mp4" }))).toBe(
      "MUX_INVALID_INPUT",
    );
    const elsewhere = path.join(tmp, "other.wav");
    await fsp.writeFile(elsewhere, "pcm");
    expect(await codeOf(mux({ videoPath, wavPath: elsewhere, container: "mp4" }))).toBe(
      "MUX_INVALID_INPUT",
    );
    // Same folder, right extensions, but never produced by this sink.
    const strayVideo = path.join(dir, "Other.mp4");
    const strayWav = path.join(dir, "Other.wav");
    await fsp.writeFile(strayVideo, "someone else's video");
    await fsp.writeFile(strayWav, "pcm");
    expect(await codeOf(mux({ videoPath: strayVideo, wavPath, container: "mp4" }))).toBe(
      "MUX_INVALID_INPUT",
    );
    expect(await codeOf(mux({ videoPath, wavPath: strayWav, container: "mp4" }))).toBe(
      "MUX_INVALID_INPUT",
    );
    await fsp.rm(wavPath);
    expect(await codeOf(mux({ videoPath, wavPath, container: "mp4" }))).toBe("SOURCE_NOT_FOUND");
    expect(await codeOf(mux({ videoPath: "rel.mp4", wavPath, container: "mp4" }))).toBe(
      "INVALID_PATH",
    );
    expect(calls).toHaveLength(0);
    expect(await fsp.readFile(strayWav, "utf8")).toBe("pcm");
  });
});
