import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { type SourceReplacedEvent, projectContracts } from "./contracts";
import { FsIpcError } from "./errors";
import { type ProjectDeps, applySourceReplacement, createProjectHandlers } from "./handlers";
import type { RecentsStore } from "./recents";
import { faultyFs, makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";

/**
 * `project:replaceSource` — the background H.264 transcode relink (§5.2): the
 * document swap happens in main under the project lock, survives stale editor
 * saves, and cleans up the temp output and (when allowed) the replaced original.
 */

let tmp: string;
let library: string;
let recordings: string;
let trashed: string[];
let events: SourceReplacedEvent[];

const recents: RecentsStore = {
  list: async () => [],
  touch: async () => {},
  remove: async () => {},
};

const validate: ProjectDeps["validate"] = (doc) =>
  typeof doc === "object" &&
  doc !== null &&
  (doc as { schemaVersion?: unknown }).schemaVersion === 1
    ? { ok: true, value: doc }
    : { ok: false, message: "bad project" };

function makeHandlers(overrides: Partial<ProjectDeps> = {}) {
  const clock = manualClock();
  return createProjectHandlers({
    fs: realFs,
    now: () => {
      clock.advance(1000);
      return clock.now();
    },
    libraryRoot: async () => library,
    recents,
    validate,
    trashItem: async (p) => {
      trashed.push(p);
      await fsp.rm(p, { force: true });
    },
    probe: async () => ({ durationMs: 8000, width: 1920, height: 1080 }),
    isDisposableMedia: (p) => p.startsWith(recordings + path.sep),
    onSourceReplaced: (e) => events.push(e),
    ...overrides,
  });
}

const video = { path: "media/screen.mp4", codec: "vp9", durationMs: 8000 };
const doc = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: "p1",
  name: "Demo",
  modifiedAt: "1999-01-01T00:00:00.000Z",
  sources: { video, mic: { path: "media/mic.m4a", codec: "aac" } },
  prefs: { saveRawWithProject: false },
  ...extra,
});

type Doc = ReturnType<typeof doc>;
const readDoc = async (dir: string) =>
  JSON.parse(await fsp.readFile(path.join(dir, "project.json"), "utf8")) as Doc;
const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

async function project(h: ReturnType<typeof makeHandlers>, extra: Record<string, unknown> = {}) {
  const dir = (await h["project:create"]({ name: "Demo", document: doc(extra) })).path;
  await fsp.writeFile(path.join(dir, "media/screen.mp4"), "vp9");
  const output = path.join(recordings, "s1", "screen.h264.mp4");
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, "h264");
  return { dir, output };
}

const request = (dir: string, filePath: string) => ({
  path: dir,
  source: "video" as const,
  filePath,
  replaces: "media/screen.mp4",
  expected: { durationMs: 8000 },
  codec: "h264",
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof FsIpcError ? e.code : `other:${String(e)}`;
  }
  return "resolved";
}

beforeEach(async () => {
  tmp = await makeTmpDir();
  library = path.join(tmp, "Library");
  recordings = path.join(tmp, "recordings");
  trashed = [];
  events = [];
});
afterEach(async () => {
  await removeDir(tmp);
});

describe("applySourceReplacement", () => {
  it("swaps only a source that still holds `from`", () => {
    const d = doc();
    const r = {
      source: "video" as const,
      from: "media/screen.mp4",
      to: "media/s.h264.mp4",
      codec: "h264",
    };
    expect(applySourceReplacement(d, r)).toMatchObject({
      sources: { video: { path: "media/s.h264.mp4", codec: "h264", durationMs: 8000 } },
    });
    expect(applySourceReplacement(d, { ...r, from: "media/other.mp4" })).toBe(d);
    expect(applySourceReplacement(d, { ...r, source: "webcam" })).toBe(d);
    expect(applySourceReplacement("nope", r)).toBe("nope");
    const { codec: _c, ...noCodec } = r;
    expect(applySourceReplacement(d, noCodec)).toMatchObject({
      sources: { video: { codec: "vp9" } },
    });
  });

  it("contract: channel + event shapes", () => {
    const ok = projectContracts["project:replaceSource"].request.safeParse(request("/p", "/f.mp4"));
    expect(ok.success).toBe(true);
    const bad = projectContracts["project:replaceSource"].request.safeParse({
      ...request("/p", "/f.mp4"),
      source: "mic",
    });
    expect(bad.success).toBe(false);
  });
});

