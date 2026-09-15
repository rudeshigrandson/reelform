import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { backupFileName } from "./backups";
import { projectContracts } from "./contracts";
import { FsIpcError } from "./errors";
import {
  type ProjectDeps,
  TRASH_DIR,
  TRASH_MARKER,
  createProjectHandlers,
  documentDurationMs,
  documentId,
} from "./handlers";
import type { RecentsStore } from "./recents";
import { faultyFs, makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";

/** Library index, rename, soft trash and backup discard (SPEC §4, guide S04/S23). */

let tmp: string;
let library: string;
let recentsList: string[];
const clock = manualClock();

const memoryRecents = (): RecentsStore => ({
  list: async () => [...recentsList],
  touch: async (p) => {
    recentsList = [p, ...recentsList.filter((x) => x !== p)];
  },
  remove: async (p) => {
    recentsList = recentsList.filter((x) => x !== p);
  },
});

const validate: ProjectDeps["validate"] = (doc) =>
  typeof doc === "object" &&
  doc !== null &&
  (doc as { schemaVersion?: unknown }).schemaVersion === 1
    ? { ok: true, value: doc }
    : { ok: false, message: "bad project" };

function makeHandlers(overrides: Partial<ProjectDeps> = {}) {
  return createProjectHandlers({
    fs: realFs,
    now: clock.now,
    libraryRoot: async () => library,
    recents: memoryRecents(),
    validate,
    trashItem: async (p) => fsp.rm(p, { recursive: true, force: true }),
    probe: async () => ({ durationMs: 0, width: null, height: null }),
    ...overrides,
  });
}

const doc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id,
  name,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  timeline: { durationMs: 5000 },
  ...extra,
});

async function writeProject(parent: string, folder: string, body: unknown): Promise<string> {
  const dir = path.join(parent, folder);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "project.json"), JSON.stringify(body));
  return dir;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FsIpcError) return e.code;
    throw e;
  }
  return "OK";
}

beforeEach(async () => {
  tmp = await makeTmpDir();
  library = path.join(tmp, "Library");
  await fsp.mkdir(library);
  recentsList = [];
});

afterEach(async () => {
  await removeDir(tmp);
});

describe("document helpers", () => {
  it("reads id and duration defensively", () => {
    expect(documentId({ id: "a" })).toBe("a");
    expect(documentId({ id: "" })).toBeNull();
    expect(documentId([])).toBeNull();
    expect(documentDurationMs({ timeline: { durationMs: 12 } })).toBe(12);
    expect(documentDurationMs({ timeline: { durationMs: Number.NaN } })).toBeNull();
    expect(documentDurationMs({ timeline: null })).toBeNull();
  });
});

describe("contracts", () => {
  it("list entries default id/duration so older payloads still parse", () => {
    const parsed = projectContracts["project:list"].response.parse({
      projects: [
        {
          path: "/a.reelform",
          name: "a",
          modifiedAt: null,
          thumbnailPath: null,
          missing: false,
          corrupt: false,
          recent: true,
        },
      ],
    });
    expect(parsed.projects[0]).toMatchObject({ id: null, durationMs: null });
  });
});

describe("project:list id + duration", () => {
  it("exposes each project's id and duration; corrupt ones read null", async () => {
    await writeProject(library, "A.reelform", doc("id-a", "A"));
    const bad = path.join(library, "Bad.reelform");
    await fsp.mkdir(bad);
    await fsp.writeFile(path.join(bad, "project.json"), "{nope");
    const { projects } = await makeHandlers()["project:list"](undefined);
    const a = projects.find((p) => p.name === "A");
    const b = projects.find((p) => p.path === bad);
    expect(a).toMatchObject({ id: "id-a", durationMs: 5000 });
    expect(b).toMatchObject({ id: null, durationMs: null, corrupt: true });
  });
});

