import { gunzipSync, gzipSync } from "node:zlib";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { suggestZooms } from "../autozoom";
import { DEFAULT_ZOOM_SETTINGS } from "../inspector/zoom/types";
import { buildSmoothedCursorTrack } from "../preview/cursorSmoothing";
import {
  TelemetryParseError,
  isGzip,
  parseTelemetryJson,
  readTelemetryFile,
  telemetryRefFromFile,
} from "./telemetry";

const deps = { decompress: async (b: Uint8Array) => new Uint8Array(gunzipSync(b)) };

function sample() {
  return {
    version: 1,
    sampleHz: 120,
    origin: "display",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 2,
    points: [
      [20, 0.5, 0.5, "ibeam"],
      [0, 0.1, 0.2, "arrow"],
      [10, 0.3, 0.4],
    ],
    clicks: [
      [15, 0.3, 0.4, "left", "down"],
      [18, 0.3, 0.4, 2, "up"],
    ],
    keys: [[30, 40, 1]],
    scrolls: [[40, 0, -3]],
  };
}

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe("readTelemetryFile", () => {
  it("parses plain JSON bytes into sorted autozoom telemetry + cursor points", async () => {
    const r = await readTelemetryFile(encode(sample()), deps);
    expect(r.telemetry.points.map((p) => p[0])).toEqual([0, 10, 20]);
    expect(r.telemetry.points[1]).toEqual([10, 0.3, 0.4, "arrow"]);
    expect(r.telemetry.clicks[1]).toEqual([18, 0.3, 0.4, "right", "up"]);
    expect(r.telemetry.keys).toEqual([[30, 40, 1]]);
    expect(r.telemetry.scrolls).toEqual([[40, 0, -3]]);
    expect(r.cursorPoints[2]).toEqual({ tMs: 20, x: 0.5, y: 0.5, cursorType: "ibeam" });
  });

  it("gunzips via the injected decompressor only for gzip input", async () => {
    const gz = new Uint8Array(gzipSync(encode(sample())));
    expect(isGzip(gz)).toBe(true);
    let calls = 0;
    const counting = {
      decompress: async (b: Uint8Array) => {
        calls += 1;
        return deps.decompress(b);
      },
    };
    const r = await readTelemetryFile(gz, counting);
    expect(r.file.points).toHaveLength(3);
    await readTelemetryFile(encode(sample()), counting);
    expect(calls).toBe(1);
  });

  it("accepts pre-decoded text and defaults optional event arrays", async () => {
    const { clicks: _c, keys: _k, scrolls: _s, ...minimal } = sample();
    const r = await readTelemetryFile(JSON.stringify(minimal), deps);
    expect(r.telemetry.clicks).toEqual([]);
    expect(telemetryRefFromFile(r.file, "media/telemetry.json.gz")).toEqual({
      path: "media/telemetry.json.gz",
      pointCount: 3,
      hasClicks: false,
      hasKeys: false,
      sampleHz: 120,
    });
  });

  it.each([
    ["decompress-failed", new Uint8Array([0x1f, 0x8b, 0, 1, 2])],
    ["invalid-encoding", new Uint8Array([0xff, 0xfe, 0xfd])],
    ["invalid-json", new TextEncoder().encode("{nope")],
  ] as const)("%s", async (code, bytes) => {
    const err = await readTelemetryFile(bytes, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelemetryParseError);
    expect((err as TelemetryParseError).code).toBe(code);
  });

  it("reports schema issues with paths", () => {
    const bad = { ...sample(), clicks: [[1, 0, 0, "left", "sideways"]] };
    try {
      parseTelemetryJson(bad);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TelemetryParseError);
      const err = e as TelemetryParseError;
      expect(err.code).toBe("invalid-telemetry");
      expect(err.issues.map((i) => i.path)).toContain("clicks[0][4]");
    }
    expect(() => parseTelemetryJson({ ...sample(), version: 2 })).toThrow(/version/);
  });

  it("property: outputs are time-sorted and preserve counts", () => {
    const tuple = fc.tuple(
      fc.integer({ min: 0, max: 100_000 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
    );
    fc.assert(
      fc.property(fc.array(tuple, { maxLength: 50 }), (pts) => {
        const r = parseTelemetryJson({
          ...sample(),
          points: pts.map(([t, x, y]) => [t, x, y, "arrow"]),
        });
        const ts = r.cursorPoints.map((p) => p.tMs);
        return ts.length === pts.length && ts.every((t, i) => i === 0 || (ts[i - 1] ?? 0) <= t);
      }),
    );
  });

  it("feeds the auto-zoom engine and cursor smoothing without adaptation", () => {
    const points: [number, number, number, string][] = [];
    for (let t = 0; t <= 6000; t += 16) points.push([t, 0.2 + t / 60_000, 0.3, "arrow"]);
    const clicks = [
      [1000, 0.22, 0.3, "left", "down"],
      [1080, 0.22, 0.3, "left", "up"],
    ];
    const r = parseTelemetryJson({ ...sample(), points, clicks, keys: [], scrolls: [] });
    const zooms = suggestZooms({
      telemetry: r.telemetry,
      content: { w: 1920, h: 1080 },
      clips: [{ sourceStartMs: 0, sourceEndMs: 6000, timelineStartMs: 0 }],
      sensitivity: 0.5,
      options: DEFAULT_ZOOM_SETTINGS.autoZoom,
    });
    expect(zooms.length).toBeGreaterThan(0);
    const track = buildSmoothedCursorTrack(r.cursorPoints, { smoothing: 0.5 });
    expect(track.positionAt(3000).x).toBeCloseTo(0.25, 1);
  });
});
