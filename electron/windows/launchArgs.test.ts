import fc from "fast-check";
import {
  createLaunchIntentQueue,
  dispatchLaunchIntents,
  isProjectPath,
  parseDeepLink,
  parseLaunchArgs,
  parseOpenFile,
} from "./launchArgs";

describe("parseDeepLink", () => {
  it("parses reelform://open?path= with an absolute posix path", () => {
    expect(parseDeepLink("reelform://open?path=%2FUsers%2Fme%2FDemo.reelform", "darwin")).toEqual({
      type: "open-project",
      path: "/Users/me/Demo.reelform",
    });
    expect(parseDeepLink("reelform://open/?path=/a/b.reelform/", "linux")?.path).toBe(
      "/a/b.reelform/",
    );
    expect(parseDeepLink("reelform:open?path=/a/b.reelform", "linux")?.path).toBe("/a/b.reelform");
  });

  it("parses Windows absolute paths only on win32", () => {
    const url = `reelform://open?path=${encodeURIComponent("C:\\Users\\me\\Demo.reelform")}`;
    expect(parseDeepLink(url, "win32")?.path).toBe("C:\\Users\\me\\Demo.reelform");
    expect(parseDeepLink(url, "darwin")).toBeNull();
  });

  it("rejects UNC and device paths on win32 (no remote SMB access from a link)", () => {
    for (const p of [
      "\\\\evil.example\\share\\x.reelform",
      "//evil.example/share/x.reelform",
      "\\\\?\\C:\\p\\x.reelform",
      "\\\\.\\C:\\p\\x.reelform",
    ]) {
      expect(parseDeepLink(`reelform://open?path=${encodeURIComponent(p)}`, "win32")).toBeNull();
    }
  });

  it("property: win32 deep-link results are never UNC paths", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseDeepLink(`reelform://open?path=${encodeURIComponent(s)}`, "win32");
        if (r) expect(r.path.startsWith("\\\\")).toBe(false);
      }),
    );
  });

  it("rejects other schemes, actions, relative paths, other extensions, control chars", () => {
    for (const bad of [
      "https://open?path=/a.reelform",
      "reelform://delete?path=/a.reelform",
      "reelform://open",
      "reelform://open?path=",
      "reelform://open?path=a.reelform",
      "reelform://open?path=../../etc/x.reelform",
      "reelform://open?path=/etc/passwd",
      "reelform://open?path=/a%00.reelform",
      "not a url",
    ]) {
      expect(parseDeepLink(bad, "darwin")).toBeNull();
    }
  });

  it("normalises dot segments so the result stays absolute", () => {
    expect(parseDeepLink("reelform://open?path=/a/../b/./c.reelform", "linux")?.path).toBe(
      "/b/c.reelform",
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.constantFrom("darwin", "win32", "linux") as fc.Arbitrary<"darwin" | "win32" | "linux">,
        (s, p) => {
          const r = parseDeepLink(s, p);
          if (r) expect(isProjectPath(r.path)).toBe(true);
        },
      ),
    );
  });
});

describe("parseLaunchArgs", () => {
  it("skips exe, flags and non-project args; resolves relative paths against cwd", () => {
    const argv = [
      "/Applications/Reelform.app/Contents/MacOS/Reelform",
      "--allow-file-access-from-files",
      "notes.txt",
      "Demo.reelform",
      "/abs/Other.REELFORM",
    ];
    expect(parseLaunchArgs(argv, { cwd: "/Users/me", platform: "darwin" })).toEqual([
      { type: "open-project", path: "/Users/me/Demo.reelform" },
      { type: "open-project", path: "/abs/Other.REELFORM" },
    ]);
  });

  it("accepts deep links in argv (Windows/Linux second-instance) and dedupes", () => {
    const argv = [
      "C:\\Program Files\\Reelform\\Reelform.exe",
      "reelform://open?path=C%3A%5Cp%5CA.reelform",
      "C:\\p\\A.reelform",
      "reelform://evil?path=C%3A%5Cp%5CB.reelform",
    ];
    expect(parseLaunchArgs(argv, { cwd: "C:\\", platform: "win32" })).toEqual([
      { type: "open-project", path: "C:\\p\\A.reelform" },
    ]);
  });

  it("returns nothing for a bare launch", () => {
    expect(parseLaunchArgs(["/usr/bin/reelform"], { cwd: "/", platform: "linux" })).toEqual([]);
    expect(parseLaunchArgs([], { cwd: "/", platform: "linux" })).toEqual([]);
  });
});

describe("dispatchLaunchIntents", () => {
  it("focuses the app when there is nothing to open", async () => {
    const focusApp = vi.fn();
    const openProjectFile = vi.fn();
    await dispatchLaunchIntents([], { focusApp, openProjectFile });
    expect(focusApp).toHaveBeenCalledOnce();
    expect(openProjectFile).not.toHaveBeenCalled();
  });

  it("opens each project in order", async () => {
    const opened: string[] = [];
    await dispatchLaunchIntents(
      [
        { type: "open-project", path: "/a.reelform" },
        { type: "open-project", path: "/b.reelform" },
      ],
      { focusApp: vi.fn(), openProjectFile: async (p) => void opened.push(p) },
    );
    expect(opened).toEqual(["/a.reelform", "/b.reelform"]);
  });
});

describe("parseOpenFile", () => {
  it("accepts absolute project paths only", () => {
    expect(parseOpenFile("/Users/me/Demo.reelform", "darwin")).toEqual({
      type: "open-project",
      path: "/Users/me/Demo.reelform",
    });
    expect(parseOpenFile("/Users/me/../me/Demo.reelform/", "darwin")?.path).toBe(
      "/Users/me/Demo.reelform/",
    );
    expect(parseOpenFile("C:\\p\\Demo.reelform", "win32")?.path).toBe("C:\\p\\Demo.reelform");
    expect(parseOpenFile("Demo.reelform", "darwin")).toBeNull();
    expect(parseOpenFile("/Users/me/movie.mp4", "darwin")).toBeNull();
    expect(parseOpenFile("/a\u0000.reelform", "darwin")).toBeNull();
    expect(parseOpenFile("", "darwin")).toBeNull();
  });
});

describe("createLaunchIntentQueue", () => {
  it("holds intents until start, dedupes, then dispatches directly", () => {
    const q = createLaunchIntentQueue();
    const a = { type: "open-project" as const, path: "/a.reelform" };
    const b = { type: "open-project" as const, path: "/b.reelform" };
    q.push(a);
    q.push(a);
    q.push(b);
    expect(q.pending()).toEqual([a, b]);
    const opened: string[] = [];
    q.start((i) => opened.push(i.path));
    expect(opened).toEqual(["/a.reelform", "/b.reelform"]);
    expect(q.pending()).toEqual([]);
    q.push(a);
    expect(opened).toEqual(["/a.reelform", "/b.reelform", "/a.reelform"]);
  });
});
