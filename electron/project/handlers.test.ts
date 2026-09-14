import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { backupFileName } from "./backups";
import type { MediaProbe } from "./contracts";
import { projectContracts } from "./contracts";
import { FsIpcError } from "./errors";
import type { FsLike } from "./fsTypes";
import { type ProjectDeps, checkRelink, createProjectHandlers, stampDocument } from "./handlers";
import type { RecentsStore } from "./recents";
import { faultyFs, makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";

let tmp: string;
let library: string;
let clock: ReturnType<typeof manualClock>;
let recentsList: string[];
let trashed: string[];
let probeResult: MediaProbe;

const memoryRecents = (): RecentsStore => ({
  list: async () => [...recentsList],
  touch: async (p) => {
    recentsList = [p, ...recentsList.filter((x) => x !== p)];
  },
  remove: async (p) => {
    recentsList = recentsList.filter((x) => x !== p);
  },
});

/** Stand-in validator: an object with schemaVersion 1 and a string modifiedAt. */
const validate: ProjectDeps["validate"] = (doc) => {
  if (
    typeof doc === "object" &&
    doc !== null &&
    (doc as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (doc as { modifiedAt?: unknown }).modifiedAt === "string"
  ) {
    return { ok: true, value: doc };
  }
  return { ok: false, message: "bad project", issues: [{ path: ["schemaVersion"] }] };
};

function makeHandlers(overrides: Partial<ProjectDeps> = {}) {
  const deps: ProjectDeps = {
    fs: realFs,
    now: clock.now,
    libraryRoot: async () => library,
    recents: memoryRecents(),
    validate,
    trashItem: async (p) => {
      trashed.push(p);
      await fsp.rm(p, { recursive: true, force: true });
    },
    probe: async () => probeResult,
    ...overrides,
  };
  return createProjectHandlers(deps);
}

const doc = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: "p1",
  name: "Demo",
  modifiedAt: "1999-01-01T00:00:00.000Z",
  ...extra,
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof FsIpcError ? e.code : `other:${String(e)}`;
  }
  return "resolved";
}

const readProjectJson = async (dir: string) =>
  JSON.parse(await fsp.readFile(path.join(dir, "project.json"), "utf8")) as Record<string, unknown>;

beforeEach(async () => {
  tmp = await makeTmpDir();
  library = path.join(tmp, "Library");
  clock = manualClock();
  recentsList = [];
  trashed = [];
  probeResult = { durationMs: 10_000, width: 1920, height: 1080 };
});
afterEach(async () => {
  await removeDir(tmp);
});

describe("contracts", () => {
  it("channel names match keys and follow domain:verb", () => {
    for (const [key, ch] of Object.entries(projectContracts)) {
      expect(ch.name).toBe(key);
      expect(key).toMatch(/^project:[a-zA-Z]+$/);
    }
  });

  it("relink request rejects non-integer dimensions", () => {
    const r = projectContracts["project:relink"].request.safeParse({
      path: "/a.reelform",
      filePath: "/b.mp4",
      expected: { durationMs: 1, width: 1.5 },
    });
    expect(r.success).toBe(false);
  });
});

