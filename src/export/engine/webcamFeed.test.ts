import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SceneState } from "../../editor/preview/scene";
import { decideVideoSync } from "../../editor/preview/videoSync";
import { createFramePlan } from "./framePlan";
import { DecoderClosedError, type FrameSource } from "./streamingDecoder";
import { FakeRenderer, FakeVideoFrame, FrameLedger, asVideoFrame } from "./testFakes";
import { WebcamFeed, webcamSourceMsFor, withoutWebcam } from "./webcamFeed";

const scene = (tMs: number, webcamVisible: boolean | null): SceneState =>
  ({
    tMs,
    video: { visible: true, crop: null },
    composition: webcamVisible === null ? undefined : { webcam: { visible: webcamVisible } },
  }) as unknown as SceneState;

const never = () => false;

function source(ledger: FrameLedger, fail: { open?: boolean; atCall?: number } = {}) {
  const state = { opened: 0, closed: 0, calls: [] as number[] };
  const open = async (): Promise<FrameSource> => {
    state.opened++;
    if (fail.open) throw new Error("ENOENT: webcam.webm");
    return {
      frameAt: async (ms) => {
        state.calls.push(ms);
        if (fail.atCall !== undefined && state.calls.length >= fail.atCall) {
          throw new Error("decode error");
        }
        return asVideoFrame(new FakeVideoFrame(ledger, Math.round(ms * 1000)));
      },
      close: () => {
        state.closed++;
      },
    };
  };
  return { open, state };
}

