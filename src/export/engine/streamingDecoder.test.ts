import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DecoderClosedError,
  MAX_DECODE_QUEUE,
  MAX_HELD_FRAMES,
  StreamingDecoder,
} from "./streamingDecoder";
import {
  FakePacketSource,
  FakeVideoDecoder,
  FakeVideoFrame,
  FrameLedger,
  asFake,
} from "./testFakes";

const settle = () => new Promise((r) => setTimeout(r, 5));

function setup(frameCount = 90, fps = 30, gop = 30) {
  const ledger = new FrameLedger();
  const source = new FakePacketSource(frameCount, fps, gop);
  const decoders: FakeVideoDecoder[] = [];
  const dec = new StreamingDecoder({
    source,
    createDecoder: (init) => {
      const d = new FakeVideoDecoder(init, ledger);
      decoders.push(d);
      return d;
    },
  });
  const ts = (i: number) => (source.packets[i] as { timestampUs: number }).timestampUs;
  /** Fetch, "render" (one extra frame), close both — like the export loop. */
  const use = async (ms: number) => {
    const f = asFake(await dec.frameAt(ms));
    const rendered = new FakeVideoFrame(ledger, 0);
    const t = f.timestamp;
    f.close();
    rendered.close();
    return t;
  };
  return { ledger, source, decoders, dec, ts, use };
}

describe("StreamingDecoder", () => {
  it("sequential sweep returns every frame, respects queue and held-frame bounds, leaks nothing", async () => {
    const { ledger, decoders, dec, ts, use } = setup(150, 30, 30);
    for (let i = 0; i < 150; i++) expect(await use((i * 1000) / 30)).toBe(ts(i));
    const d = decoders[0] as FakeVideoDecoder;
    expect(d.maxQueueAtDecode).toBe(MAX_DECODE_QUEUE);
    expect(ledger.maxLive).toBeLessThanOrEqual(MAX_HELD_FRAMES);
    expect(dec.stats.seeks).toBe(1);
    dec.close();
    await settle();
    expect(ledger.live).toBe(0);
    expect(ledger.doubleClose).toBe(0);
    expect(d.state).toBe("closed");
  });

  it("picks the nearest frame by PTS", async () => {
    const { dec, ts, use } = setup();
    expect(await use(10)).toBe(ts(0));
    expect(await use(20)).toBe(ts(1));
    expect(await use(1000 / 30 + 16)).toBe(ts(1));
    expect(await use(1000 / 30 + 17)).toBe(ts(2));
    dec.close();
  });

  it("repeated requests return clones of the same frame without seeking", async () => {
    const { dec, ts, use, ledger } = setup();
    expect(await use(500)).toBe(ts(15));
    expect(await use(500)).toBe(ts(15));
    expect(dec.stats.seeks).toBe(1);
    dec.close();
    await settle();
    expect(ledger.live).toBe(0);
  });

  it("backward request seeks to the preceding keyframe and discards earlier frames", async () => {
    const { dec, decoders, ts, use } = setup(90, 30, 30);
    expect(await use(1700)).toBe(ts(51));
    const d = decoders[0] as FakeVideoDecoder;
    const before = d.decodedChunks.length;
    expect(await use(400)).toBe(ts(12));
    expect(dec.stats.seeks).toBe(2);
    const afterSeek = d.decodedChunks.slice(before);
    expect(afterSeek[0]).toMatchObject({ timestamp: ts(0), type: "key" });
    expect(dec.stats.framesDiscarded).toBeGreaterThan(0);
    dec.close();
  });

  it("forward jump beyond a keyframe seeks instead of decoding the gap", async () => {
    const { dec, decoders, ts, use } = setup(300, 30, 30);
    expect(await use(0)).toBe(ts(0));
    expect(await use(8000)).toBe(ts(240));
    expect(dec.stats.seeks).toBe(2);
    expect((decoders[0] as FakeVideoDecoder).decodedChunks.length).toBeLessThan(40);
    dec.close();
  });

  it("past the end of stream returns the last frame", async () => {
    const { dec, ts, use, ledger } = setup(90, 30, 30);
    expect(await use(5000)).toBe(ts(89));
    expect(await use(6000)).toBe(ts(89));
    dec.close();
    await settle();
    expect(ledger.live).toBe(0);
  });

  it("decoder errors reject the request", async () => {
    const { dec, decoders, ledger } = setup();
    const p = dec.frameAt(0);
    await Promise.resolve();
    await Promise.resolve();
    const d = decoders[0] as FakeVideoDecoder;
    d.failAtChunk = 1;
    await expect(p).rejects.toMatchObject({ name: "EncodingError" });
    await expect(dec.frameAt(100)).rejects.toMatchObject({ name: "EncodingError" });
    dec.close();
    await settle();
    expect(ledger.live).toBe(0);
  });

  it("close() while a request is pending rejects it and releases every frame", async () => {
    const { dec, ledger } = setup(300, 30, 300);
    const p = dec.frameAt(9000);
    await new Promise((r) => setTimeout(r, 2));
    dec.close();
    await expect(p).rejects.toBeInstanceOf(DecoderClosedError);
    await settle();
    expect(ledger.live).toBe(0);
    await expect(dec.frameAt(0)).rejects.toBeInstanceOf(DecoderClosedError);
  });

  it("rejects invalid times and concurrent calls", async () => {
    const { dec } = setup();
    await expect(dec.frameAt(Number.NaN)).rejects.toBeInstanceOf(RangeError);
    const a = dec.frameAt(100);
    await expect(dec.frameAt(200)).rejects.toThrow(/re-entrant/);
    asFake(await a).close();
    dec.close();
  });

  it("property: any request sequence yields the nearest frame within bounds and no leaks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 3200, noNaN: true }), { minLength: 1, maxLength: 12 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 45 }),
        async (times, sorted, gop) => {
          const { dec, source, decoders, ledger, use } = setup(90, 30, gop);
          const seq = sorted ? [...times].sort((a, b) => a - b) : times;
          for (const ms of seq) {
            const target = Math.round(ms * 1000);
            const best = Math.min(...source.packets.map((p) => Math.abs(p.timestampUs - target)));
            const got = await use(ms);
            if (Math.abs(got - target) !== best) return false;
          }
          dec.close();
          await settle();
          const d = decoders[0] as FakeVideoDecoder;
          return (
            ledger.live === 0 &&
            ledger.maxLive <= MAX_HELD_FRAMES &&
            d.maxQueueAtDecode <= MAX_DECODE_QUEUE
          );
        },
      ),
      { numRuns: 25 },
    );
  });
});
