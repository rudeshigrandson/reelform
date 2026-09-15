import { gunzipSync, gzipSync } from "node:zlib";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MOD_CTRL,
  MOD_META,
  MOD_SHIFT,
  TelemetryCollector,
  TelemetryFile,
  encodeTelemetry,
  isPlainTyping,
  isUiohookTypingKey,
  rebaseTMs,
  rebaseWithPauses,
} from "./telemetry";
import { FakeHook } from "./testUtils";

const MS = 1_000_000n;

describe("rebasing", () => {
  it("tMs = (hostNs - firstFramePtsNs) / 1e6, exact for huge host clocks", () => {
    expect(rebaseTMs(5_000_000n, 1_000_000n)).toBe(4);
    const first = 9_000_000_000_000_000_123n;
    expect(rebaseTMs(first + 1_500_000n, first)).toBe(1.5);
    expect(rebaseTMs(first - 2n * MS, first)).toBe(-2);
  });

  it("drops events before the first frame or inside pauses and subtracts past pauses", () => {
    const pauses = [{ startNs: 100n * MS, endNs: 300n * MS }];
    expect(rebaseWithPauses(5n * MS, 10n * MS, pauses)).toBeNull();
    expect(rebaseWithPauses(150n * MS, 10n * MS, pauses)).toBeNull();
    expect(rebaseWithPauses(99n * MS, 10n * MS, pauses)).toBe(89);
    expect(rebaseWithPauses(400n * MS, 10n * MS, pauses)).toBe(190);
  });

  it("a pause that began before the first frame only counts its overlap", () => {
    expect(rebaseWithPauses(500n * MS, 100n * MS, [{ startNs: 0n, endNs: 200n * MS }])).toBe(300);
    expect(rebaseWithPauses(500n * MS, 100n * MS, [{ startNs: 0n, endNs: 50n * MS }])).toBe(400);
  });

  it("property: rebased times are monotone for events outside pauses", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 1000 })), {
          maxLength: 5,
        }),
        fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 2, maxLength: 30 }),
        (rawPauses, times) => {
          const pauses: { startNs: bigint; endNs: bigint }[] = [];
          let cursor = 0;
          for (const [gap, len] of rawPauses) {
            const s = cursor + gap;
            pauses.push({ startNs: BigInt(s) * MS, endNs: BigInt(s + len) * MS });
            cursor = s + len;
          }
          const out = [...times]
            .sort((a, b) => a - b)
            .map((t) => rebaseWithPauses(BigInt(t) * MS, 0n, pauses))
            .filter((v): v is number => v !== null);
          for (let i = 1; i < out.length; i++)
            expect(out[i]).toBeGreaterThanOrEqual(out[i - 1] as number);
          for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("typing classification", () => {
  it("letters/digits/space are typing keys; Enter, Esc, arrows, F-keys are not", () => {
    expect(isUiohookTypingKey(0x1e)).toBe(true); // A
    expect(isUiohookTypingKey(0x0b)).toBe(true); // 0
    expect(isUiohookTypingKey(0x39)).toBe(true); // space
    expect(isUiohookTypingKey(0x1c)).toBe(false); // Enter
    expect(isUiohookTypingKey(0x01)).toBe(false); // Esc
    expect(isUiohookTypingKey(0x3b)).toBe(false); // F1
    expect(isUiohookTypingKey(0xe048)).toBe(false); // Up
  });

  it("shift alone still types; ctrl/alt/meta make it a shortcut", () => {
    expect(isPlainTyping(0x1e, 0, isUiohookTypingKey)).toBe(true);
    expect(isPlainTyping(0x1e, MOD_SHIFT, isUiohookTypingKey)).toBe(true);
    expect(isPlainTyping(0x1e, MOD_META, isUiohookTypingKey)).toBe(false);
    expect(isPlainTyping(0x1e, MOD_CTRL | MOD_SHIFT, isUiohookTypingKey)).toBe(false);
  });
});

function collector(over: Partial<ConstructorParameters<typeof TelemetryCollector>[0]> = {}) {
  const hook = new FakeHook();
  let now = 0n;
  const c = new TelemetryCollector({
    hook,
    nowNs: () => now,
    origin: "display",
    bounds: { x: 100, y: 50, width: 1000, height: 500 },
    scaleFactor: 2,
    ...over,
  });
  const at = (ms: number) => {
    now = BigInt(ms) * MS;
  };
  return { hook, c, at };
}

describe("TelemetryCollector", () => {
  it("records nothing before start or after stop, and unsubscribes", () => {
    const { hook, c, at } = collector();
    hook.emit("keydown", { keycode: 0x1c });
    c.start();
    expect(hook.listenerCount).toBe(5);
    at(10);
    hook.emit("mousemove", { x: 600, y: 300 });
    c.stop();
    expect(hook.listenerCount).toBe(0);
    hook.emit("mousemove", { x: 0, y: 0 });
    const f = c.finalize({ firstFramePtsNs: 0n, keepTypedText: false });
    expect(f.points).toEqual([[10, 0.5, 0.5, "arrow"]]);
  });

  it("normalizes to the capture bounds and rebases on firstFramePtsNs", () => {
    const { hook, c, at } = collector({ cursorType: () => "ibeam" });
    at(0);
    c.start();
    at(5);
    hook.emit("mousemove", { x: 100, y: 50 }); // before first frame → dropped
    at(40);
    hook.emit("mousedown", { x: 1100, y: 550, button: 1 });
    at(45);
    hook.emit("mouseup", { x: 1100, y: 550, button: 1 });
    hook.emit("wheel", { dx: 0, dy: -3 });
    const f = c.finalize({ firstFramePtsNs: 20n * MS, keepTypedText: false });
    expect(f.points).toEqual([]);
    expect(f.clicks).toEqual([
      [20, 1, 1, 1, "down"],
      [25, 1, 1, 1, "up"],
    ]);
    expect(f.scrolls).toEqual([[25, 0, -3]]);
    expect(f).toMatchObject({ version: 1, sampleHz: 120, origin: "display", scaleFactor: 2 });
    expect(TelemetryFile.safeParse(f).success).toBe(true);
  });

  it("downsamples moves to sampleHz but keeps the resting position", () => {
    const { hook, c, at } = collector({
      sampleHz: 100,
      bounds: { x: 0, y: 0, width: 1000, height: 1000 },
    });
    at(0);
    c.start();
    for (let ms = 0; ms <= 95; ms++) {
      at(ms);
      hook.emit("mousemove", { x: ms, y: 0 });
    }
    // rest for 2s, then move again
    at(2100);
    hook.emit("mousemove", { x: 500, y: 0 });
    const f = c.finalize({ firstFramePtsNs: 0n, keepTypedText: false });
    const times = f.points.map((p) => p[0]);
    expect(times.slice(0, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(f.points).toContainEqual([95, 0.095, 0, "arrow"]);
    expect(f.points.at(-1)).toEqual([2100, 0.5, 0, "arrow"]);
  });

  it("stores keys only while recording and drops paused time", () => {
    const { hook, c, at } = collector();
    at(0);
    c.start();
    at(100);
    hook.emit("keydown", { keycode: 0x1c });
    c.pause();
    at(150);
    hook.emit("keydown", { keycode: 0x1c });
    hook.emit("mousemove", { x: 200, y: 100 });
    at(1100);
    c.resume();
    at(1200);
    hook.emit("keydown", { keycode: 0x2e, metaKey: true }); // ⌘C
    const f = c.finalize({ firstFramePtsNs: 0n, keepTypedText: false });
    expect(f.keys).toEqual([
      [100, 0x1c, 0],
      [200, 0x2e, MOD_META],
    ]);
    expect(f.points).toEqual([]);
  });

  it("discards plain typing at finalize unless the user opted in (§9.7)", () => {
    const run = (keepTypedText: boolean) => {
      const { hook, c, at } = collector();
      at(0);
      c.start();
      at(10);
      hook.emit("keydown", { keycode: 0x23 }); // h
      hook.emit("keydown", { keycode: 0x17, shiftKey: true }); // I
      hook.emit("keydown", { keycode: 0x1f, ctrlKey: true }); // Ctrl+S
      hook.emit("keydown", { keycode: 0x0f }); // Tab
      return c.finalize({ firstFramePtsNs: 0n, keepTypedText }).keys.map((k) => k[1]);
    };
    expect(run(false)).toEqual([0x1f, 0x0f]);
    expect(run(true)).toEqual([0x23, 0x17, 0x1f, 0x0f]);
  });

  it("falls back to the collector start when no first frame was reported", () => {
    const { hook, c, at } = collector();
    at(1000);
    c.start();
    at(1500);
    hook.emit("wheel", { dx: 1, dy: 0 });
    expect(c.finalize({ firstFramePtsNs: null, keepTypedText: false }).scrolls).toEqual([
      [500, 1, 0],
    ]);
  });

  it("encodes as gzipped JSON through the injected gzip", async () => {
    const { c } = collector();
    c.start();
    const file = c.finalize({ firstFramePtsNs: 0n, keepTypedText: false });
    const bytes = await encodeTelemetry(file, async (b) => new Uint8Array(gzipSync(b)));
    expect(TelemetryFile.parse(JSON.parse(gunzipSync(bytes).toString("utf8")))).toEqual(file);
  });
});