describe("webcamSourceMsFor", () => {
  it("adds the sync offset, clamps at 0, passes gaps through and ignores non-finite offsets", () => {
    fc.assert(
      fc.property(
        fc.option(fc.double({ min: 0, max: 1e7, noNaN: true }), { nil: null }),
        fc.oneof(fc.integer({ min: -5000, max: 5000 }), fc.constant(Number.NaN)),
        (src, offset) => {
          const got = webcamSourceMsFor(src, offset);
          if (src === null) return got === null;
          const off = Number.isFinite(offset) ? offset : 0;
          return got === Math.max(0, src + off);
        },
      ),
    );
    expect(webcamSourceMsFor(Number.NaN, 0)).toBeNull();
  });

  it("matches the preview's webcam element target through clips + speed regions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3000, max: 3000 }),
        fc.constantFrom(0.5, 1, 2, 4),
        fc.integer({ min: 0, max: 2000 }),
        fc.constantFrom(15, 24, 30, 60),
        (offset, rate, trimMs, fps) => {
          const clips = [
            { id: "a", sourceStartMs: 0, sourceEndMs: 1500, timelineStartMs: 0 },
            { id: "b", sourceStartMs: 1500 + trimMs, sourceEndMs: 4000, timelineStartMs: 1500 },
          ];
          const speeds = [{ startMs: 500, endMs: 2500, rate }];
          const plan = createFramePlan({ clips, speeds, fps });
          for (const pf of plan.frames()) {
            const preview = decideVideoSync({
              timelineMs: pf.timelineMs,
              isPlaying: false,
              scrubbing: false,
              clips,
              speeds,
              offsetMs: offset,
              video: { currentTime: 0, paused: true },
            });
            const expected = preview.targetS === null ? null : preview.targetS * 1000;
            const got = webcamSourceMsFor(pf.sourceMs, offset);
            if (expected === null ? got !== null : Math.abs((got ?? -1) - expected) > 1e-6) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe("withoutWebcam", () => {
  it("hides a visible bubble without mutating the scene; hidden / composition-less scenes pass through", () => {
    const s = scene(10, true);
    const hidden = withoutWebcam(s);
    expect(hidden.composition?.webcam.visible).toBe(false);
    expect(s.composition?.webcam.visible).toBe(true);
    const already = scene(10, false);
    expect(withoutWebcam(already)).toBe(already);
    const bare = scene(10, null);
    expect(withoutWebcam(bare)).toBe(bare);
  });
});

describe("WebcamFeed", () => {
  it("opens lazily, attaches frames only while visible and detaches once when hidden", async () => {
    const ledger = new FrameLedger();
    const renderer = new FakeRenderer(ledger);
    const src = source(ledger);
    const feed = new WebcamFeed({ open: src.open, syncOffsetMs: 250, renderer });

    const off = await feed.prepare(scene(0, false), 0, never);
    expect(off.frame).toBeNull();
    expect(src.state.opened).toBe(0);

    const on = await feed.prepare(scene(100, true), 100, never);
    expect(on.state.composition?.webcam.visible).toBe(true);
    expect(src.state.calls).toEqual([350]);
    on.frame?.close();
    const on2 = await feed.prepare(scene(133, true), 133, never);
    on2.frame?.close();

    await feed.prepare(scene(166, false), 166, never);
    await feed.prepare(scene(200, false), 200, never);
    expect(renderer.webcamSets).toEqual([350_000, 383_000, null]);
    expect(src.state.opened).toBe(1);
    feed.release();
    expect(src.state.closed).toBe(1);
    expect(ledger.live).toBe(0);
  });

  it("a gap (no source time) or a renderer without setWebcamFrame hides the bubble", async () => {
    const ledger = new FrameLedger();
    const src = source(ledger);
    const feed = new WebcamFeed({
      open: src.open,
      syncOffsetMs: 0,
      renderer: new FakeRenderer(ledger),
    });
    const gap = await feed.prepare(scene(0, true), null, never);
    expect(gap.state.composition?.webcam.visible).toBe(false);
    const plain = { render: async () => asVideoFrame(new FakeVideoFrame(ledger, 0)), destroy() {} };
    const noHook = new WebcamFeed({ open: src.open, syncOffsetMs: 0, renderer: plain });
    const r = await noHook.prepare(scene(0, true), 0, never);
    expect(r.state.composition?.webcam.visible).toBe(false);
    expect(src.state.opened).toBe(0);
    expect(noHook.unavailable).toBe(false);
  });

  it("a missing file turns the feed unavailable, reports once and never reopens", async () => {
    const ledger = new FrameLedger();
    const src = source(ledger, { open: true });
    const reports: unknown[] = [];
    const feed = new WebcamFeed({
      open: src.open,
      syncOffsetMs: 0,
      renderer: new FakeRenderer(ledger),
      onUnavailable: (e) => reports.push(e),
    });
    for (let i = 0; i < 5; i++) {
      const r = await feed.prepare(scene(i * 33, true), i * 33, never);
      expect(r.frame).toBeNull();
      expect(r.state.composition?.webcam.visible).toBe(false);
    }
    feed.release();
    await feed.prepare(scene(500, true), 500, never);
    expect(src.state.opened).toBe(1);
    expect(reports).toHaveLength(1);
    expect(feed.unavailable).toBe(true);
    expect(String(feed.lastError)).toMatch(/ENOENT/);
  });

  it("a decode failure mid-run closes the source, detaches and hides the bubble afterwards", async () => {
    const ledger = new FrameLedger();
    const renderer = new FakeRenderer(ledger);
    const src = source(ledger, { atCall: 3 });
    const feed = new WebcamFeed({ open: src.open, syncOffsetMs: 0, renderer });
    for (let i = 0; i < 5; i++) {
      const r = await feed.prepare(scene(i, true), i, never);
      expect(r.state.composition?.webcam.visible).toBe(i < 2);
      r.frame?.close();
    }
    expect(src.state.closed).toBe(1);
    expect(renderer.webcamSets).toEqual([0, 1000, null]);
    expect(ledger.live).toBe(0);
  });

  it("rethrows when aborted, and a source opened after release is closed straight away", async () => {
    const ledger = new FrameLedger();
    let resolveOpen: (s: FrameSource) => void = () => undefined;
    const closed: string[] = [];
    const feed = new WebcamFeed({
      open: () =>
        new Promise<FrameSource>((r) => {
          resolveOpen = r;
        }),
      syncOffsetMs: 0,
      renderer: new FakeRenderer(ledger),
    });
    const pending = feed.prepare(scene(0, true), 0, () => true);
    feed.release();
    resolveOpen({
      frameAt: async () => asVideoFrame(new FakeVideoFrame(ledger, 0)),
      close: () => closed.push("late"),
    });
    await expect(pending).rejects.toBeInstanceOf(DecoderClosedError);
    expect(closed).toEqual(["late"]);
    expect(feed.unavailable).toBe(false);
  });
});
