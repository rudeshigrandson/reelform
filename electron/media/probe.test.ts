import { MediaSource } from "../../src/editor/model/schema";
import { parseFrameRate, parseProbeJson } from "./probe";

const mp4 = {
  streams: [
    {
      index: 0,
      codec_name: "h264",
      codec_type: "video",
      width: 2880,
      height: 1800,
      avg_frame_rate: "60/1",
      r_frame_rate: "60/1",
      duration: "12.500000",
    },
    { index: 1, codec_name: "aac", codec_type: "audio", duration: "12.480000" },
  ],
  format: { duration: "12.512000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
};

const recorderWebm = {
  streams: [
    {
      codec_name: "vp9",
      codec_type: "video",
      width: 1920,
      height: 1080,
      avg_frame_rate: "0/0",
      r_frame_rate: "30/1",
      tags: { DURATION: "00:00:07.033000000" },
    },
  ],
  format: { format_name: "matroska,webm" },
};

describe("ffprobe JSON parser", () => {
  it("mp4 with audio", () => {
    expect(parseProbeJson(JSON.stringify(mp4))).toEqual({
      durationMs: 12512,
      width: 2880,
      height: 1800,
      fps: 60,
      codec: "h264",
      hasAudio: true,
    });
  });

  it("MediaRecorder webm: 0/0 avg rate falls back to r_frame_rate, duration from tag", () => {
    expect(parseProbeJson(recorderWebm)).toEqual({
      durationMs: 7033,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "vp9",
      hasAudio: false,
    });
  });

  it("rotated (portrait phone) video swaps dimensions", () => {
    const doc = structuredClone(mp4);
    (doc.streams[0] as Record<string, unknown>).side_data_list = [
      { side_data_type: "Display Matrix", rotation: -90 },
    ];
    expect(parseProbeJson(doc)).toMatchObject({ width: 1800, height: 2880 });
  });

  it("skips cover-art video streams", () => {
    const doc = {
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 600,
          avg_frame_rate: "0/0",
          disposition: { attached_pic: 1 },
        },
      ],
      format: { duration: "3" },
    };
    expect(() => parseProbeJson(doc)).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_NO_VIDEO" }),
    );
  });

  it("error codes", () => {
    expect(() => parseProbeJson("{nope")).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_FAILED" }),
    );
    expect(() => parseProbeJson({ streams: [] })).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_NO_VIDEO" }),
    );
    const noDur = {
      streams: [{ codec_type: "video", width: 10, height: 10, avg_frame_rate: "30/1" }],
      format: { duration: "N/A" },
    };
    expect(() => parseProbeJson(noDur)).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_NO_DURATION" }),
    );
    const noDims = {
      streams: [{ codec_type: "video", avg_frame_rate: "30/1" }],
      format: { duration: "1" },
    };
    expect(() => parseProbeJson(noDims)).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_FAILED" }),
    );
    const noFps = {
      streams: [
        { codec_type: "video", width: 10, height: 10, avg_frame_rate: "0/0", r_frame_rate: "0/0" },
      ],
      format: { duration: "1" },
    };
    expect(() => parseProbeJson(noFps)).toThrow(
      expect.objectContaining({ code: "MEDIA_PROBE_FAILED" }),
    );
  });

  it("frame rates", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate("N/A")).toBeNull();
    expect(parseFrameRate("25")).toBe(25);
  });

  it("result is a valid project MediaSource once given a path (§4 compatibility guard)", () => {
    const probed = parseProbeJson(mp4);
    expect(() => MediaSource.parse({ ...probed, path: "media/screen.mp4" })).not.toThrow();
  });
});
