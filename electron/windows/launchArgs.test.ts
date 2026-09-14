import fc from "fast-check";
import { dispatchLaunchIntents, isProjectPath, parseDeepLink, parseLaunchArgs } from "./launchArgs";

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
