import { describe, expect, it } from "vitest";
import {
  AAC_LC_CODEC,
  AUDIO_BITRATE,
  type AudioBlockSource,
  MAX_AUDIO_QUEUE,
  WAV_HEADER_BYTES,
  bufferBlockSource,
  chooseAudioPlan,
  encodeAudioBuffer,
  encodeWav,
  planarBlock,
  streamWav,
} from "./audio";
import { ExportCancelledError } from "./cancel";
import { FakeAudioData, FakeAudioEncoder, fakeAudioBuffer } from "./testFakes";

const probe = (ok: boolean | "throw") => ({
  isAudioConfigSupported: async (config: AudioEncoderConfig) => {
    if (ok === "throw") throw new Error("boom");
    return { supported: ok, config };
  },
});

describe("chooseAudioPlan", () => {
  it("AAC-LC 192k for MP4, Opus for WebM", async () => {
    expect(await chooseAudioPlan("mp4", probe(true), 48_000, 2)).toEqual({
      kind: "aac",
      config: {
        codec: AAC_LC_CODEC,
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: AUDIO_BITRATE,
      },
    });
    expect(await chooseAudioPlan("webm", probe(true), 48_000, 2)).toMatchObject({
      kind: "opus",
      config: { codec: "opus" },
    });
  });

  it("falls back to PCM WAV (ffmpeg finalize) when unsupported or the probe throws", async () => {
    expect((await chooseAudioPlan("mp4", probe(false), 48_000, 2)).kind).toBe("pcm-wav");
    expect((await chooseAudioPlan("webm", probe("throw"), 48_000, 2)).kind).toBe("pcm-wav");
  });
});

function harness(bufferLength: number, blockFrames?: number, renderBlockFrames = 48_000 * 30) {
  const counter = { live: 0 };
  const chunks: number[] = [];
  let encoder: FakeAudioEncoder | null = null;
  const buffer = fakeAudioBuffer(bufferLength);
  const source = bufferBlockSource(buffer, renderBlockFrames);
  const deps = {
    createEncoder: (init: AudioEncoderInit) => {
      encoder = new FakeAudioEncoder(init);
      return encoder;
    },
    createAudioData: (init: AudioDataInit) =>
      new FakeAudioData(init, counter) as unknown as AudioData,
    onChunk: (chunk: EncodedAudioChunk) => {
      chunks.push(chunk.timestamp);
    },
    blockFrames,
  };
  return {
    counter,
    chunks,
    buffer,
    source,
    deps,
    encoder: () => encoder as unknown as FakeAudioEncoder,
  };
}

const config: AudioEncoderConfig = { codec: AAC_LC_CODEC, sampleRate: 48_000, numberOfChannels: 2 };

