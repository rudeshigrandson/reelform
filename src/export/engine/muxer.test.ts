import { describe, expect, it } from "vitest";
import { BT709_LIMITED } from "./encoderConfig";
import {
  type ExportSink,
  type ExportSinkBeginInfo,
  createMediabunnyMuxer,
  withColorSpace,
} from "./muxer";
import { fakeChunk } from "./testFakes";

/** Sink that assembles positional writes into a file image. */
class MemorySink implements ExportSink {
  file = new Uint8Array(0);
  writes = 0;
  cancelled = false;
  async begin(_info: ExportSinkBeginInfo): Promise<void> {}
  async writeChunk(chunk: Uint8Array, position?: number | undefined): Promise<void> {
    const at = position ?? this.file.length;
    if (at + chunk.length > this.file.length) {
      const grown = new Uint8Array(at + chunk.length);
      grown.set(this.file);
      this.file = grown;
    }
    this.file.set(chunk, at);
    this.writes++;
  }
  async finish(): Promise<{ path: string }> {
    return { path: "/tmp/x" };
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}

describe("withColorSpace", () => {
  it("fills a missing colour space on decoder config metadata only", () => {
    expect(withColorSpace(undefined, BT709_LIMITED)).toBeUndefined();
    expect(withColorSpace({}, BT709_LIMITED)).toEqual({});
    expect(withColorSpace({ decoderConfig: { codec: "vp09.00.10.08" } }, BT709_LIMITED)).toEqual({
      decoderConfig: { codec: "vp09.00.10.08", colorSpace: BT709_LIMITED },
    });
    const reported = {
      decoderConfig: { codec: "x", colorSpace: { primaries: "bt470bg" as const } },
    };
    expect(withColorSpace(reported, BT709_LIMITED)).toBe(reported);
  });
});

const decoderConfig: VideoDecoderConfig = {
  codec: "vp09.00.10.08",
  codedWidth: 16,
  codedHeight: 16,
};

async function muxFrames(container: "webm" | "mp4", sink: MemorySink) {
  const muxer = createMediabunnyMuxer(
    { container, videoCodec: "vp9", fps: 30, audio: null, maximumVideoPackets: 30 },
    sink,
  );
  await muxer.start();
  for (let i = 0; i < 30; i++) {
    const chunk = fakeChunk(Math.round((i * 1e6) / 30), i % 15 === 0 ? "key" : "delta", 33_333);
    await muxer.addVideoChunk(
      chunk as unknown as EncodedVideoChunk,
      i === 0 ? { decoderConfig } : undefined,
    );
  }
  return muxer;
}

describe("createMediabunnyMuxer (real mediabunny, fake chunks)", () => {
  it("streams a WebM through the sink", async () => {
    const sink = new MemorySink();
    const muxer = await muxFrames("webm", sink);
    await muxer.finalize();
    expect(sink.writes).toBeGreaterThan(0);
    expect(Array.from(sink.file.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it("streams a fast-start MP4 with moov ahead of mdat and a colr box", async () => {
    const sink = new MemorySink();
    const muxer = await muxFrames("mp4", sink);
    await muxer.finalize();
    const text = new TextDecoder("latin1").decode(sink.file);
    expect(text.slice(4, 8)).toBe("ftyp");
    expect(text.indexOf("moov")).toBeGreaterThan(0);
    expect(text.indexOf("moov")).toBeLessThan(text.indexOf("mdat"));
    expect(text).toContain("colr");
  });

  it("cancel is idempotent and safe after finalize", async () => {
    const sink = new MemorySink();
    const muxer = await muxFrames("webm", sink);
    await muxer.cancel();
    await muxer.cancel();
    const done = await muxFrames("webm", new MemorySink());
    await done.finalize();
    await expect(done.cancel()).resolves.toBeUndefined();
  });

  it("refuses audio chunks without an audio track", async () => {
    const muxer = createMediabunnyMuxer(
      { container: "webm", videoCodec: "vp9", fps: 30, audio: null },
      new MemorySink(),
    );
    await expect(
      muxer.addAudioChunk(fakeChunk(0, "key") as unknown as EncodedAudioChunk),
    ).rejects.toThrow(/no audio track/);
  });
});
