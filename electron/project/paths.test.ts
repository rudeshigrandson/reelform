import * as fsp from "node:fs/promises";
import * as path from "node:path";
import fc from "fast-check";
import { atomicWriteFile } from "./atomicWrite";
import {
  MAX_BACKUPS,
  backupFileName,
  listBackups,
  parseBackupName,
  resolveBackupPath,
  writeBackup,
} from "./backups";
import { FsIpcError } from "./errors";
import {
  isWithin,
  numberedName,
  requireProjectPath,
  resolveWithin,
  resolveWithinSync,
  sanitizeName,
  splitExt,
  uniqueName,
} from "./paths";
import { createJsonRecentsStore, touchRecents } from "./recents";
import { faultyFs, makeTmpDir, realFs, removeDir } from "./testHelpers";

let tmp: string;
beforeEach(async () => {
  tmp = await makeTmpDir();
});
afterEach(async () => {
  await removeDir(tmp);
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof FsIpcError ? e.code : "other";
  }
  return undefined;
};

describe("sanitizeName", () => {
  it("strips separators, control chars and trailing dots", () => {
    expect(sanitizeName("My/Demo\\: v2..")).toBe("My Demo v2");
    expect(sanitizeName(`a${String.fromCharCode(0)}b${String.fromCharCode(10)}c`)).toBe("a b c");
    expect(sanitizeName("..")).toBe("");
    expect(sanitizeName("   ")).toBe("");
    expect(sanitizeName("CON")).toBe("CON_");
    expect(sanitizeName("clip.mp4")).toBe("clip.mp4");
  });

  it("property: result never contains separators or traversal and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const out = sanitizeName(s);
        expect(out).not.toMatch(/[/\\\0]/);
        expect(out === "." || out === "..").toBe(false);
        expect(out.length).toBeLessThanOrEqual(201);
        expect(sanitizeName(out)).toBe(out);
      }),
    );
  });
});

describe("numbered / unique names", () => {
  it("inserts the counter before the extension", () => {
    expect(numberedName("name.mp4", 1)).toBe("name.mp4");
    expect(numberedName("name.mp4", 2)).toBe("name (2).mp4");
    expect(numberedName("Demo.reelform", 3)).toBe("Demo (3).reelform");
    expect(numberedName("noext", 2)).toBe("noext (2)");
    expect(numberedName(".hidden", 2)).toBe(".hidden (2)");
    expect(splitExt("a.b.c")).toEqual({ stem: "a.b", ext: ".c" });
  });

  it("picks the first free slot", async () => {
    const taken = new Set(["name.mp4", "name (2).mp4"]);
    expect(await uniqueName("name.mp4", async (c) => taken.has(c))).toBe("name (3).mp4");
    expect(await uniqueName("other.mp4", async (c) => taken.has(c))).toBe("other.mp4");
  });

  it("property: the result is never taken", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 20 }), async (k) => {
        const taken = new Set(Array.from({ length: k }, (_, i) => numberedName("x.gif", i + 1)));
        const got = await uniqueName("x.gif", async (c) => taken.has(c));
        expect(taken.has(got)).toBe(false);
        expect(got).toBe(numberedName("x.gif", k + 1));
      }),
    );
  });
});

