import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { systemProjectFileContracts } from "./contracts";
import { createPickedPathRegistry } from "./pickedPaths";
import {
  ProjectFileError,
  createProjectFileHandlers,
  numberedFileName,
  resolveInProject,
  sanitizeFileName,
} from "./projectFiles";
import { createNodeProjectFileDeps, isInsideProjectFolder } from "./projectFilesNode";

let dir: string;
let project: string;
const h = () => createProjectFileHandlers(createNodeProjectFileDeps("darwin"));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reelform-projectfiles-"));
  project = join(dir, "Demo.reelform");
  await mkdir(join(project, "media"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pure helpers", () => {
  it("numbers names before the extension", () => {
    expect(numberedFileName("clip.mp4", 1)).toBe("clip.mp4");
    expect(numberedFileName("clip.mp4", 2)).toBe("clip (2).mp4");
    expect(numberedFileName("README", 3)).toBe("README (3)");
    expect(numberedFileName(".hidden", 2)).toBe(".hidden (2)");
  });

  it("sanitizes names to a safe basename", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\a:b?.wav")).toBe("a_b_.wav");
    expect(sanitizeFileName("...")).toBe("imported");
    expect(sanitizeFileName("  ")).toBe("imported");
  });

  it("property: resolveInProject never returns a path outside the project", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("..", ".", "media", "a", "b.mp4", "", "/", "\\"), {
          maxLength: 8,
        }),
        (parts) => {
          const rel = parts.join("/");
          const abs = resolveInProject("/p/Demo.reelform", rel, "darwin");
          if (abs !== null) {
            expect(abs.startsWith("/p/Demo.reelform/")).toBe(true);
          }
        },
      ),
    );
  });
});

describe("system:readTextFile / system:writeTextFile", () => {
  it("round-trips UTF-8 text and creates parent folders", async () => {
    const target = join(dir, "exports", "captions.srt");
    const text = "1\n00:00:00,000 --> 00:00:01,000\nNamaste — héllo 👋\n";
    expect(await h()["system:writeTextFile"]({ path: target, contents: text })).toEqual({
      ok: true,
    });
    expect(await h()["system:readTextFile"]({ path: target })).toEqual({ text });
  });

  it("rejects relative paths and reports read failures with a code", async () => {
    await expect(h()["system:readTextFile"]({ path: "captions.srt" })).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    await expect(
      h()["system:readTextFile"]({ path: join(dir, "missing.srt") }),
    ).rejects.toBeInstanceOf(ProjectFileError);
  });
});