describe("encodeAudioBuffer", () => {
  it("encodes in blocks with µs timestamps and closes every AudioData", async () => {
    const h = harness(48_000 * 3 + 100);
    const { blocks } = await encodeAudioBuffer(h.source, config, h.deps);
    expect(blocks).toBe(4);
    expect(h.encoder().encoded).toEqual([
      { timestamp: 0, frames: 48_000 },
      { timestamp: 1_000_000, frames: 48_000 },
      { timestamp: 2_000_000, frames: 48_000 },
      { timestamp: 3_000_000, frames: 100 },
    ]);
    expect(h.chunks).toHaveLength(4);
    expect(h.counter.live).toBe(0);
    expect(h.encoder().state).toBe("closed");
  });

  it("stamps timestamps from each render block's frame offset", async () => {
    // Render blocks of 1.5 s split into 1 s AudioData chunks.
    const h = harness(48_000 * 3, undefined, 72_000);
    await encodeAudioBuffer(h.source, config, h.deps);
    expect(h.encoder().encoded).toEqual([
      { timestamp: 0, frames: 48_000 },
      { timestamp: 1_000_000, frames: 24_000 },
      { timestamp: 1_500_000, frames: 48_000 },
      { timestamp: 2_500_000, frames: 24_000 },
    ]);
  });

  it("applies encode-queue backpressure", async () => {
    const h = harness(48_000, 480);
    await encodeAudioBuffer(h.source, config, h.deps);
    expect(h.encoder().encoded).toHaveLength(100);
    expect(h.encoder().maxQueueAtEncode).toBeLessThanOrEqual(MAX_AUDIO_QUEUE);
  });

  it("abort closes the encoder and throws ExportCancelledError", async () => {
    const h = harness(48_000, 480);
    const ac = new AbortController();
    const deps = {
      ...h.deps,
      signal: ac.signal,
      onChunk: () => {
        h.chunks.push(0);
        if (h.chunks.length === 3) ac.abort();
      },
    };
    await expect(encodeAudioBuffer(h.source, config, deps)).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
    expect(h.encoder().state).toBe("closed");
    expect(h.counter.live).toBe(0);
  });

  it("encoder errors reject", async () => {
    const h = harness(48_000, 480);
    const deps = {
      ...h.deps,
      createEncoder: (init: AudioEncoderInit) => {
        const e = h.deps.createEncoder(init);
        e.failAfter = 5;
        return e;
      },
    };
    await expect(encodeAudioBuffer(h.source, config, deps)).rejects.toMatchObject({
      name: "EncodingError",
    });
    expect(h.counter.live).toBe(0);
  });

  it("render failures propagate and close the encoder", async () => {
    const h = harness(48_000);
    const failing: AudioBlockSource = {
      ...h.source,
      // biome-ignore lint/correctness/useYield: throws before yielding on purpose
      async *blocks() {
        throw new Error("render failed");
      },
    };
    await expect(encodeAudioBuffer(failing, config, h.deps)).rejects.toThrow("render failed");
    expect(h.encoder().state).toBe("closed");
  });

  it("planarBlock lays channels end to end", () => {
    const buf = fakeAudioBuffer(300, 48_000, 2);
    const channels = [buf.getChannelData(0), buf.getChannelData(1)];
    const block = planarBlock(channels, 110, 3);
    expect(Array.from(block)).toEqual([
      ...Array.from(buf.getChannelData(0).subarray(110, 113)),
      ...Array.from(buf.getChannelData(1).subarray(110, 113)),
    ]);
  });
});

describe("WAV", () => {
  const left = Float32Array.from([0, 1, -1, 2]);
  const right = Float32Array.from([0.5, -0.5, 0, -2]);
  const stereo = {
    sampleRate: 44_100,
    numberOfChannels: 2,
    length: 4,
    getChannelData: (c: number) => (c === 0 ? left : right),
  };

  it("encodeWav writes a 16-bit PCM header and interleaved clamped samples", () => {
    const wav = encodeWav(stereo);
    const v = new DataView(wav.buffer);
    const str = (at: number, n: number) => String.fromCharCode(...wav.subarray(at, at + n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(v.getUint32(4, true)).toBe(36 + 16);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44_100);
    expect(v.getUint32(28, true)).toBe(44_100 * 4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16);
    const samples = Array.from({ length: 8 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 16384, 32767, -16384, -32768, 0, 32767, -32768]);
  });

  it("streamWav writes the header first, then each block, byte-identical to encodeWav", async () => {
    const writes: Uint8Array[] = [];
    const res = await streamWav(bufferBlockSource(stereo, 3), async (b) => {
      writes.push(b.slice());
    });
    expect(writes.map((w) => w.byteLength)).toEqual([WAV_HEADER_BYTES, 12, 4]);
    const joined = new Uint8Array(writes.reduce((n, w) => n + w.byteLength, 0));
    let at = 0;
    for (const w of writes) {
      joined.set(w, at);
      at += w.byteLength;
    }
    expect(joined).toEqual(encodeWav(stereo));
    expect(res.bytes).toBe(joined.byteLength);
  });

  it("streamWav pads a short render to the declared length and honours abort", async () => {
    const short: AudioBlockSource = { ...bufferBlockSource(stereo), length: 6 };
    let total = 0;
    await streamWav(short, async (b) => {
      total += b.byteLength;
    });
    expect(total).toBe(WAV_HEADER_BYTES + 6 * 4);
    const ac = new AbortController();
    ac.abort();
    await expect(streamWav(short, async () => undefined, ac.signal)).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
  });
});