describe("path safety", () => {
  const root = "/projects/Demo.reelform";

  it("accepts nested relative paths", () => {
    expect(resolveWithinSync(root, "media/screen.mp4")).toBe(path.join(root, "media/screen.mp4"));
    expect(resolveWithinSync(root, "media/../cache/x")).toBe(path.join(root, "cache/x"));
  });

  it("rejects escapes, absolutes, the root itself and NUL", () => {
    expect(codeOf(() => resolveWithinSync(root, "../other/project.json"))).toBe(
      "PATH_OUTSIDE_ROOT",
    );
    expect(codeOf(() => resolveWithinSync(root, "media/../../x"))).toBe("PATH_OUTSIDE_ROOT");
    expect(codeOf(() => resolveWithinSync(root, "/etc/passwd"))).toBe("PATH_OUTSIDE_ROOT");
    expect(codeOf(() => resolveWithinSync(root, "C:\\Windows"))).toBe("PATH_OUTSIDE_ROOT");
    expect(codeOf(() => resolveWithinSync(root, "."))).toBe("PATH_OUTSIDE_ROOT");
    expect(codeOf(() => resolveWithinSync(root, ""))).toBe("PATH_OUTSIDE_ROOT");
    expect(codeOf(() => resolveWithinSync(root, "a\0b"))).toBe("INVALID_PATH");
    // Sibling with a shared prefix is not "inside".
    expect(isWithin(root, "/projects/Demo.reelform-evil/x")).toBe(false);
  });

  it("property: any accepted path stays inside the root", () => {
    const seg = fc.constantFrom("..", ".", "media", "a", "cache", "", "b.mp4");
    fc.assert(
      fc.property(fc.array(seg, { minLength: 1, maxLength: 6 }), (segs) => {
        const rel = segs.join("/");
        try {
          const abs = resolveWithinSync(root, rel);
          expect(isWithin(root, abs)).toBe(true);
          expect(abs).not.toBe(root);
        } catch (e) {
          expect(e).toBeInstanceOf(FsIpcError);
        }
      }),
    );
  });

  it("rejects a symlink inside the project that points outside", async () => {
    const proj = path.join(tmp, "P.reelform");
    const outside = path.join(tmp, "outside");
    await fsp.mkdir(proj);
    await fsp.mkdir(outside);
    await fsp.symlink(outside, path.join(proj, "media"));
    await expect(resolveWithin(realFs, proj, "media/new.mp4")).rejects.toMatchObject({
      code: "PATH_OUTSIDE_ROOT",
    });
    await fsp.mkdir(path.join(proj, "cache"));
    await expect(resolveWithin(realFs, proj, "cache/nested/file")).resolves.toBe(
      path.join(proj, "cache/nested/file"),
    );
  });

  it("requireProjectPath demands an absolute .reelform folder", () => {
    expect(requireProjectPath("/a/B.reelform/")).toBe("/a/B.reelform");
    expect(requireProjectPath("/a/B.REELFORM")).toBe("/a/B.REELFORM");
    expect(codeOf(() => requireProjectPath("B.reelform"))).toBe("INVALID_PATH");
    expect(codeOf(() => requireProjectPath("/a/B"))).toBe("INVALID_PATH");
    expect(codeOf(() => requireProjectPath("/a/B.reelform/../../etc"))).toBe("INVALID_PATH");
  });
});

describe("atomicWriteFile", () => {
  it("writes, replaces and leaves no temp file", async () => {
    const f = path.join(tmp, "project.json");
    await atomicWriteFile(realFs, f, "one");
    await atomicWriteFile(realFs, f, "two");
    expect(await fsp.readFile(f, "utf8")).toBe("two");
    expect(await fsp.readdir(tmp)).toEqual(["project.json"]);
  });

  it("a failed rename keeps the previous content and removes the temp", async () => {
    const f = path.join(tmp, "project.json");
    await atomicWriteFile(realFs, f, "good");
    const fs = faultyFs({
      rename: async () => {
        throw Object.assign(new Error("boom"), { code: "EIO" });
      },
    });
    await expect(atomicWriteFile(fs, f, "bad")).rejects.toThrow("boom");
    expect(await fsp.readFile(f, "utf8")).toBe("good");
    expect(await fsp.readdir(tmp)).toEqual(["project.json"]);
  });

  it("fsyncs the temp file before renaming", async () => {
    const order: string[] = [];
    const fs = faultyFs({
      open: (async (p: string, flags: string) => {
        const h = await fsp.open(p, flags);
        const sync = h.sync.bind(h);
        h.sync = async () => {
          order.push(`sync:${path.basename(p)}`);
          await sync();
        };
        return h;
      }) as typeof fsp.open,
      rename: async (a, b) => {
        order.push("rename");
        await fsp.rename(a, b);
      },
    });
    await atomicWriteFile(fs, path.join(tmp, "x.json"), "{}");
    expect(order.slice(0, 2)).toEqual(["sync:x.json.tmp", "rename"]);
  });

  it("handles multi-megabyte payloads", async () => {
    const big = "x".repeat(3 * 1024 * 1024 + 7);
    const f = path.join(tmp, "big.json");
    await atomicWriteFile(realFs, f, big);
    expect((await fsp.stat(f)).size).toBe(big.length);
  });
});