describe("project:create", () => {
  it("creates the §4 folder layout, stamps modifiedAt and adds to recents", async () => {
    const h = makeHandlers();
    const res = await h["project:create"]({ name: "My Demo", document: doc() });
    expect(res.path).toBe(path.join(library, "My Demo.reelform"));
    expect((await fsp.readdir(res.path)).sort()).toEqual([
      "cache",
      "exports",
      "media",
      "project.json",
    ]);
    const onDisk = await readProjectJson(res.path);
    expect(onDisk.modifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(res.modifiedAt).toBe(onDisk.modifiedAt);
    expect(res.document).toEqual(onDisk);
    expect(recentsList).toEqual([res.path]);
  });

  it("uniquifies the folder name on collision", async () => {
    const h = makeHandlers();
    const a = await h["project:create"]({ name: "Demo", document: doc() });
    const b = await h["project:create"]({ name: "Demo", document: doc() });
    expect(path.basename(a.path)).toBe("Demo.reelform");
    expect(path.basename(b.path)).toBe("Demo (2).reelform");
  });

  it("sanitizes hostile names so the folder stays under the parent", async () => {
    const h = makeHandlers();
    const res = await h["project:create"]({ name: "../../escape", document: doc() });
    expect(path.dirname(res.path)).toBe(library);
    expect(await codeOf(h["project:create"]({ name: "..", document: doc() }))).toBe("INVALID_NAME");
  });

  it("copies media in, moves only after success, and uniquifies names", async () => {
    const rec = path.join(tmp, "rec");
    await fsp.mkdir(rec);
    await fsp.writeFile(path.join(rec, "screen.mp4"), "video");
    await fsp.writeFile(path.join(rec, "mic.m4a"), "audio");
    const h = makeHandlers();
    const res = await h["project:create"]({
      name: "Rec",
      document: doc(),
      media: [
        { sourcePath: path.join(rec, "screen.mp4"), fileName: "screen.mp4", move: true },
        { sourcePath: path.join(rec, "mic.m4a"), fileName: "screen.mp4" },
      ],
    });
    expect(res.mediaFiles).toEqual(["screen.mp4", "screen (2).mp4"]);
    expect(await fsp.readFile(path.join(res.path, "media/screen.mp4"), "utf8")).toBe("video");
    expect(await fsp.readdir(rec)).toEqual(["mic.m4a"]);
  });

  it("rolls back the folder and keeps moved sources when validation fails", async () => {
    const src = path.join(tmp, "screen.mp4");
    await fsp.writeFile(src, "video");
    const h = makeHandlers();
    const code = await codeOf(
      h["project:create"]({
        name: "Bad",
        document: { schemaVersion: 2 },
        media: [{ sourcePath: src, fileName: "screen.mp4", move: true }],
      }),
    );
    expect(code).toBe("PROJECT_INVALID");
    expect(await fsp.readdir(library)).toEqual([]);
    expect(await fsp.readFile(src, "utf8")).toBe("video");
    expect(recentsList).toEqual([]);
  });

  it("a recents failure after writing never loses moved media", async () => {
    const src = path.join(tmp, "only-copy.mp4");
    await fsp.writeFile(src, "precious");
    const h = makeHandlers({
      recents: {
        ...memoryRecents(),
        touch: async () => {
          throw new Error("recents.json is read-only");
        },
      },
    });
    const res = await h["project:create"]({
      name: "Keep",
      document: doc(),
      media: [{ sourcePath: src, fileName: "screen.mp4", move: true }],
    });
    expect(await fsp.readFile(path.join(res.path, "media/screen.mp4"), "utf8")).toBe("precious");
    expect(await readProjectJson(res.path)).toMatchObject({ schemaVersion: 1 });
  });

  it("rejects a media fileName that is only traversal", async () => {
    const src = path.join(tmp, "a.mp4");
    await fsp.writeFile(src, "x");
    const h = makeHandlers();
    const code = await codeOf(
      h["project:create"]({
        name: "X",
        document: doc(),
        media: [{ sourcePath: src, fileName: "../.." }],
      }),
    );
    expect(code).toBe("INVALID_NAME");
    expect(await fsp.readdir(library)).toEqual([]);
  });
});

describe("project:open / save", () => {
  it("round-trips and bumps modifiedAt on every save", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    clock.advance(5000);
    const s1 = await h["project:save"]({ path: p, document: doc({ title: "x" }) });
    expect(s1.modifiedAt).toBe("2026-01-01T00:00:05.000Z");
    expect(s1.backupName).toBeNull();
    clock.advance(1);
    const s2 = await h["project:save"]({ path: p, document: doc({ title: "y" }) });
    expect(s2.modifiedAt > s1.modifiedAt).toBe(true);
    const opened = await h["project:open"]({ path: p });
    expect(opened.document).toMatchObject({ title: "y", modifiedAt: s2.modifiedAt });
    expect(opened.modifiedAt).toBe(s2.modifiedAt);
    expect(opened.recovery).toBeNull();
    expect(await fsp.readdir(p)).not.toContain("project.json.tmp");
  });

  it("maps missing / corrupt / invalid projects to stable codes", async () => {
    const h = makeHandlers();
    expect(await codeOf(h["project:open"]({ path: path.join(tmp, "Nope.reelform") }))).toBe(
      "PROJECT_NOT_FOUND",
    );
    expect(await codeOf(h["project:open"]({ path: "relative.reelform" }))).toBe("INVALID_PATH");
    expect(await codeOf(h["project:open"]({ path: tmp }))).toBe("INVALID_PATH");
    const dir = path.join(tmp, "C.reelform");
    await fsp.mkdir(dir);
    expect(await codeOf(h["project:open"]({ path: dir }))).toBe("PROJECT_NOT_FOUND");
    await fsp.writeFile(path.join(dir, "project.json"), "{ truncated");
    expect(await codeOf(h["project:open"]({ path: dir }))).toBe("PROJECT_CORRUPT");
    await fsp.writeFile(path.join(dir, "project.json"), JSON.stringify({ schemaVersion: 9 }));
    expect(await codeOf(h["project:open"]({ path: dir }))).toBe("PROJECT_INVALID");
  });

  it("save refuses to create a project folder that doesn't exist", async () => {
    const h = makeHandlers();
    const p = path.join(tmp, "Ghost.reelform");
    expect(await codeOf(h["project:save"]({ path: p, document: doc() }))).toBe("PROJECT_NOT_FOUND");
    await expect(fsp.access(p)).rejects.toThrow();
  });

  it("an invalid document never touches project.json", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc({ v: 1 }) });
    const before = await fsp.readFile(path.join(p, "project.json"), "utf8");
    expect(await codeOf(h["project:save"]({ path: p, document: [1, 2] }))).toBe("PROJECT_INVALID");
    expect(await fsp.readFile(path.join(p, "project.json"), "utf8")).toBe(before);
  });

  it("a crash mid-write (rename fails) leaves the previous project.json intact", async () => {
    const good = makeHandlers();
    const { path: p } = await good["project:create"]({ name: "A", document: doc({ v: 1 }) });
    const before = await fsp.readFile(path.join(p, "project.json"), "utf8");
    const broken = makeHandlers({
      fs: faultyFs({
        rename: async () => {
          throw Object.assign(new Error("disk yanked"), { code: "EIO" });
        },
      }),
    });
    await expect(broken["project:save"]({ path: p, document: doc({ v: 2 }) })).rejects.toThrow(
      "disk yanked",
    );
    expect(await fsp.readFile(path.join(p, "project.json"), "utf8")).toBe(before);
    expect(await fsp.readdir(p)).not.toContain("project.json.tmp");
  });
});