describe("project:resolve", () => {
  it("finds a library project by id", async () => {
    const dir = await writeProject(library, "A.reelform", doc("id-a", "A"));
    expect(await makeHandlers()["project:resolve"]({ projectId: "id-a" })).toEqual({ path: dir });
  });

  it("finds a recent project outside the library, preferring recents over library copies", async () => {
    const outside = await writeProject(tmp, "Elsewhere.reelform", doc("dup", "Out"));
    await writeProject(library, "Copy.reelform", doc("dup", "Copy"));
    recentsList = [outside];
    expect(await makeHandlers()["project:resolve"]({ projectId: "dup" })).toEqual({
      path: outside,
    });
  });

  it("unknown id → PROJECT_NOT_FOUND; missing and corrupt entries are skipped", async () => {
    recentsList = [path.join(tmp, "Gone.reelform")];
    const bad = path.join(library, "Bad.reelform");
    await fsp.mkdir(bad);
    await fsp.writeFile(path.join(bad, "project.json"), "{");
    expect(await codeOf(makeHandlers()["project:resolve"]({ projectId: "x" }))).toBe(
      "PROJECT_NOT_FOUND",
    );
  });

  it("re-scans when a cached path no longer holds that project", async () => {
    const h = makeHandlers();
    const first = await writeProject(library, "A.reelform", doc("id-a", "A"));
    await h["project:resolve"]({ projectId: "id-a" });
    const moved = path.join(library, "Moved.reelform");
    await fsp.rename(first, moved);
    expect(await h["project:resolve"]({ projectId: "id-a" })).toEqual({ path: moved });
  });

  it("opening a project indexes it (resolve does not need a scan)", async () => {
    const dir = await writeProject(tmp, "Loose.reelform", doc("loose", "L"));
    let lists = 0;
    const recents = memoryRecents();
    const h = makeHandlers({
      recents: {
        ...recents,
        list: async () => {
          lists++;
          return recents.list();
        },
      },
    });
    await h["project:open"]({ path: dir });
    expect(await h["project:resolve"]({ projectId: "loose" })).toEqual({ path: dir });
    expect(lists).toBe(0);
  });

  it("an unreadable project.json (EACCES) is skipped, other errors still surface", async () => {
    await writeProject(library, "A.reelform", doc("id-a", "A"));
    const denied = faultyFs({
      readFile: (async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }) as unknown as typeof fsp.readFile,
    });
    expect(
      await codeOf(makeHandlers({ fs: denied })["project:resolve"]({ projectId: "id-a" })),
    ).toBe("PROJECT_NOT_FOUND");
  });
});

describe("project:saveAs (duplicate) ids", () => {
  it("gives the copy a fresh id so both projects resolve to their own folder", async () => {
    const h = makeHandlers({ newId: () => "copy-id" });
    const src = await writeProject(library, "Orig.reelform", doc("orig-id", "Orig"));
    await h["project:open"]({ path: src });
    const opened = await h["project:open"]({ path: src });
    const res = await h["project:saveAs"]({ path: src, document: opened.document, name: "Copy" });
    expect((res.document as { id: string }).id).toBe("copy-id");
    const onDisk = JSON.parse(await fsp.readFile(path.join(res.path, "project.json"), "utf8"));
    expect(onDisk.id).toBe("copy-id");
    // The copy is now first in recents, yet the original id still opens the original.
    expect(await h["project:resolve"]({ projectId: "orig-id" })).toEqual({ path: src });
    expect(await h["project:resolve"]({ projectId: "copy-id" })).toEqual({ path: res.path });
    const fresh = makeHandlers();
    expect(await fresh["project:resolve"]({ projectId: "orig-id" })).toEqual({ path: src });
  });

  it("defaults to a random UUID per copy", async () => {
    const h = makeHandlers();
    const src = await writeProject(library, "Orig.reelform", doc("orig-id", "Orig"));
    const body = doc("orig-id", "Orig");
    const a = await h["project:saveAs"]({ path: src, document: body, name: "A" });
    const b = await h["project:saveAs"]({ path: src, document: body, name: "B" });
    const idA = (a.document as { id: string }).id;
    const idB = (b.document as { id: string }).id;
    expect(idA).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set([idA, idB, "orig-id"]).size).toBe(3);
  });
});