describe("backups", () => {
  it("names sort lexically in time order and round-trip", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8_000_000_000_000 }),
        fc.integer({ min: 0, max: 8_000_000_000_000 }),
        (a, b) => {
          const na = backupFileName(a);
          expect(parseBackupName(na)?.savedAtMs).toBe(a);
          if (a < b) expect(na < backupFileName(b)).toBe(true);
        },
      ),
    );
    expect(parseBackupName("autosave-1.json")).toBeNull();
    expect(parseBackupName("../autosave-000000000000001.json")).toBeNull();
  });

  it("keeps only the newest five and orders newest first", async () => {
    for (let i = 0; i < 8; i++) await writeBackup(realFs, tmp, `{"i":${i}}`, 1000 + i * 10);
    const list = await listBackups(realFs, tmp);
    expect(list).toHaveLength(MAX_BACKUPS);
    expect(list.map((b) => b.savedAtMs)).toEqual([1070, 1060, 1050, 1040, 1030]);
    const newest = list[0];
    if (!newest) throw new Error("expected a backup");
    expect(await fsp.readFile(path.join(tmp, "cache/backups", newest.name), "utf8")).toBe(
      '{"i":7}',
    );
  });

  it("same-millisecond autosaves both survive with strictly increasing stamps", async () => {
    const a = await writeBackup(realFs, tmp, "a", 5000);
    const b = await writeBackup(realFs, tmp, "b", 5000);
    const c = await writeBackup(realFs, tmp, "c", 4000); // clock went backwards
    expect([a.savedAtMs, b.savedAtMs, c.savedAtMs]).toEqual([5000, 5001, 5002]);
  });

  it("ignores foreign files and a missing folder", async () => {
    expect(await listBackups(realFs, tmp)).toEqual([]);
    await fsp.mkdir(path.join(tmp, "cache/backups"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "cache/backups/notes.txt"), "x");
    await writeBackup(realFs, tmp, "{}", 1);
    expect((await listBackups(realFs, tmp)).map((b) => b.name)).toEqual([backupFileName(1)]);
    expect(await fsp.readdir(path.join(tmp, "cache/backups"))).toContain("notes.txt");
  });

  it("resolveBackupPath only accepts backup file names", () => {
    expect(resolveBackupPath(tmp, backupFileName(3))).toBe(
      path.join(tmp, "cache/backups", backupFileName(3)),
    );
    expect(codeOf(() => resolveBackupPath(tmp, "../../project.json"))).toBe("NO_BACKUP");
  });
});

describe("recents", () => {
  it("touchRecents moves to front, dedupes and caps", () => {
    expect(touchRecents(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(touchRecents(["a", "b"], "c", 2)).toEqual(["c", "a"]);
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "b", "c", "d")),
        fc.constantFrom("a", "e"),
        (l, p) => {
          const out = touchRecents([...new Set(l)], p, 3);
          expect(out[0]).toBe(p);
          expect(new Set(out).size).toBe(out.length);
          expect(out.length).toBeLessThanOrEqual(3);
        },
      ),
    );
  });

  it("persists, survives corrupt files and serializes concurrent writers", async () => {
    const filePath = path.join(tmp, "user/recents.json");
    const store = createJsonRecentsStore({ fs: realFs, filePath });
    expect(await store.list()).toEqual([]);
    await Promise.all(["/a", "/b", "/c", "/d"].map((p) => store.touch(p)));
    expect((await store.list()).sort()).toEqual(["/a", "/b", "/c", "/d"]);
    await store.remove("/b");
    expect(await store.list()).not.toContain("/b");
    await fsp.writeFile(filePath, "{nope");
    expect(await store.list()).toEqual([]);
    await store.touch("/z");
    expect(await store.list()).toEqual(["/z"]);
  });
});
