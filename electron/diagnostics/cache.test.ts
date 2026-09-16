import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { type CacheFs, createCacheOps } from "./cache";
import { createDiagnosticsHandlers, diagnosticsContracts } from "./contracts";

let tmp: string;
let projA: string;
let projB: string;
let extra: string;

const realFs: CacheFs = {
  readdir: (d, o) => fsp.readdir(d, o),
  lstat: (p) => fsp.lstat(p),
  rm: (p, o) => fsp.rm(p, o),
};

async function put(file: string, bytes: number): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.alloc(bytes, 1));
}

const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(tmpdir(), "reelform-cache-")));
  projA = path.join(tmp, "A.reelform");
  projB = path.join(tmp, "B.reelform");
  extra = path.join(tmp, "appcache");
  await put(path.join(projA, "cache", "thumbnails", "1.jpg"), 100);
  await put(path.join(projA, "cache", "waveforms", "mic.bin"), 50);
  await put(path.join(projA, "cache", "proxy.mp4"), 1000);
  await put(path.join(projA, "cache", "thumbs", "000001.jpg"), 10);
  await put(path.join(projA, "cache", "backups", "backup.json"), 7);
  await put(path.join(projA, "cache", "trashed.json"), 3);
  await put(path.join(projA, "project.json"), 20);
  await put(path.join(projA, "media", "screen.mp4"), 5000);
  await put(path.join(projB, "cache", "autozoom", "a.json"), 25);
  await put(path.join(projB, "cache", "filmstrip", "deep", "x.jpg"), 5);
  await put(path.join(extra, "models-tmp", "chunk"), 400);
  await put(path.join(extra, "loose.bin"), 1);
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe("cache ops", () => {
  it("sums regenerable project cache entries and extra dirs, excluding backups", async () => {
    const ops = createCacheOps(realFs);
    const res = await ops.sumCache({
      projectDirs: [projA, projB, projA, path.join(tmp, "Gone.reelform")],
      extraCacheDirs: [extra, path.join(tmp, "missing")],
    });
    expect(res).toEqual({ projectsBytes: 100 + 50 + 1000 + 10 + 25 + 5, extraBytes: 401 });
  });

  it("clears only regenerable data and keeps backups, markers, media and project.json", async () => {
    const ops = createCacheOps(realFs);
    const res = await ops.clearCache({ projectDirs: [projA, projB], extraCacheDirs: [extra] });
    expect(res.failed).toEqual([]);
    expect(res.removedBytes).toBe(1190 + 401);
    expect(await exists(path.join(projA, "cache", "thumbnails"))).toBe(false);
    expect(await exists(path.join(projA, "cache", "proxy.mp4"))).toBe(false);
    expect(await exists(path.join(projB, "cache", "filmstrip"))).toBe(false);
    expect(await exists(path.join(projA, "cache", "backups", "backup.json"))).toBe(true);
    expect(await exists(path.join(projA, "cache", "trashed.json"))).toBe(true);
    expect(await exists(path.join(projA, "media", "screen.mp4"))).toBe(true);
    expect(await exists(path.join(projA, "project.json"))).toBe(true);
    // The extra dir itself stays; its contents go.
    expect(await fsp.readdir(extra)).toEqual([]);
    expect(await ops.sumCache({ projectDirs: [projA, projB], extraCacheDirs: [extra] })).toEqual({
      projectsBytes: 0,
      extraBytes: 0,
    });
  });

  it("removes backups only when asked", async () => {
    const ops = createCacheOps(realFs);
    await ops.clearCache({ projectDirs: [projA] }, { includeBackups: true });
    expect(await exists(path.join(projA, "cache", "backups"))).toBe(false);
    expect(await exists(path.join(projA, "cache", "trashed.json"))).toBe(true);
  });

  it("does not follow symlinks out of the cache", async () => {
    const outside = path.join(tmp, "outside");
    await put(path.join(outside, "big.bin"), 9999);
    const linked = await fsp
      .symlink(outside, path.join(projB, "cache", "waveforms"))
      .then(() => true)
      .catch(() => false);
    if (!linked) return;
    const ops = createCacheOps(realFs);
    const { projectsBytes } = await ops.sumCache({ projectDirs: [projB] });
    expect(projectsBytes).toBeLessThan(9999);
    await ops.clearCache({ projectDirs: [projB] });
    expect(await exists(path.join(outside, "big.bin"))).toBe(true);
  });

  it("reports entries that fail to delete", async () => {
    const ops = createCacheOps({
      ...realFs,
      rm: async (p, o) => {
        if (p.endsWith("proxy.mp4")) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        await fsp.rm(p, o);
      },
    });
    const res = await ops.clearCache({ projectDirs: [projA] });
    expect(res.failed).toEqual([path.join(projA, "cache", "proxy.mp4")]);
    expect(res.removedBytes).toBe(160);
  });
});

describe("system:cacheInfo breakdown", () => {
  const base = {
    now: () => 0,
    scrub: (s: string) => s,
    collect: async () => {
      throw new Error("unused");
    },
    clipboard: { writeText: () => {} },
  };

  it("adds session, project and extra bytes and validates against the contract", async () => {
    const h = createDiagnosticsHandlers({
      ...base,
      system: {
        cacheSize: async () => 1,
        cacheBreakdown: async () => ({ sessionBytes: 10.4, projectsBytes: 200, extraBytes: 3 }),
      },
    });
    const info = await h["system:cacheInfo"]();
    expect(info).toEqual({
      bytes: 213,
      breakdown: { sessionBytes: 10, projectsBytes: 200, extraBytes: 3 },
    });
    expect(diagnosticsContracts["system:cacheInfo"].response.parse(info)).toEqual(info);
  });

  it("tolerates an unreadable session cache and a failing breakdown", async () => {
    const onError = vi.fn();
    const partial = createDiagnosticsHandlers({
      ...base,
      system: {
        cacheBreakdown: async () => ({
          sessionBytes: null,
          projectsBytes: Number.NaN,
          extraBytes: 5,
        }),
      },
    });
    expect(await partial["system:cacheInfo"]()).toEqual({
      bytes: 5,
      breakdown: { sessionBytes: null, projectsBytes: 0, extraBytes: 5 },
    });
    const failing = createDiagnosticsHandlers({
      ...base,
      onError,
      system: {
        cacheBreakdown: async () => {
          throw new Error("EACCES");
        },
      },
    });
    expect(await failing["system:cacheInfo"]()).toEqual({ bytes: null });
    expect(onError).toHaveBeenCalledOnce();
  });
});