describe("project:rename", () => {
  it("renames folder + document name, updates recents and the id index", async () => {
    const h = makeHandlers();
    const dir = await writeProject(library, "Old.reelform", doc("r1", "Old"));
    recentsList = [dir];
    const res = await h["project:rename"]({ path: dir, name: "New Name" });
    expect(res.path).toBe(path.join(library, "New Name.reelform"));
    expect(await fsp.readdir(library)).toEqual(["New Name.reelform"]);
    const onDisk = JSON.parse(await fsp.readFile(path.join(res.path, "project.json"), "utf8"));
    expect(onDisk.name).toBe("New Name");
    expect(recentsList).toEqual([res.path]);
    expect(await h["project:resolve"]({ projectId: "r1" })).toEqual({ path: res.path });
  });

  it("uniquifies on collision and keeps the typed name in the document", async () => {
    await writeProject(library, "Taken.reelform", doc("t", "Taken"));
    const dir = await writeProject(library, "Mine.reelform", doc("m", "Mine"));
    const res = await makeHandlers()["project:rename"]({ path: dir, name: "Taken" });
    expect(path.basename(res.path)).toBe("Taken (2).reelform");
    expect((res.document as { name: string }).name).toBe("Taken");
  });

  it("same folder name only rewrites the document", async () => {
    const dir = await writeProject(library, "Same.reelform", doc("s", "Same"));
    const res = await makeHandlers()["project:rename"]({ path: dir, name: "same" });
    expect(res.path).toBe(dir);
    expect((res.document as { name: string }).name).toBe("same");
  });

  it("rejects unusable names and invalid documents, rolling the folder back", async () => {
    const dir = await writeProject(library, "Keep.reelform", doc("k", "Keep"));
    expect(await codeOf(makeHandlers()["project:rename"]({ path: dir, name: "///" }))).toBe(
      "INVALID_NAME",
    );
    let calls = 0;
    const flaky = makeHandlers({
      validate: (d) => (++calls === 1 ? { ok: true, value: d } : { ok: false, message: "no" }),
    });
    expect(await codeOf(flaky["project:rename"]({ path: dir, name: "Other" }))).toBe(
      "PROJECT_INVALID",
    );
    expect(await fsp.readdir(library)).toEqual(["Keep.reelform"]);
  });
});

