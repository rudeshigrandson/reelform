import { describe, expect, it, vi } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import {
  VAAPI_DEVICE,
  buildEncoderTestArgs,
  buildRecordingTranscodeArgs,
  createH264EncoderProbe,
  transcodeH264Candidates,
} from "./h264Probe";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };

const ENCODERS_OUTPUT = [
  "Encoders:",
  " V..... = Video",
  " ------",
  " V....D libx264              libx264 H.264 / AVC",
  " V....D h264_nvenc           NVIDIA NVENC H.264 encoder",
  " V....D h264_vaapi           H.264/AVC (VAAPI)",
  " V....D h264_videotoolbox    VideoToolbox H.264 Encoder",
  "",
].join("\n");

/** `failing`: encoders whose test encode exits non-zero; `listExit` fails `-encoders`. */
function setup(opts: { platform: string; failing?: string[]; listExit?: number; bins?: boolean }) {
  const { spawn, calls } = scriptedSpawn(({ args, child }) => {
    if (args.includes("-encoders")) {
      child.out(ENCODERS_OUTPUT);
      child.close(opts.listExit ?? 0);
      return;
    }
    const enc = args[args.indexOf("-c:v") + 1] ?? "";
    child.close(opts.failing?.includes(enc) ? 1 : 0);
  });
  const log = vi.fn();
  const probe = createH264EncoderProbe({
    runner: { spawn },
    resolveBinaries: () => (opts.bins === false ? null : BINS),
    platform: opts.platform,
    log,
  });
  const tests = () => calls.filter((c) => c.args.includes("lavfi"));
  return { probe, calls, tests, log };
}

describe("h264 encoder args", () => {
  it("lists hardware candidates per platform", () => {
    expect(transcodeH264Candidates("darwin")).toEqual(["h264_videotoolbox"]);
    expect(transcodeH264Candidates("win32")).toEqual(["h264_nvenc", "h264_qsv", "h264_amf"]);
    expect(transcodeH264Candidates("linux")).toEqual(["h264_nvenc", "h264_vaapi"]);
    expect(transcodeH264Candidates("freebsd")).toEqual([]);
  });

  it("test encode uses the transcode's video args on a synthetic source", () => {
    const vt = buildEncoderTestArgs("h264_videotoolbox");
    expect(vt).toEqual(expect.arrayContaining(["-f", "lavfi", "-c:v", "h264_videotoolbox"]));
    expect(vt.slice(-3)).toEqual(["-f", "null", "-"]);
    expect(vt).toContain("yuv420p");
    const vaapi = buildEncoderTestArgs("h264_vaapi");
    expect(vaapi.indexOf("-vaapi_device")).toBeLessThan(vaapi.indexOf("-i"));
    expect(vaapi).toEqual(expect.arrayContaining(["format=nv12,hwupload", "h264_vaapi"]));
  });

  it("builds the transcode for software, hardware and VAAPI", () => {
    const sw = buildRecordingTranscodeArgs({
      input: "/i.webm",
      output: "/o.mp4",
      encoder: "libx264",
      fps: 60,
    });
    expect(sw).toEqual(expect.arrayContaining(["-i", "/i.webm", "-c:v", "libx264", "-g", "120"]));
    expect(sw.at(-1)).toBe("/o.mp4");
    const nv = buildRecordingTranscodeArgs({
      input: "/i.webm",
      output: "/o.mp4",
      encoder: "h264_nvenc",
      fps: 30,
    });
    expect(nv).toEqual(expect.arrayContaining(["-c:v", "h264_nvenc", "-c:a", "aac"]));
    const va = buildRecordingTranscodeArgs({
      input: "/i.webm",
      output: "/o.mp4",
      encoder: "h264_vaapi",
      fps: 30,
    });
    expect(va.slice(va.indexOf("-vaapi_device"), va.indexOf("-vaapi_device") + 2)).toEqual([
      "-vaapi_device",
      VAAPI_DEVICE,
    ]);
    expect(va.indexOf("-vaapi_device")).toBeLessThan(va.indexOf("-i"));
    expect(va).toEqual(expect.arrayContaining(["-map", "0:a?", "-movflags", "+faststart"]));
    expect(va.at(-1)).toBe("/o.mp4");
  });
});

describe("createH264EncoderProbe", () => {
  it("selects a listed hardware encoder whose test encode works, and caches it", async () => {
    const t = setup({ platform: "darwin" });
    expect(await t.probe.select()).toBe("h264_videotoolbox");
    expect(await t.probe.select()).toBe("h264_videotoolbox");
    expect(t.calls.filter((c) => c.args.includes("-encoders"))).toHaveLength(1);
    expect(t.tests()).toHaveLength(1);
  });

  it("skips unlisted and failing candidates, falling back to libx264", async () => {
    // win32: nvenc listed but broken, qsv/amf not compiled in.
    const t = setup({ platform: "win32", failing: ["h264_nvenc"] });
    expect(await t.probe.select()).toBe("libx264");
    expect(t.tests().map((c) => c.args[c.args.indexOf("-c:v") + 1])).toEqual(["h264_nvenc"]);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("h264_nvenc test encode failed"));

    const linux = setup({ platform: "linux", failing: ["h264_nvenc"] });
    expect(await linux.probe.select()).toBe("h264_vaapi");
  });

  it("a rejected encoder is never selected again", async () => {
    const t = setup({ platform: "linux" });
    expect(await t.probe.select()).toBe("h264_nvenc");
    t.probe.reject("h264_nvenc");
    expect(await t.probe.select()).toBe("h264_vaapi");
    t.probe.reject("h264_vaapi");
    t.probe.reject("libx264"); // ignored: the software floor stays
    expect(await t.probe.select()).toBe("libx264");
  });

  it("uses libx264 without ffmpeg, on unknown platforms and when -encoders fails", async () => {
    const none = setup({ platform: "darwin", bins: false });
    expect(await none.probe.select()).toBe("libx264");
    expect(none.calls).toHaveLength(0);

    const bsd = setup({ platform: "freebsd" });
    expect(await bsd.probe.select()).toBe("libx264");
    expect(bsd.calls).toHaveLength(0);

    const broken = setup({ platform: "darwin", listExit: 1 });
    expect(await broken.probe.select()).toBe("libx264");
    expect(broken.tests()).toHaveLength(0);
  });
});
