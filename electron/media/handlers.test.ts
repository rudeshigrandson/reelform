import * as nodePath from "node:path";
import { mediaContracts } from "./contracts";
import { type MediaDeps, createMediaHandlers } from "./handlers";
import { createMediaRootRegistry } from "./roots";
import { type SpawnCall, scriptedSpawn } from "./testUtils";

const probeJson = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "vp9", width: 1920, height: 1080, avg_frame_rate: "60/1" },
  ],
  format: { duration: "3.5" },
});

function setup(script: (call: SpawnCall) => void = () => {}, over: Partial<MediaDeps> = {}) {
  const registry = createMediaRootRegistry();
  const { spawn, calls } = scriptedSpawn(script);
  let n = 0;
  const deps: MediaDeps = {
    registry,
    realpath: async (p) => {
      if (p === "/missing") throw new Error("ENOENT");
      return p === "/link" ? "/real/project" : p;
    },
    stat: async (p) => ({ isDirectory: !p.endsWith(".mp4"), isFile: p.endsWith(".mp4") }),
    isAbsolute: nodePath.posix.isAbsolute,
    makeRootId: () => `r-${++n}`,
    resolveBinaries: () => ({ ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" }),
    runner: { spawn },
    ...over,
  };
  return { handlers: createMediaHandlers(deps), registry, calls };
}

describe("media handlers", () => {
  it("contract channel names match their keys", () => {
    for (const [key, c] of Object.entries(mediaContracts)) expect(c.name).toBe(key);
  });

  it("registerRoot canonicalises, generates ids, reuses the id for the same folder", async () => {
    const { handlers, registry } = setup();
    const a = await handlers["media:registerRoot"]({ path: "/link" });
    expect(a).toEqual({ rootId: "r-1", baseUrl: "reelform-media://r-1/" });
    expect(registry.get("r-1")?.realPath).toBe("/real/project");
    expect(await handlers["media:registerRoot"]({ path: "/real/project" })).toEqual(a);
    expect((await handlers["media:registerRoot"]({ path: "/other" })).rootId).toBe("r-2");
    expect((await handlers["media:registerRoot"]({ path: "/x", rootId: "proj" })).rootId).toBe(
      "proj",
    );
    expect(mediaContracts["media:registerRoot"].response.safeParse(a).success).toBe(true);
  });

  it("registerRoot skips colliding generated ids and rejects invalid ones", async () => {
    const ids = ["taken", "fresh"];
    const { handlers, registry } = setup(undefined, { makeRootId: () => ids.shift() ?? "never" });
    registry.add({ id: "taken", realPath: "/elsewhere" });
    expect((await handlers["media:registerRoot"]({ path: "/p" })).rootId).toBe("fresh");
    const bad = setup(undefined, { makeRootId: () => "NOT VALID" });
    await expect(bad.handlers["media:registerRoot"]({ path: "/p" })).rejects.toMatchObject({
      code: "MEDIA_INVALID_ROOT_ID",
    });
    const stuck = setup(undefined, { makeRootId: () => "same" });
    stuck.registry.add({ id: "same", realPath: "/q" });
    await expect(stuck.handlers["media:registerRoot"]({ path: "/p" })).rejects.toMatchObject({
      code: "MEDIA_INVALID_ROOT_ID",
    });
  });

  it("registerRoot error codes", async () => {
    const { handlers } = setup();
    await expect(handlers["media:registerRoot"]({ path: "rel/dir" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_NOT_ABSOLUTE",
    });
    await expect(handlers["media:registerRoot"]({ path: "/missing" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_NOT_FOUND",
    });
    await expect(handlers["media:registerRoot"]({ path: "/file.mp4" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_NOT_DIRECTORY",
    });
  });

  it("registerRoot consults isRootAllowed with the canonical dir", async () => {
    const seen: string[] = [];
    const { handlers, registry } = setup(undefined, {
      isRootAllowed: async (dir) => {
        seen.push(dir);
        return dir.endsWith(".reelform");
      },
    });
    await expect(handlers["media:registerRoot"]({ path: "/" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_FORBIDDEN",
    });
    await expect(handlers["media:registerRoot"]({ path: "/link" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_FORBIDDEN",
    });
    expect(seen).toEqual(["/", "/real/project"]);
    expect(registry.list()).toEqual([]);
    const ok = await handlers["media:registerRoot"]({ path: "/lib/Demo.reelform" });
    expect(registry.get(ok.rootId)?.realPath).toBe("/lib/Demo.reelform");
  });

  it("registerRoot treats a throwing predicate as forbidden, even for a known root", async () => {
    const { handlers, registry } = setup(undefined, {
      isRootAllowed: async () => {
        throw new Error("boom");
      },
    });
    registry.add({ id: "known", realPath: "/p" });
    await expect(handlers["media:registerRoot"]({ path: "/p" })).rejects.toMatchObject({
      code: "MEDIA_ROOT_FORBIDDEN",
    });
  });

  it("unregisterRoot", async () => {
    const { handlers } = setup();
    const { rootId } = await handlers["media:registerRoot"]({ path: "/p" });
    expect(await handlers["media:unregisterRoot"]({ rootId })).toEqual({ ok: true });
    expect(await handlers["media:unregisterRoot"]({ rootId })).toEqual({ ok: false });
  });

  it("probe spawns ffprobe and parses JSON split across chunks", async () => {
    const { handlers, calls } = setup(({ child }) => {
      child.out(probeJson.slice(0, 20)).out(probeJson.slice(20));
      child.close(0);
    });
    const res = await handlers["media:probe"]({ path: "/p/screen.webm" });
    expect(res).toEqual({
      durationMs: 3500,
      width: 1920,
      height: 1080,
      fps: 60,
      codec: "vp9",
      hasAudio: false,
    });
    expect(calls[0]?.command).toBe("/bin/ffprobe");
    expect(calls[0]?.args.at(-1)).toBe("/p/screen.webm");
    expect(mediaContracts["media:probe"].response.safeParse(res).success).toBe(true);
  });

  it("probe failure surfaces FFMPEG_FAILED; missing binaries FFMPEG_NOT_FOUND; relative path rejected", async () => {
    const failing = setup(({ child }) => {
      child.err("/p/x.mp4: Invalid data found when processing input\n");
      child.close(1);
    });
    await expect(failing.handlers["media:probe"]({ path: "/p/x.mp4" })).rejects.toMatchObject({
      code: "FFMPEG_FAILED",
      details: { stderrTail: ["/p/x.mp4: Invalid data found when processing input"] },
    });
    const noBins = setup(undefined, { resolveBinaries: () => null });
    await expect(noBins.handlers["media:probe"]({ path: "/p/x.mp4" })).rejects.toMatchObject({
      code: "FFMPEG_NOT_FOUND",
    });
    await expect(noBins.handlers["media:probe"]({ path: "x.mp4" })).rejects.toMatchObject({
      code: "MEDIA_PATH_NOT_ABSOLUTE",
    });
  });

  it("thumbnail returns a data URL of stdout bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { handlers, calls } = setup(({ child }) => {
      child.out(png);
      child.close(0);
    });
    const res = await handlers["media:thumbnail"]({ path: "/p/a.mp4", atMs: 1000, width: 320 });
    expect(res.dataUrl).toBe("data:image/png;base64,iVBORw==");
    expect(calls[0]?.command).toBe("/bin/ffmpeg");
    expect(calls[0]?.args).toContain("scale=320:-2");
  });

  it("thumbnail past the end (empty stdout) fails with a stable code", async () => {
    const { handlers } = setup(({ child }) => child.close(0));
    await expect(
      handlers["media:thumbnail"]({ path: "/p/a.mp4", atMs: 99_000, format: "jpg" }),
    ).rejects.toMatchObject({ code: "MEDIA_THUMBNAIL_FAILED" });
  });

  it("request schemas reject bad payloads", () => {
    expect(
      mediaContracts["media:registerRoot"].request.safeParse({ path: "/p", rootId: "Bad Id" })
        .success,
    ).toBe(false);
    expect(
      mediaContracts["media:thumbnail"].request.safeParse({ path: "/p", atMs: -1 }).success,
    ).toBe(false);
    expect(mediaContracts["media:probe"].request.safeParse({ path: "" }).success).toBe(false);
  });
});
