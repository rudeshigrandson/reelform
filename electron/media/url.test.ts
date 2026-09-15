import * as nodePath from "node:path";
import { extensionOf, mimeForPath } from "./mime";
import { createMediaRootRegistry, isInsideRoot, resolveMediaPath } from "./roots";
import { isValidRootId, parseMediaUrl, toMediaUrl } from "./url";

describe("media URLs", () => {
  it("round-trips paths with spaces, unicode and reserved characters", () => {
    const url = toMediaUrl("proj-1", "media/my clip #1 ü?.mp4");
    expect(url).toBe("reelform-media://proj-1/media/my%20clip%20%231%20%C3%BC%3F.mp4");
    expect(parseMediaUrl(url)).toEqual({
      ok: true,
      rootId: "proj-1",
      segments: ["media", "my clip #1 ü?.mp4"],
    });
  });

  it("accepts backslash-separated relative paths when building", () => {
    expect(toMediaUrl("r", "media\\a.webm")).toBe("reelform-media://r/media/a.webm");
  });

  it("ignores query and fragment", () => {
    expect(parseMediaUrl("reelform-media://r/a.mp4?t=1#x")).toEqual({
      ok: true,
      rootId: "r",
      segments: ["a.mp4"],
    });
  });

  it("rejects traversal in raw, encoded and separator-smuggling forms", () => {
    for (const u of [
      "reelform-media://r/../etc/passwd",
      "reelform-media://r/media/../../x",
      "reelform-media://r/%2e%2e/x",
      "reelform-media://r/.%2E/x",
      "reelform-media://r/..%2Fx",
      "reelform-media://r/a%5C..%5Cb",
      "reelform-media://r/a%00b",
      "reelform-media://r/./a",
    ]) {
      expect(parseMediaUrl(u)).toEqual({ ok: false, reason: "traversal" });
    }
  });

  it("rejects other schemes, bad hosts and bad escapes as malformed", () => {
    for (const u of [
      "file:///etc/passwd",
      "not a url",
      "reelform-media:///a",
      "reelform-media://bad_host/a",
      "reelform-media://r/%E0%A4%A",
    ]) {
      expect(parseMediaUrl(u)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("root id rules", () => {
    expect(isValidRootId("r-abc123")).toBe(true);
    expect(isValidRootId("-a")).toBe(false);
    expect(isValidRootId("A")).toBe(false);
    expect(isValidRootId("a".repeat(64))).toBe(false);
  });
});

describe("mime", () => {
  it.each([
    ["a.mp4", "video/mp4"],
    ["a.WEBM", "video/webm"],
    ["a.m4a", "audio/mp4"],
    ["a.wav", "audio/wav"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["telemetry.json", "application/json"],
    ["telemetry.json.gz", "application/gzip"],
    ["c.srt", "application/x-subrip"],
    ["c.vtt", "text/vtt"],
    ["noext", "application/octet-stream"],
    [".hidden", "application/octet-stream"],
    ["dir.mp4/file", "application/octet-stream"],
  ])("%s → %s", (p, m) => {
    expect(mimeForPath(p)).toBe(m);
  });

  it("extension of windows path", () => {
    expect(extensionOf("C:\\x\\clip.MP4")).toBe("mp4");
  });
});

describe("resolveMediaPath", () => {
  const registry = createMediaRootRegistry();
  registry.add({ id: "proj", realPath: "/projects/p" });
  const links: Record<string, string> = {
    "/projects/p/media/a.mp4": "/projects/p/media/a.mp4",
    "/projects/p/escape.mp4": "/etc/secret.mp4",
    "/projects/p/inner.mp4": "/projects/p/media/a.mp4",
    "/projects/p/sibling.mp4": "/projects/p2/b.mp4",
  };
  const realpath = async (p: string) => {
    const r = links[p];
    if (!r) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return r;
  };
  const deps = { registry, realpath, path: nodePath.posix };

  it("resolves a file inside the root", async () => {
    expect(await resolveMediaPath(deps, "proj", ["media", "a.mp4"])).toEqual({
      ok: true,
      path: "/projects/p/media/a.mp4",
    });
  });

  it("follows symlinks that stay inside", async () => {
    expect(await resolveMediaPath(deps, "proj", ["inner.mp4"])).toEqual({
      ok: true,
      path: "/projects/p/media/a.mp4",
    });
  });

  it("403 for a symlink escaping the root, including a prefix-sharing sibling", async () => {
    expect(await resolveMediaPath(deps, "proj", ["escape.mp4"])).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await resolveMediaPath(deps, "proj", ["sibling.mp4"])).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("403 for unregistered roots, the root itself, and lexical escape", async () => {
    expect(await resolveMediaPath(deps, "other", ["a.mp4"])).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await resolveMediaPath(deps, "proj", [])).toMatchObject({ ok: false, status: 403 });
    expect(await resolveMediaPath(deps, "proj", ["..", "p2", "b.mp4"])).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("404 for missing files", async () => {
    expect(await resolveMediaPath(deps, "proj", ["missing.mp4"])).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("stops serving after unregister", async () => {
    const reg = createMediaRootRegistry();
    reg.add({ id: "x", realPath: "/projects/p" });
    expect(reg.remove("x")).toBe(true);
    expect(reg.remove("x")).toBe(false);
    expect(
      await resolveMediaPath({ ...deps, registry: reg }, "x", ["media", "a.mp4"]),
    ).toMatchObject({ status: 403 });
  });

  it("rejects invalid root ids on add", () => {
    expect(() => createMediaRootRegistry().add({ id: "Bad!", realPath: "/x" })).toThrow(
      /Invalid media root id/,
    );
  });

  it("a child whose name merely starts with '..' is inside the root", () => {
    const p = nodePath.posix;
    expect(isInsideRoot("/projects/p", "/projects/p/..foo.mp4", p)).toBe(true);
    expect(isInsideRoot("/projects/p", "/projects/p/...", p)).toBe(true);
    expect(isInsideRoot("/projects/p", "/projects", p)).toBe(false);
    expect(isInsideRoot("/projects/p", "/projects/p/../..x", p)).toBe(false);
    expect(isInsideRoot("C:\\Proj", "C:\\Proj\\..clip.mp4", nodePath.win32)).toBe(true);
    expect(isInsideRoot("C:\\Proj", "C:\\other", nodePath.win32)).toBe(false);
  });

  it("windows paths: containment is case-insensitive and drive-aware", async () => {
    const w = nodePath.win32;
    expect(isInsideRoot("C:\\Proj", "c:\\proj\\media\\a.mp4", w)).toBe(true);
    expect(isInsideRoot("C:\\Proj", "D:\\Proj\\a.mp4", w)).toBe(false);
    expect(isInsideRoot("C:\\Proj", "C:\\Project\\a.mp4", w)).toBe(false);
    const reg = createMediaRootRegistry();
    reg.add({ id: "w", realPath: "C:\\Proj" });
    const res = await resolveMediaPath({ registry: reg, realpath: async (p) => p, path: w }, "w", [
      "media",
      "a.mp4",
    ]);
    expect(res).toEqual({ ok: true, path: "C:\\Proj\\media\\a.mp4" });
  });
});