describe("project:replaceSource", () => {
  it("moves the temp output into media/, rewrites project.json and notifies editors", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const res = await h["project:replaceSource"](request(dir, output));
    expect(res).toMatchObject({ applied: true, path: "media/screen.h264.mp4" });
    const onDisk = await readDoc(dir);
    expect(onDisk.sources.video).toEqual({
      ...video,
      path: "media/screen.h264.mp4",
      codec: "h264",
    });
    expect(onDisk.sources.mic.path).toBe("media/mic.m4a");
    expect(res.modifiedAt).toBe(onDisk.modifiedAt);
    expect(await fsp.readFile(path.join(dir, "media/screen.h264.mp4"), "utf8")).toBe("h264");
    // Temp output is gone (moved), replaced original trashed (project keeps no raw).
    expect(await exists(output)).toBe(false);
    expect(res.removed).toEqual(["media/screen.mp4"]);
    expect(trashed).toEqual([path.join(dir, "media", "screen.mp4")]);
    expect(events).toEqual([
      {
        path: dir,
        projectId: "p1",
        source: "video",
        from: "media/screen.mp4",
        to: "media/screen.h264.mp4",
        codec: "h264",
      },
    ]);
  });

  it("keeps the replaced original when the project saves raw recordings (the default)", async () => {
    const h = makeHandlers();
    for (const prefs of [{ saveRawWithProject: true }, undefined]) {
      const { dir, output } = await project(h, { prefs });
      const res = await h["project:replaceSource"](request(dir, output));
      expect(res.applied).toBe(true);
      expect(res.removed).toEqual([]);
      expect(await exists(path.join(dir, "media/screen.mp4"))).toBe(true);
    }
    expect(trashed).toEqual([]);
  });

  it("an editor's stale save and autosave after the swap keep the new media path", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const stale = { ...doc(), name: "Edited in the editor" };
    await h["project:replaceSource"](request(dir, output));
    await h["project:save"]({ path: dir, document: stale });
    const onDisk = await readDoc(dir);
    expect(onDisk.name).toBe("Edited in the editor");
    expect(onDisk.sources.video).toMatchObject({ path: "media/screen.h264.mp4", codec: "h264" });

    const backup = await h["project:save"]({ path: dir, document: stale, autosave: true });
    const backupDoc = JSON.parse(
      await fsp.readFile(path.join(dir, "cache", "backups", backup.backupName ?? ""), "utf8"),
    ) as Doc;
    expect(backupDoc.sources.video.path).toBe("media/screen.h264.mp4");

    // A document that really changed the video (user relink) is left alone.
    const relinked = doc({ sources: { video: { ...video, path: "/elsewhere/new.mp4" } } });
    await h["project:save"]({ path: dir, document: relinked });
    expect((await readDoc(dir)).sources.video.path).toBe("/elsewhere/new.mp4");
  });

  it("a save racing the swap is serialized: whichever lands, the swap wins", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const stale = { ...doc(), name: "Racing" };
    await Promise.all([
      h["project:save"]({ path: dir, document: stale }),
      h["project:replaceSource"](request(dir, output)),
      h["project:save"]({ path: dir, document: stale }),
    ]);
    const onDisk = await readDoc(dir);
    expect(onDisk.name).toBe("Racing");
    expect(onDisk.sources.video.path).toBe("media/screen.h264.mp4");
  });

  it("survives a rename and a backup restore", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const backup = await h["project:save"]({ path: dir, document: doc(), autosave: true });
    await h["project:replaceSource"](request(dir, output));
    const renamed = (await h["project:rename"]({ path: dir, name: "Renamed" })).path;
    await h["project:save"]({ path: renamed, document: doc() });
    expect((await readDoc(renamed)).sources.video.path).toBe("media/screen.h264.mp4");
    const restored = await h["project:restore"]({
      path: renamed,
      backupName: backup.backupName ?? "",
    });
    expect((restored.document as Doc).sources.video.path).toBe("media/screen.h264.mp4");
  });

  it("skips (no copy, no write, no delete) when the document no longer holds `replaces`", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const moved = doc({ sources: { video: { ...video, path: "media/other.mp4" } } });
    await h["project:save"]({ path: dir, document: moved });
    const before = await readDoc(dir);
    const res = await h["project:replaceSource"](request(dir, output));
    expect(res).toEqual({ applied: false, path: null, modifiedAt: null, removed: [] });
    expect(await readDoc(dir)).toEqual(before);
    expect(await exists(output)).toBe(true);
    expect(await exists(path.join(dir, "media/screen.h264.mp4"))).toBe(false);
    expect(events).toEqual([]);
    // Nothing recorded: later saves are untouched.
    await h["project:save"]({ path: dir, document: doc() });
    expect((await readDoc(dir)).sources.video.path).toBe("media/screen.mp4");
  });

  it("a missing or mismatching transcode fails without touching the project", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    expect(await codeOf(h["project:replaceSource"](request(dir, `${output}.gone`)))).toBe(
      "RELINK_FILE_NOT_FOUND",
    );
    const short = makeHandlers({ probe: async () => ({ durationMs: 2000, width: 1, height: 1 }) });
    expect(await codeOf(short["project:replaceSource"](request(dir, output)))).toBe(
      "RELINK_DURATION_MISMATCH",
    );
    expect((await readDoc(dir)).sources.video.path).toBe("media/screen.mp4");
    expect(await exists(output)).toBe(true);
    expect(await exists(path.join(dir, "media/screen.mp4"))).toBe(true);
    expect(trashed).toEqual([]);
  });

  it("a failed document write puts the moved file back and deletes nothing", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h);
    const failing = makeHandlers({
      fs: faultyFs({
        open: async () => {
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      }),
    });
    expect(await codeOf(failing["project:replaceSource"](request(dir, output)))).not.toBe(
      "resolved",
    );
    expect(await exists(output)).toBe(true);
    expect(await exists(path.join(dir, "media/screen.h264.mp4"))).toBe(false);
    expect((await readDoc(dir)).sources.video.path).toBe("media/screen.mp4");
    expect(trashed).toEqual([]);
    expect(events).toEqual([]);
  });

  it("copies files that are not app temp output and never deletes them", async () => {
    const h = makeHandlers();
    const { dir } = await project(h);
    const userFile = path.join(tmp, "Desktop", "screen.h264.mp4");
    await fsp.mkdir(path.dirname(userFile), { recursive: true });
    await fsp.writeFile(userFile, "user");
    const res = await h["project:replaceSource"](request(dir, userFile));
    expect(res.applied).toBe(true);
    expect(await fsp.readFile(userFile, "utf8")).toBe("user");
    expect(await fsp.readFile(path.join(dir, res.path ?? ""), "utf8")).toBe("user");
  });

  it("falls back to copy + delete when the temp output cannot be renamed (other volume)", async () => {
    const { dir, output } = await project(makeHandlers());
    const h = makeHandlers({
      fs: faultyFs({
        rename: async (from, to) => {
          if (String(from) === output) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
          return fsp.rename(from, to);
        },
      }),
    });
    const res = await h["project:replaceSource"](request(dir, output));
    expect(res.applied).toBe(true);
    expect(await fsp.readFile(path.join(dir, "media/screen.h264.mp4"), "utf8")).toBe("h264");
    expect(await exists(output)).toBe(false);
  });

  it("never trashes a replaced file another source references, or one outside media/", async () => {
    const h = makeHandlers();
    const { dir, output } = await project(h, {
      sources: { video, webcam: { path: "media/screen.mp4", codec: "vp9" } },
    });
    const res = await h["project:replaceSource"](request(dir, output));
    expect(res.removed).toEqual([]);
    expect(await exists(path.join(dir, "media/screen.mp4"))).toBe(true);

    const { dir: dir2, output: out2 } = await project(h, {
      sources: { video: { ...video, path: "../outside.mp4" } },
    });
    await fsp.writeFile(path.join(library, "outside.mp4"), "x");
    const res2 = await h["project:replaceSource"]({
      ...request(dir2, out2),
      replaces: "../outside.mp4",
    });
    expect(res2.applied).toBe(true);
    expect(res2.removed).toEqual([]);
    expect(await exists(path.join(library, "outside.mp4"))).toBe(true);
    expect(trashed).toEqual([]);
  });

  it("a replaced original already gone (or a trash failure) does not fail the swap", async () => {
    const h = makeHandlers({
      trashItem: async () => {
        throw new Error("trash unavailable");
      },
    });
    const { dir, output } = await project(h);
    const res = await h["project:replaceSource"](request(dir, output));
    expect(res).toMatchObject({ applied: true, removed: [] });
    expect((await readDoc(dir)).sources.video.path).toBe("media/screen.h264.mp4");
  });

  it("a throwing event sink does not fail the swap", async () => {
    const h = makeHandlers({
      onSourceReplaced: () => {
        throw new Error("no windows");
      },
    });
    const { dir, output } = await project(h);
    expect((await h["project:replaceSource"](request(dir, output))).applied).toBe(true);
  });

  it("rejects a missing project", async () => {
    const h = makeHandlers();
    expect(
      await codeOf(h["project:replaceSource"](request(path.join(tmp, "nope.reelform"), "/x.mp4"))),
    ).toBe("PROJECT_NOT_FOUND");
  });
});
