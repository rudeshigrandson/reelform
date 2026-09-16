import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createMediaRootRegistry } from "../media/roots";
import { parseMediaUrl } from "../media/url";
import { errnoCode } from "./errors";
import { type ProjectDeps, createProjectHandlers } from "./handlers";
import { createFolderSizeCache } from "./librarySize";
import type { RecentsStore } from "./recents";
import { faultyFs, makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";
import { createThumbnailUrlResolver, projectRootId } from "./thumbnailUrls";

/** `project:list` thumbnails (reelform-media URLs) and folder sizes (guide S04/S23). */

let tmp: string;
let library: string;
let recentsList: string[];
const clock = manualClock();

const memoryRecents = (): RecentsStore => ({
  list: async () => [...recentsList],
  touch: async () => {},
  remove: async () => {},
});

function makeHandlers(overrides: Partial<ProjectDeps> = {}) {
  return createProjectHandlers({
    fs: realFs,
    now: clock.now,
    libraryRoot: async () => library,
    recents: memoryRecents(),
    validate: (doc) => ({ ok: true, value: doc }),
    trashItem: async () => {},
    probe: async () => ({ durationMs: 0, width: null, height: null }),
    ...overrides,
  });
}

async function writeProject(
  name: string,
  files: Record<string, string> = {},
  parent = library,
): Promise<string> {
  const dir = path.join(parent, name);
  await fsp.mkdir(path.join(dir, "media"), { recursive: true });
  const all = { "project.json": JSON.stringify({ id: name, name }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fsp.writeFile(path.join(dir, rel), content);
  }
  return dir;
}

const bytesOf = (files: Record<string, string>, name: string) =>
  Buffer.byteLength(JSON.stringify({ id: name, name })) +
  Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0);

beforeEach(async () => {
  tmp = await makeTmpDir();
  library = path.join(tmp, "Library");
  await fsp.mkdir(library);
  recentsList = [];
});

afterEach(() => removeDir(tmp));

describe("project:list thumbnails", () => {
  it("returns a reelform-media URL for a present thumbnail and null when absent", async () => {
    const registry = createMediaRootRegistry();
    const withThumb = await writeProject("A.reelform", { "thumbnail.jpg": "jpeg" });
    await writeProject("B.reelform");
    const h = makeHandlers({
      thumbnailUrl: createThumbnailUrlResolver({ registry, realpath: (p) => fsp.realpath(p) }),
    });

    const { projects } = await h["project:list"](undefined);
    const a = projects.find((p) => p.name === "A.reelform");
    const b = projects.find((p) => p.name === "B.reelform");
    expect(b).toMatchObject({ thumbnailPath: null, thumbnailUrl: null });
    expect(a?.thumbnailPath).toBe(path.join(withThumb, "thumbnail.jpg"));

    const url = a?.thumbnailUrl ?? "";
    const parsed = parseMediaUrl(url);
    expect(parsed).toEqual({
      ok: true,
      rootId: projectRootId(await fsp.realpath(withThumb)),
      segments: ["thumbnail.jpg"],
    });
    expect(url).toMatch(/\?v=\d+$/);
    // The folder is allow-listed so the protocol handler can serve it.
    expect(registry.list()).toEqual([
      { id: projectRootId(await fsp.realpath(withThumb)), realPath: await fsp.realpath(withThumb) },
    ]);

    // Listing again reuses the same root instead of piling up registrations.
    await h["project:list"](undefined);
    expect(registry.list()).toHaveLength(1);
  });

  it("has no URL without a resolver, or when the resolver fails", async () => {
    await writeProject("A.reelform", { "thumbnail.jpg": "jpeg" });
    const plain = (await makeHandlers()["project:list"](undefined)).projects[0];
    expect(plain).toMatchObject({ thumbnailUrl: null });
    expect(plain?.thumbnailPath).not.toBeNull();

    const failing = makeHandlers({
      thumbnailUrl: async () => {
        throw new Error("registry closed");
      },
    });
    expect((await failing["project:list"](undefined)).projects[0]).toMatchObject({
      name: "A.reelform",
      thumbnailUrl: null,
    });
  });

  it("trash entries carry the thumbnail URL too", async () => {
    await writeProject("Old.reelform", { "thumbnail.jpg": "jpeg" }, path.join(library, ".trash"));
    const h = makeHandlers({ thumbnailUrl: async () => "reelform-media://p-1/thumbnail.jpg" });
    expect((await h["project:listTrash"](undefined)).projects[0]).toMatchObject({
      thumbnailUrl: "reelform-media://p-1/thumbnail.jpg",
    });
  });
});

describe("project:list sizes", () => {
  it("sums every file in the project folder; missing projects read null", async () => {
    const files = { "media/screen.mp4": "x".repeat(2048), "exports/out.mp4": "y".repeat(100) };
    await writeProject("A.reelform", files);
    const gone = path.join(tmp, "Gone.reelform");
    recentsList = [gone];
    const { projects } = await makeHandlers()["project:list"](undefined);
    expect(projects.find((p) => p.name === "A.reelform")?.sizeBytes).toBe(
      bytesOf(files, "A.reelform"),
    );
    expect(projects.find((p) => p.path === gone)).toMatchObject({ missing: true, sizeBytes: null });
  });

  it("an unreadable folder still lists, with a null size", async () => {
    const dir = await writeProject("Locked.reelform", { "media/a.mp4": "abc" });
    const fs = faultyFs({
      readdir: (async (p: Parameters<typeof fsp.readdir>[0], opts?: unknown) => {
        if (String(p) === dir) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return (fsp.readdir as (...a: unknown[]) => unknown)(p, opts);
      }) as typeof fsp.readdir,
    });
    const { projects } = await makeHandlers({ fs })["project:list"](undefined);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ path: dir, name: "Locked.reelform", sizeBytes: null });
  });

  it("caches a folder's size until its fingerprint changes", async () => {
    const dir = await writeProject("A.reelform", { "media/a.mp4": "abc" });
    let walks = 0;
    const fs = faultyFs({
      readdir: (async (p: Parameters<typeof fsp.readdir>[0], opts?: unknown) => {
        if (String(p) === path.join(dir, "media")) walks++;
        return (fsp.readdir as (...a: unknown[]) => unknown)(p, opts);
      }) as typeof fsp.readdir,
    });
    const cache = createFolderSizeCache(fs);
    const first = await cache.sizeOf(dir);
    expect(await cache.sizeOf(dir)).toBe(first);
    expect(walks).toBe(1);

    // A new media file bumps media/'s mtime → re-walk.
    await new Promise((r) => setTimeout(r, 15));
    await fsp.writeFile(path.join(dir, "media", "b.mp4"), "defg");
    expect(await cache.sizeOf(dir)).toBe((first ?? 0) + 4);
    expect(walks).toBe(2);
  });

  it("skips symlinks and survives entries that vanish mid-walk", async () => {
    const dir = await writeProject("A.reelform", { "media/a.mp4": "abc" });
    const outside = path.join(tmp, "big.bin");
    await fsp.writeFile(outside, "z".repeat(5000));
    try {
      await fsp.symlink(outside, path.join(dir, "media", "link.bin"));
    } catch (e) {
      if (errnoCode(e) !== "EPERM") throw e; // Windows without symlink rights
    }
    const fs = faultyFs({
      stat: (async (p: Parameters<typeof fsp.stat>[0]) => {
        if (String(p).endsWith("a.mp4")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return fsp.stat(p);
      }) as typeof fsp.stat,
    });
    const size = await createFolderSizeCache(fs).sizeOf(dir);
    expect(size).toBe(Buffer.byteLength(JSON.stringify({ id: "A.reelform", name: "A.reelform" })));
  });
});