describe("autosave backups + crash recovery", () => {
  it("autosave writes a rotated backup, not project.json", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc({ v: 0 }) });
    const before = await fsp.readFile(path.join(p, "project.json"), "utf8");
    for (let i = 1; i <= 7; i++) {
      clock.advance(30_000);
      const r = await h["project:save"]({ path: p, document: doc({ v: i }), autosave: true });
      expect(r.backupName).toBe(backupFileName(clock.now()));
      expect(r.modifiedAt).toBe(new Date(clock.now()).toISOString());
    }
    expect(await fsp.readFile(path.join(p, "project.json"), "utf8")).toBe(before);
    expect(await fsp.readdir(path.join(p, "cache/backups"))).toHaveLength(5);
  });

  it("offers recovery when an autosave is newer, and restore applies it", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc({ v: 0 }) });
    clock.advance(30_000);
    await h["project:save"]({ path: p, document: doc({ v: 1 }), autosave: true });
    clock.advance(30_000);
    const last = await h["project:save"]({ path: p, document: doc({ v: 2 }), autosave: true });

    // "Crash", relaunch.
    const opened = await h["project:open"]({ path: p });
    expect(opened.document).toMatchObject({ v: 0 });
    expect(opened.recovery).toMatchObject({
      backupName: last.backupName,
      projectModifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(opened.recovery?.backups).toHaveLength(2);

    clock.advance(1000);
    const restored = await h["project:restore"]({ path: p });
    expect(restored.restoredFrom).toBe(last.backupName);
    expect(restored.document).toMatchObject({ v: 2, modifiedAt: "2026-01-01T00:01:01.000Z" });
    expect(await readProjectJson(p)).toMatchObject({ v: 2 });
    expect((await h["project:recovery"]({ path: p })).recovery).toBeNull();
  });

  it("restores a specific older backup by name", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc({ v: 0 }) });
    clock.advance(10);
    const first = await h["project:save"]({ path: p, document: doc({ v: 1 }), autosave: true });
    clock.advance(10);
    await h["project:save"]({ path: p, document: doc({ v: 2 }), autosave: true });
    const r = await h["project:restore"]({ path: p, backupName: first.backupName ?? "" });
    expect(r.document).toMatchObject({ v: 1 });
  });

  it("a manual save after autosaves clears the recovery offer", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    clock.advance(30_000);
    await h["project:save"]({ path: p, document: doc({ v: 1 }), autosave: true });
    expect((await h["project:recovery"]({ path: p })).recovery).not.toBeNull();
    await h["project:save"]({ path: p, document: doc({ v: 1 }) }); // same ms as the autosave
    expect((await h["project:recovery"]({ path: p })).recovery).toBeNull();
  });

  it("overlapping saves and autosaves on one project are serialized", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    clock.advance(1000);
    const ops = Array.from({ length: 12 }, (_, i) =>
      h["project:save"]({ path: p, document: doc({ v: i }), autosave: i % 2 === 0 }),
    );
    const results = await Promise.all(ops);
    const names = results.map((r) => r.backupName).filter((n): n is string => n !== null);
    expect(new Set(names).size).toBe(6);
    // The last manual save (v: 11) wins; the file is intact JSON.
    expect(await readProjectJson(p)).toMatchObject({ v: 11 });
    expect(await fsp.readdir(p)).not.toContain("project.json.tmp");
    expect(await fsp.readdir(path.join(p, "cache/backups"))).toHaveLength(5);
  });

  it("a manual save clears recovery even when backups are stamped ahead of the clock", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    clock.advance(60_000);
    await h["project:save"]({ path: p, document: doc({ v: 1 }), autosave: true });
    await h["project:save"]({ path: p, document: doc({ v: 2 }), autosave: true }); // same ms → bumped +1
    clock.advance(-30_000); // clock stepped backwards (NTP)
    const saved = await h["project:save"]({ path: p, document: doc({ v: 2 }) });
    expect((await h["project:recovery"]({ path: p })).recovery).toBeNull();
    expect((await readProjectJson(p)).modifiedAt).toBe(saved.modifiedAt);
  });

  it("offers recovery when project.json is gone or corrupt", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    await h["project:save"]({ path: p, document: doc({ v: 9 }), autosave: true });
    await fsp.writeFile(path.join(p, "project.json"), "garbage");
    const rec = (await h["project:recovery"]({ path: p })).recovery;
    expect(rec?.projectModifiedAt).toBeNull();
    const restored = await h["project:restore"]({ path: p });
    expect(restored.document).toMatchObject({ v: 9 });
  });

  it("falls back to file mtime when the document has no parseable modifiedAt", async () => {
    const dir = path.join(tmp, "M.reelform");
    await fsp.mkdir(path.join(dir, "cache/backups"), { recursive: true });
    await fsp.writeFile(path.join(dir, "project.json"), JSON.stringify({ schemaVersion: 1 }));
    const mtime = (await fsp.stat(path.join(dir, "project.json"))).mtimeMs;
    await fsp.writeFile(path.join(dir, "cache/backups", backupFileName(mtime - 60_000)), "{}");
    const h = makeHandlers();
    expect((await h["project:recovery"]({ path: dir })).recovery).toBeNull();
    await fsp.writeFile(path.join(dir, "cache/backups", backupFileName(mtime + 60_000)), "{}");
    expect((await h["project:recovery"]({ path: dir })).recovery).not.toBeNull();
  });

  it("restore rejects traversal names, missing backups and none-at-all", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc() });
    expect(await codeOf(h["project:restore"]({ path: p }))).toBe("NO_BACKUP");
    expect(await codeOf(h["project:restore"]({ path: p, backupName: "../../project.json" }))).toBe(
      "NO_BACKUP",
    );
    expect(await codeOf(h["project:restore"]({ path: p, backupName: backupFileName(42) }))).toBe(
      "NO_BACKUP",
    );
  });

  it("restoring an invalid backup leaves project.json untouched", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "A", document: doc({ v: 0 }) });
    await fsp.mkdir(path.join(p, "cache/backups"), { recursive: true });
    await fsp.writeFile(path.join(p, "cache/backups", backupFileName(clock.now() + 5)), "[]");
    expect(await codeOf(h["project:restore"]({ path: p }))).toBe("PROJECT_INVALID");
    expect(await readProjectJson(p)).toMatchObject({ v: 0 });
  });
});