describe("text I/O access policy (§13)", () => {
  const enforced = (opts: { picked?: string[]; projectOnly?: boolean } = {}) => {
    const pickedPaths = createPickedPathRegistry("linux");
    for (const p of opts.picked ?? []) pickedPaths.add(p);
    return createProjectFileHandlers(
      createNodeProjectFileDeps({
        platform: "darwin",
        pickedPaths,
        isProjectPath: opts.projectOnly === false ? undefined : isInsideProjectFolder,
      }),
    );
  };

  beforeEach(async () => {
    await writeFile(join(project, "project.json"), "{}");
  });

  it("allows dialog-picked paths anywhere with a text extension", async () => {
    const target = join(dir, "Desktop", "captions.srt");
    const h2 = enforced({ picked: [target] });
    await h2["system:writeTextFile"]({ path: target, contents: "1\n" });
    expect(await h2["system:readTextFile"]({ path: target })).toEqual({ text: "1\n" });
  });

  it("allows paths inside a project folder, creating parents", async () => {
    const target = join(project, "exports", "captions.vtt");
    const h2 = enforced();
    await h2["system:writeTextFile"]({ path: target, contents: "WEBVTT" });
    expect(await h2["system:readTextFile"]({ path: target })).toEqual({ text: "WEBVTT" });
  });

  it("rejects unpicked paths outside projects without touching the disk", async () => {
    const target = join(dir, "elsewhere", "notes.txt");
    const h2 = enforced();
    await expect(h2["system:writeTextFile"]({ path: target, contents: "x" })).rejects.toMatchObject(
      { code: "PATH_OUTSIDE_PROJECT" },
    );
    await expect(readFile(target, "utf8")).rejects.toThrow();
    await writeFile(join(dir, "secret.json"), "{}");
    await expect(
      h2["system:readTextFile"]({ path: join(dir, "secret.json") }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });

  it("rejects non-text extensions even when picked or inside a project", async () => {
    const picked = join(dir, "movie.mp4");
    const h2 = enforced({ picked: [picked] });
    await expect(h2["system:writeTextFile"]({ path: picked, contents: "x" })).rejects.toMatchObject(
      {
        code: "PATH_OUTSIDE_PROJECT",
      },
    );
    await expect(
      h2["system:readTextFile"]({ path: join(project, "media", "screen.mp4") }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });

  it("a folder named .reelform without project.json is not a project", async () => {
    const fake = join(dir, "Fake.reelform");
    await mkdir(fake, { recursive: true });
    await expect(
      enforced()["system:writeTextFile"]({ path: join(fake, "a.txt"), contents: "x" }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });

  it("a symlink out of a project does not count as inside it", async () => {
    const outside = join(dir, "outside");
    await mkdir(outside, { recursive: true });
    const linked = await symlink(outside, join(project, "escape")).then(
      () => true,
      () => false,
    );
    if (!linked) return;
    expect(await isInsideProjectFolder(join(project, "escape", "a.txt"))).toBe(false);
    expect(await isInsideProjectFolder(join(project, "cache", "new", "a.txt"))).toBe(true);
  });

  it("picked-only mode (no project predicate) still enforces", async () => {
    const h2 = enforced({ projectOnly: false });
    await expect(h2["system:readTextFile"]({ path: join(project, "a.txt") })).rejects.toMatchObject(
      { code: "PATH_OUTSIDE_PROJECT" },
    );
  });

  it("picked-path registry normalizes and folds case on macOS/Windows", () => {
    const mac = createPickedPathRegistry("darwin");
    mac.add("/Users/Me/Desktop/../Desktop/A.srt");
    expect(mac.has("/users/me/desktop/a.srt")).toBe(true);
    const linux = createPickedPathRegistry("linux");
    linux.add("/home/me/A.srt");
    expect(linux.has("/home/me/a.srt")).toBe(false);
    linux.add("bad\0path");
    expect(linux.has("bad\0path")).toBe(false);
  });
});

describe("system:copyIntoProject", () => {
  it("copies into media/imported/<kind> and uniquifies on collision", async () => {
    const src = join(dir, "My Music.mp3");
    await writeFile(src, "audio-bytes");
    const first = await h()["system:copyIntoProject"]({
      projectPath: project,
      kind: "audio",
      sourcePath: src,
    });
    const second = await h()["system:copyIntoProject"]({
      projectPath: project,
      kind: "audio",
      sourcePath: src,
    });
    expect(first.relPath).toBe("media/imported/audio/My Music.mp3");
    expect(second.relPath).toBe("media/imported/audio/My Music (2).mp3");
    expect(await readFile(join(project, "media/imported/audio/My Music (2).mp3"), "utf8")).toBe(
      "audio-bytes",
    );
    expect(systemProjectFileContracts["system:copyIntoProject"].response.parse(second)).toEqual(
      second,
    );
  });

  it("fails with SOURCE_NOT_FOUND when the picked file is gone", async () => {
    await expect(
      h()["system:copyIntoProject"]({
        projectPath: project,
        kind: "webcam",
        sourcePath: join(dir, "gone.mp4"),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });
});

describe("system:statFiles", () => {
  it("returns sizes, null for missing files, and omits paths outside the project", async () => {
    await writeFile(join(project, "media", "screen.mp4"), "12345");
    await writeFile(join(dir, "secret.txt"), "nope");
    await symlink(join(dir, "secret.txt"), join(project, "media", "link.txt")).catch(() => {});
    const { stats } = await h()["system:statFiles"]({
      projectPath: project,
      relPaths: ["media/screen.mp4", "media/mic.m4a", "../secret.txt", "/etc/hosts", "media"],
    });
    expect(stats["media/screen.mp4"]).toEqual({ sizeBytes: 5 });
    expect(stats["media/mic.m4a"]).toBeNull();
    expect("../secret.txt" in stats).toBe(false);
    expect("/etc/hosts" in stats).toBe(false);
    // A directory is not a source file.
    expect(stats.media).toBeNull();
    expect(systemProjectFileContracts["system:statFiles"].response.parse({ stats })).toEqual({
      stats,
    });
  });
});
