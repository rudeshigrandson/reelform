import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ExportProgress, PHASE_LABELS, ProgressTracker } from "./progress";

function tracker(framesTotal: number, fps = 30, alpha?: number) {
  let t = 1000;
  const events: ExportProgress[] = [];
  const p = new ProgressTracker({
    framesTotal,
    fps,
    now: () => t,
    encoder: "hardware",
    alpha,
    onProgress: (e) => events.push(e),
  });
  const advance = (ms: number): void => {
    t += ms;
  };
  return { p, events, advance };
}

describe("ProgressTracker", () => {
  it("labels every phase", () => {
    expect(PHASE_LABELS).toEqual({
      preparing: "Preparing",
      rendering: "Rendering",
      "encoding-audio": "Encoding audio",
      muxing: "Muxing",
      finalizing: "Finalizing",
    });
    const { p, events } = tracker(10);
    p.setPhase("preparing");
    p.setPhase("rendering");
    expect(events.map((e) => e.label)).toEqual(["Preparing", "Rendering"]);
    expect(events[1]).toMatchObject({
      framesDone: 0,
      framesTotal: 10,
      fraction: 0,
      etaMs: null,
      speed: null,
    });
  });

  it("EMA frame time drives the ETA; speed is media time per wall time", () => {
    const { p, advance } = tracker(10, 30, 0.5);
    p.setPhase("rendering");
    advance(100);
    p.frameDone();
    expect(p.snapshot().etaMs).toBeCloseTo(900);
    advance(20);
    p.frameDone();
    // ema = 0.5·20 + 0.5·100 = 60; 8 frames left.
    const s = p.snapshot();
    expect(s.etaMs).toBeCloseTo(480);
    expect(s.fraction).toBeCloseTo(0.2);
    // 2 frames @30fps = 66.67 media ms over 120 wall ms.
    expect(s.speed).toBeCloseTo(66.6667 / 120, 4);
  });

  it("realtime speed factor of 2 when frames arrive at twice the frame rate", () => {
    const { p, advance } = tracker(100, 60);
    p.setPhase("rendering");
    for (let i = 0; i < 30; i++) {
      advance(1000 / 120);
      p.frameDone();
    }
    expect(p.snapshot().speed).toBeCloseTo(2, 6);
    expect(p.snapshot().etaMs).toBeCloseTo((1000 / 120) * 70, 6);
  });

  it("finishes at fraction 1 / eta 0 and never overshoots", () => {
    const { p } = tracker(2);
    p.setPhase("rendering");
    p.frameDone();
    p.frameDone();
    p.frameDone();
    expect(p.snapshot()).toMatchObject({ framesDone: 2, fraction: 1, etaMs: 0 });
    expect(tracker(0).p.snapshot().fraction).toBe(1);
  });

  it("reports the resolved encoder", () => {
    const { p } = tracker(1);
    p.setEncoder("software");
    expect(p.snapshot().encoder).toBe("software");
  });

  it("invalid alpha falls back to the default; ETA stays non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 1, maxLength: 50 }),
        fc.oneof(fc.constant(Number.NaN), fc.double({ min: -1, max: 2, noNaN: true })),
        (steps, alpha) => {
          const { p, advance } = tracker(60, 30, alpha);
          p.setPhase("rendering");
          for (const s of steps) {
            advance(s);
            p.frameDone();
            const snap = p.snapshot();
            if (snap.etaMs !== null && (snap.etaMs < 0 || !Number.isFinite(snap.etaMs)))
              return false;
            if (snap.fraction < 0 || snap.fraction > 1) return false;
          }
          return true;
        },
      ),
    );
  });
});