describe("project:saveAs", () => {
  it("copies media + thumbnail, renames, and leaves the original alone", async () => {
    const h = makeHandlers();
    const { path: src } = await h["project:create"]({ name: "Orig", document: doc() });
    await fsp.writeFile(path.join(src, "media/screen.mp4"), "v");
    await fsp.writeFile(path.join(src, "thumbnail.jpg"), "t");
    await fsp.mkdir(path.join(src, "cache/backups"), { recursive: true });
    clock.advance(1000);
    const res = await h["project:saveAs"]({ path: src, document: doc({ v: 3 }), name: "Copy" });
    expect(res.path).toBe(path.join(library, "Copy.reelform"));
    expect(await fsp.readFile(path.join(res.path, "media/screen.mp4"), "utf8")).toBe("v");
    expect(await fsp.readFile(path.join(res.path, "thumbnail.jpg"), "utf8")).toBe("t");
    expect(await fsp.readdir(path.join(res.path, "cache"))).toEqual([]);
    expect(res.document).toMatchObject({
      name: "Copy",
      v: 3,
      modifiedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(await readProjectJson(src)).toMatchObject({ name: "Demo" });
    expect(recentsList[0]).toBe(res.path);
  });

  it("refuses to nest a project inside itself", async () => {
    const h = makeHandlers();
    const { path: src } = await h["project:create"]({ name: "Orig", document: doc() });
    expect(
      await codeOf(
        h["project:saveAs"]({
          path: src,
          document: doc(),
          name: "X",
          parentDir: path.join(src, "media"),
        }),
      ),
    ).toBe("INVALID_PATH");
  });

  it("cleans up the new folder when the document is invalid", async () => {
    const h = makeHandlers();
    const { path: src } = await h["project:create"]({ name: "Orig", document: doc() });
    expect(await codeOf(h["project:saveAs"]({ path: src, document: 7, name: "Bad" }))).toBe(
      "PROJECT_INVALID",
    );
    expect(await fsp.readdir(library)).toEqual(["Orig.reelform"]);
  });
});

describe("project:list", () => {
  it("merges library scan with recents and flags missing/corrupt, newest first", async () => {
    const h = makeHandlers();
    const a = await h["project:create"]({ name: "Alpha", document: doc({ name: "Alpha" }) });
    clock.advance(1000);
    const b = await h["project:create"]({ name: "Beta", document: doc({ name: "Beta" }) });
    await fsp.writeFile(path.join(b.path, "thumbnail.jpg"), "t");
    const external = path.join(tmp, "Elsewhere", "Ext.reelform");
    await fsp.mkdir(external, { recursive: true });
    await fsp.writeFile(path.join(external, "project.json"), "not json");
    const gone = path.join(tmp, "Gone.reelform");
    recentsList = [gone, external, a.path];
    await fsp.mkdir(path.join(library, "not-a-project"));

    const { projects } = await h["project:list"](undefined);
    expect(projects.map((x) => x.name)).toEqual(["Beta", "Alpha", "Ext", "Gone"]);
    const [beta, alpha, ext, missing] = projects;
    expect(beta).toMatchObject({
      recent: false,
      thumbnailPath: path.join(b.path, "thumbnail.jpg"),
    });
    expect(alpha).toMatchObject({ recent: true, corrupt: false, missing: false });
    expect(ext).toMatchObject({ corrupt: true, modifiedAt: null, recent: true });
    expect(missing).toMatchObject({ missing: true, path: gone });
  });

  it("returns [] when the library root doesn't exist yet", async () => {
    const h = makeHandlers();
    expect(await h["project:list"]({})).toEqual({ projects: [] });
  });
});

describe("project:trash", () => {
  it("moves a real project to the OS trash and drops it from recents", async () => {
    const h = makeHandlers();
    const { path: p } = await h["project:create"]({ name: "T", document: doc() });
    expect(await h["project:trash"]({ path: p })).toEqual({ trashed: true });
    expect(trashed).toEqual([p]);
    expect(recentsList).toEqual([]);
  });

  it("never trashes a folder that isn't a project", async () => {
    const h = makeHandlers();
    const fake = path.join(tmp, "Important.reelform");
    await fsp.mkdir(fake);
    expect(await codeOf(h["project:trash"]({ path: fake }))).toBe("PROJECT_NOT_FOUND");
    expect(await codeOf(h["project:trash"]({ path: tmp }))).toBe("INVALID_PATH");
    expect(trashed).toEqual([]);
  });

  it("a recents failure after a successful trash still reports trashed", async () => {
    const h = makeHandlers({
      recents: {
        ...memoryRecents(),
        remove: async () => {
          throw new Error("recents locked");
        },
      },
    });
    const { path: p } = await h["project:create"]({ name: "T", document: doc() });
    expect(await h["project:trash"]({ path: p })).toEqual({ trashed: true });
    expect(trashed).toEqual([p]);
  });

  it("maps trash failures to TRASH_FAILED and keeps recents", async () => {
    const h = makeHandlers({
      trashItem: async () => {
        throw new Error("no trash on this volume");
      },
    });
    const { path: p } = await h["project:create"]({ name: "T", document: doc() });
    expect(await codeOf(h["project:trash"]({ path: p }))).toBe("TRASH_FAILED");
    expect(recentsList).toEqual([p]);
  });
});

describe("project:relink", () => {
  let project: string;
  let file: string;
  beforeEach(async () => {
    const h = makeHandlers();
    project = (await h["project:create"]({ name: "R", document: doc() })).path;
    file = path.join(tmp, "found.mp4");
    await fsp.writeFile(file, "video");
  });

  it("pure check: ±1s duration inclusive, exact dimensions", () => {
    const e = { durationMs: 10_000, width: 1920, height: 1080 };
    expect(checkRelink(e, { durationMs: 11_000, width: 1920, height: 1080 })).toBeNull();
    expect(checkRelink(e, { durationMs: 9_000, width: 1920, height: 1080 })).toBeNull();
    expect(checkRelink(e, { durationMs: 11_001, width: 1920, height: 1080 })?.code).toBe(
      "RELINK_DURATION_MISMATCH",
    );
    expect(checkRelink(e, { durationMs: Number.NaN, width: 1920, height: 1080 })?.code).toBe(
      "RELINK_DURATION_MISMATCH",
    );
    expect(checkRelink(e, { durationMs: 10_000, width: 1280, height: 1080 })?.code).toBe(
      "RELINK_DIMENSION_MISMATCH",
    );
    expect(checkRelink(e, { durationMs: 10_000, width: null, height: null })?.code).toBe(
      "RELINK_DIMENSION_MISMATCH",
    );
    // Audio sources: no expected dimensions.
    expect(
      checkRelink({ durationMs: 500 }, { durationMs: 900, width: null, height: null }),
    ).toBeNull();
  });

  it("copies into media/ and returns a relative path", async () => {
    const h = makeHandlers();
    await fsp.writeFile(path.join(project, "media/found.mp4"), "older");
    const r = await h["project:relink"]({
      path: project,
      filePath: file,
      expected: { durationMs: 10_500, width: 1920, height: 1080 },
    });
    expect(r.path).toBe("media/found (2).mp4");
    expect(await fsp.readFile(path.join(project, r.path), "utf8")).toBe("video");
    expect(r.probe).toEqual(probeResult);
  });

  it("reference mode returns the absolute path without copying", async () => {
    const h = makeHandlers();
    const r = await h["project:relink"]({
      path: project,
      filePath: file,
      expected: { durationMs: 10_000 },
      mode: "reference",
    });
    expect(r.path).toBe(file);
    expect(await fsp.readdir(path.join(project, "media"))).toEqual([]);
  });

  it("a file already inside the project is not duplicated", async () => {
    const inside = path.join(project, "media", "screen.mp4");
    await fsp.writeFile(inside, "v");
    const h = makeHandlers();
    const r = await h["project:relink"]({
      path: project,
      filePath: inside,
      expected: { durationMs: 10_000 },
    });
    expect(r.path).toBe("media/screen.mp4");
  });

  it("reports mismatch, missing file and probe failure with stable codes", async () => {
    probeResult = { durationMs: 20_000, width: 1920, height: 1080 };
    const h = makeHandlers();
    const req = {
      path: project,
      filePath: file,
      expected: { durationMs: 10_000, width: 1920, height: 1080 },
    };
    const err = await h["project:relink"](req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FsIpcError);
    expect((err as FsIpcError).toIpcError()).toMatchObject({
      code: "RELINK_DURATION_MISMATCH",
      details: { expectedMs: 10_000, actualMs: 20_000 },
    });
    expect(await fsp.readdir(path.join(project, "media"))).toEqual([]);

    expect(
      await codeOf(h["project:relink"]({ ...req, filePath: path.join(tmp, "nope.mp4") })),
    ).toBe("RELINK_FILE_NOT_FOUND");
    expect(await codeOf(h["project:relink"]({ ...req, filePath: tmp }))).toBe(
      "RELINK_FILE_NOT_FOUND",
    );
    expect(await codeOf(h["project:relink"]({ ...req, filePath: "found.mp4" }))).toBe(
      "INVALID_PATH",
    );

    const failing = makeHandlers({
      probe: async () => {
        throw new Error("unsupported container");
      },
    });
    expect(await codeOf(failing["project:relink"](req))).toBe("RELINK_PROBE_FAILED");
  });
});

describe("helpers", () => {
  it("stampDocument only merges into plain objects", () => {
    expect(stampDocument({ a: 1 }, { modifiedAt: "x" })).toEqual({ a: 1, modifiedAt: "x" });
    expect(stampDocument([1], { modifiedAt: "x" })).toEqual([1]);
    expect(stampDocument(null, { modifiedAt: "x" })).toBeNull();
  });

  it("FsLike accepts the real fs module", () => {
    const fs: FsLike = realFs;
    expect(typeof fs.open).toBe("function");
  });
});
