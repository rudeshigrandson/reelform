import * as nodePath from "node:path";
import {
  type FfmpegPathDeps,
  binaryCandidates,
  resolveFfmpegPaths,
  toAsarUnpacked,
} from "./ffmpegPaths";

const posix = { ...nodePath.posix, delimiter: ":" };
const win = { ...nodePath.win32, delimiter: ";" };

const base = (over: Partial<FfmpegPathDeps>): FfmpegPathDeps => ({
  platform: "darwin",
  arch: "arm64",
  appPath: "/Applications/Reelform.app/Contents/Resources/app.asar",
  env: {},
  exists: () => false,
  path: posix,
  ...over,
});

describe("ffmpeg binary resolution", () => {
  it("maps app.asar to app.asar.unpacked only as a path segment", () => {
    expect(toAsarUnpacked("/r/app.asar/node_modules/x")).toBe(
      "/r/app.asar.unpacked/node_modules/x",
    );
    expect(toAsarUnpacked("C:\\r\\app.asar\\x")).toBe("C:\\r\\app.asar.unpacked\\x");
    expect(toAsarUnpacked("/r/my-app.asarx/x")).toBe("/r/my-app.asarx/x");
  });

  it("packaged mac layout resolves from asar.unpacked (ffprobe-static per platform/arch)", () => {
    const unpacked = "/Applications/Reelform.app/Contents/Resources/app.asar.unpacked/node_modules";
    const existing = new Set([
      `${unpacked}/ffmpeg-static/ffmpeg`,
      `${unpacked}/ffprobe-static/bin/darwin/arm64/ffprobe`,
    ]);
    expect(resolveFfmpegPaths(base({ exists: (p) => existing.has(p) }))).toEqual({
      ffmpeg: `${unpacked}/ffmpeg-static/ffmpeg`,
      ffprobe: `${unpacked}/ffprobe-static/bin/darwin/arm64/ffprobe`,
    });
  });

  it("windows layout uses .exe and backslashes", () => {
    const deps = base({
      platform: "win32",
      arch: "x64",
      appPath: "C:\\Reelform\\resources\\app.asar",
      path: win,
    });
    expect(binaryCandidates(deps, "ffprobe")[0]).toBe(
      "C:\\Reelform\\resources\\app.asar.unpacked\\node_modules\\ffprobe-static\\bin\\win32\\x64\\ffprobe.exe",
    );
  });

  it("dev layout (no asar) has no duplicate candidate", () => {
    const c = binaryCandidates(base({ appPath: "/repo" }), "ffmpeg");
    expect(c).toEqual(["/repo/node_modules/ffmpeg-static/ffmpeg"]);
  });

  it("env override wins, PATH is last", () => {
    const deps = base({
      env: { REELFORM_FFMPEG_PATH: "/opt/ff", PATH: "/usr/bin:/usr/local/bin" },
    });
    const c = binaryCandidates(deps, "ffmpeg");
    expect(c[0]).toBe("/opt/ff");
    expect(c.slice(-2)).toEqual(["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]);
  });

  it("falls back to PATH and returns null when a tool is missing", () => {
    const deps = base({
      env: { PATH: "/usr/local/bin" },
      exists: (p) => p === "/usr/local/bin/ffmpeg",
    });
    expect(resolveFfmpegPaths(deps)).toBeNull();
    const both = base({
      env: { PATH: "/usr/local/bin" },
      exists: (p) => p.startsWith("/usr/local/bin/"),
    });
    expect(resolveFfmpegPaths(both)).toEqual({
      ffmpeg: "/usr/local/bin/ffmpeg",
      ffprobe: "/usr/local/bin/ffprobe",
    });
  });

  it("packaged: resources/ffmpeg/<platform>-<arch> comes right after the env override", () => {
    const deps = base({
      resourcesPath: "/Applications/Reelform.app/Contents/Resources",
      env: { REELFORM_FFMPEG_PATH: "/opt/ff", PATH: "/usr/bin" },
    });
    const c = binaryCandidates(deps, "ffprobe");
    expect(c[0]).toBe("/Applications/Reelform.app/Contents/Resources/ffmpeg/darwin-arm64/ffprobe");
    const staged = "/Applications/Reelform.app/Contents/Resources/ffmpeg/darwin-arm64";
    expect(resolveFfmpegPaths({ ...deps, exists: (p) => p.startsWith(staged) })).toEqual({
      ffmpeg: `${staged}/ffmpeg`,
      ffprobe: `${staged}/ffprobe`,
    });
    expect(binaryCandidates(deps, "ffmpeg").slice(0, 2)).toEqual(["/opt/ff", `${staged}/ffmpeg`]);
  });

  it("dev layouts without resourcesPath add no staged candidate", () => {
    const c = binaryCandidates(base({ appPath: "/repo" }), "ffmpeg");
    expect(c.some((p) => p.includes("/ffmpeg/darwin-"))).toBe(false);
  });
});
