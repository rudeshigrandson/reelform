import { describe, expect, it } from "vitest";
import {
  clickCandidates,
  dwellCandidates,
  scrollCandidates,
  selectionCandidates,
  typingCandidates,
} from "./candidates.js";
import { resample } from "./normalize.js";
import type {
  Telemetry,
  TelemetryClick,
  TelemetryKey,
  TelemetryPoint,
  TelemetryScroll,
} from "./types.js";

function emptyTelemetry(over: Partial<Telemetry> = {}): Telemetry {
  return { points: [], clicks: [], keys: [], scrolls: [], ...over };
}

describe("clickCandidates", () => {
  it("emits a strength-1.0 candidate for a single left click-down", () => {
    const clicks: TelemetryClick[] = [[1000, 0.5, 0.5, "left", "down"]];
    const c = clickCandidates(clicks);
    expect(c).toHaveLength(1);
    expect(c[0]?.strength).toBe(1.0);
    expect(c[0]?.kind).toBe("click");
  });

  it("boosts a double click to 1.2", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.5, 0.5, "left", "down"],
      [1000, 0.5, 0.5, "left", "up"],
      [1200, 0.5, 0.5, "left", "down"],
    ];
    const c = clickCandidates(clicks);
    // second down is a double-click
    expect(c[1]?.strength).toBe(1.2);
  });

  it("uses 0.6 for right-click", () => {
    const clicks: TelemetryClick[] = [[1000, 0.5, 0.5, "right", "down"]];
    expect(clickCandidates(clicks)[0]?.strength).toBe(0.6);
  });
});

describe("typingCandidates", () => {
  it("emits one candidate for a burst of >=3 keys within 1.5s at last click", () => {
    const keys: TelemetryKey[] = [
      [1000, 65, 0],
      [1200, 66, 0],
      [1400, 67, 0],
    ];
    const clicks: TelemetryClick[] = [[500, 0.3, 0.7, "left", "down"]];
    const t = emptyTelemetry({ keys, clicks });
    const c = typingCandidates(t, []);
    expect(c).toHaveLength(1);
    expect(c[0]?.strength).toBe(0.9);
    expect(c[0]?.tMs).toBe(1000);
    expect(c[0]?.x).toBeCloseTo(0.3);
    expect(c[0]?.y).toBeCloseTo(0.7);
  });

  it("ignores fewer than 3 keys", () => {
    const keys: TelemetryKey[] = [
      [1000, 65, 0],
      [1100, 66, 0],
    ];
    expect(typingCandidates(emptyTelemetry({ keys }), [])).toHaveLength(0);
  });
});

describe("dwellCandidates", () => {
  it("detects a slow cursor pause of >=450ms and <=2600ms", () => {
    // cursor sits at (0.4,0.4) for ~1s, sampled densely
    const points: TelemetryPoint[] = [];
    for (let t = 0; t <= 1000; t += 100) points.push([t, 0.4, 0.4, "arrow"]);
    const samples = resample(points);
    const c = dwellCandidates(samples);
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0]?.kind).toBe("dwell");
    expect(c[0]?.x).toBeCloseTo(0.4, 2);
  });

  it("ignores fast movement", () => {
    const points: TelemetryPoint[] = [
      [0, 0.0, 0.0, "arrow"],
      [100, 0.9, 0.9, "arrow"],
      [200, 0.0, 0.0, "arrow"],
    ];
    const c = dwellCandidates(resample(points));
    expect(c).toHaveLength(0);
  });
});

describe("scrollCandidates", () => {
  it("emits a 0.4 candidate for a scroll burst at cursor position", () => {
    const points: TelemetryPoint[] = [
      [0, 0.6, 0.2, "arrow"],
      [1000, 0.6, 0.2, "arrow"],
    ];
    const scrolls: TelemetryScroll[] = [
      [400, 0, 10],
      [500, 0, 12],
      [600, 0, 8],
    ];
    const t = emptyTelemetry({ points, scrolls });
    const c = scrollCandidates(t, resample(points));
    expect(c).toHaveLength(1);
    expect(c[0]?.strength).toBe(0.4);
    expect(c[0]?.x).toBeCloseTo(0.6, 1);
  });
});

describe("selectionCandidates", () => {
  it("detects a horizontal drag with small vertical movement", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.2, 0.5, "left", "down"],
      [1400, 0.6, 0.52, "left", "up"],
    ];
    const c = selectionCandidates(clicks);
    expect(c).toHaveLength(1);
    expect(c[0]?.strength).toBe(0.8);
    expect(c[0]?.kind).toBe("selection");
    expect(c[0]?.endMs).toBe(1400);
  });

  it("ignores drags with large vertical movement", () => {
    const clicks: TelemetryClick[] = [
      [1000, 0.2, 0.2, "left", "down"],
      [1400, 0.6, 0.8, "left", "up"],
    ];
    expect(selectionCandidates(clicks)).toHaveLength(0);
  });
});