describe("soft trash", () => {
  it("move → list → restore round-trips to the original folder", async () => {
    const h = makeHandlers();
    const parent = path.join(tmp, "Work");
    await fsp.mkdir(parent);
    const dir = await writeProject(parent, "Demo.reelform", doc("d1", "Demo"));
    recentsList = [dir];

    const { path: trashed } = await h["project:moveToTrash"]({ path: dir });
    expect(path.dirname(trashed)).toBe(path.join(library, TRASH_DIR));
    expect(recentsList).toEqual([]);
    expect(await fsp.readdir(parent)).toEqual([]);
    // Trashed projects are not in the library list and cannot be resolved.
    expect((await h["project:list"](undefined)).projects).toEqual([]);
    expect(await codeOf(h["project:resolve"]({ projectId: "d1" }))).toBe("PROJECT_NOT_FOUND");

    const { projects } = await h["project:listTrash"](undefined);
    expect(projects).toEqual([
      {
        path: trashed,
        name: "Demo",
        id: "d1",
        trashedAt: new Date(clock.now()).toISOString(),
        thumbnailPath: null,
      },
    ]);

    const restored = await h["project:restoreFromTrash"]({ path: trashed });
    expect(restored.path).toBe(dir);
    expect(recentsList).toEqual([dir]);
    await expect(fsp.access(path.join(dir, TRASH_MARKER))).rejects.toThrow();
    expect((await h["project:listTrash"](undefined)).projects).toEqual([]);
    expect(await h["project:resolve"]({ projectId: "d1" })).toEqual({ path: dir });
  });

  it("restores into the library when the original parent is gone, uniquifying names", async () => {
    const h = makeHandlers();
    const parent = path.join(tmp, "Temp");
    await fsp.mkdir(parent);
    const dir = await writeProject(parent, "X.reelform", doc("x", "X"));
    const { path: trashed } = await h["project:moveToTrash"]({ path: dir });
    await removeDir(parent);
    await writeProject(library, "X.reelform", doc("other", "X"));
    const restored = await h["project:restoreFromTrash"]({ path: trashed });
    expect(restored.path).toBe(path.join(library, "X (2).reelform"));
  });

  it("two trashed projects with the same folder name both survive", async () => {
    const h = makeHandlers();
    const a = await writeProject(path.join(tmp, "a"), "Same.reelform", doc("a", "A"));
    const b = await writeProject(path.join(tmp, "b"), "Same.reelform", doc("b", "B"));
    await h["project:moveToTrash"]({ path: a });
    await h["project:moveToTrash"]({ path: b });
    expect((await fsp.readdir(path.join(library, TRASH_DIR))).sort()).toEqual([
      "Same (2).reelform",
      "Same.reelform",
    ]);
  });

  it("falls back to copy + remove across devices (EXDEV)", async () => {
    const renames: string[] = [];
    const exdev = faultyFs({
      rename: (async (from: string, to: string) => {
        if (String(to).endsWith(".reelform")) {
          renames.push(String(to));
          throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
        }
        return fsp.rename(from, to);
      }) as typeof fsp.rename,
    });
    const h = makeHandlers({ fs: exdev });
    const dir = await writeProject(tmp, "Ext.reelform", doc("e", "E"));
    const { path: trashed } = await h["project:moveToTrash"]({ path: dir });
    expect(renames).toHaveLength(1);
    await expect(fsp.access(dir)).rejects.toThrow();
    expect(JSON.parse(await fsp.readFile(path.join(trashed, "project.json"), "utf8")).id).toBe("e");
  });

  it("guards: non-projects, already-trashed and restore of non-trash paths", async () => {
    const h = makeHandlers();
    const empty = path.join(tmp, "Empty.reelform");
    await fsp.mkdir(empty);
    expect(await codeOf(h["project:moveToTrash"]({ path: empty }))).toBe("PROJECT_NOT_FOUND");
    const dir = await writeProject(library, "P.reelform", doc("p", "P"));
    const { path: trashed } = await h["project:moveToTrash"]({ path: dir });
    expect(await codeOf(h["project:moveToTrash"]({ path: trashed }))).toBe("INVALID_PATH");
    expect(await codeOf(h["project:restoreFromTrash"]({ path: dir }))).toBe("INVALID_PATH");
    expect(
      await codeOf(h["project:restoreFromTrash"]({ path: path.join(library, TRASH_DIR) })),
    ).toBe("INVALID_PATH");
  });

  it("listTrash on a library without a trash folder is empty", async () => {
    expect(await makeHandlers()["project:listTrash"](undefined)).toEqual({ projects: [] });
  });
});

describe("project:discardBackups", () => {
  it("removes every backup so recovery is no longer offered", async () => {
    const h = makeHandlers();
    const dir = await writeProject(library, "B.reelform", doc("b", "B"));
    const backups = path.join(dir, "cache", "backups");
    await fsp.mkdir(backups, { recursive: true });
    const future = Date.parse("2027-01-01T00:00:00.000Z");
    await fsp.writeFile(path.join(backups, backupFileName(future)), JSON.stringify(doc("b", "B")));
    await fsp.writeFile(path.join(backups, "notes.txt"), "keep me");
    expect((await h["project:recovery"]({ path: dir })).recovery).not.toBeNull();
    expect(await h["project:discardBackups"]({ path: dir })).toEqual({ removed: 1 });
    expect((await h["project:recovery"]({ path: dir })).recovery).toBeNull();
    expect(await fsp.readdir(backups)).toEqual(["notes.txt"]);
    expect(await h["project:discardBackups"]({ path: dir })).toEqual({ removed: 0 });
  });
});
