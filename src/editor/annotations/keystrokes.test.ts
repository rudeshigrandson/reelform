import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CHORD_WINDOW_MS,
  KEYSTROKE_BADGE_MS,
  type KeyTelemetryEvent,
  MOD,
  addAllKeystrokeBadges,
  detectKeystrokes,
  keyGlyph,
} from "./index";

let n = 0;
const newId = (): string => `k${++n}`;

describe("keystroke grouping (fixtures)", () => {
  it("merges a modifier press into a key within 80ms (chord)", () => {
    const keys: KeyTelemetryEvent[] = [
      [1000, "MetaLeft", 0],
      [1000 + CHORD_WINDOW_MS, "KeyK", 0],
    ];
    expect(detectKeystrokes(keys, "mac")).toEqual([{ tMs: 1080, label: "⌘K" }]);
  });

  it("does not chord a modifier pressed more than 80ms earlier", () => {
    const keys: KeyTelemetryEvent[] = [
      [1000, "MetaLeft", 0],
      [1000 + CHORD_WINDOW_MS + 1, "KeyK", 0],
    ];
    expect(detectKeystrokes(keys, "mac")).toEqual([]);
  });

  it("formats platform glyphs for shortcuts with modifiers", () => {
    const keys: KeyTelemetryEvent[] = [
      [100, "KeyP", MOD.ctrl | MOD.shift],
      [900, "Enter", MOD.alt],
      [1800, "KeyL", MOD.meta],
    ];
    expect(detectKeystrokes(keys, "mac").map((c) => c.label)).toEqual(["⌃⇧P", "⌥↩", "⌘L"]);
    expect(detectKeystrokes(keys, "win").map((c) => c.label)).toEqual([
      "Ctrl+Shift+P",
      "Alt+Enter",
      "Win+L",
    ]);
  });

  it("labels common keys", () => {
    expect(keyGlyph("Escape", "mac")).toBe("⎋");
    expect(keyGlyph("Escape", "win")).toBe("Esc");
    expect(keyGlyph("Digit7", "linux")).toBe("7");
    expect(keyGlyph("Slash", "mac")).toBe("/");
    expect(keyGlyph("ArrowUp", "win")).toBe("↑");
  });

  it("sorts unsorted telemetry", () => {
    const keys: KeyTelemetryEvent[] = [
      [2000, "KeyB", MOD.meta],
      [1000, "KeyA", MOD.meta],
    ];
    expect(detectKeystrokes(keys, "mac").map((c) => c.label)).toEqual(["⌘A", "⌘B"]);
  });
});

describe("privacy", () => {
  it("plain typing and Shift+typing never produce badges", () => {
    const typed: KeyTelemetryEvent[] = [..."HELLO"].map(
      (ch, i) => [i * 120, `Key${ch}`, 0] as const,
    );
    const shifted: KeyTelemetryEvent[] = [
      [1000, "ShiftLeft", 0],
      [1020, "KeyA", MOD.shift],
      [1200, "Digit1", MOD.shift],
      [1400, "Space", 0],
      [1600, "Enter", 0],
    ];
    expect(detectKeystrokes([...typed, ...shifted], "mac")).toEqual([]);
  });

  it("property: keys without any modifier never yield a candidate", () => {
    const code = fc.oneof(
      fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`)),
      fc.constantFrom("Digit0", "Digit9", "Space", "Enter", "Tab", "Comma"),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(100000), code), { maxLength: 60 }), (events) => {
        const keys: KeyTelemetryEvent[] = events.map(([t, c]) => [t, c, 0] as const);
        expect(detectKeystrokes(keys, "mac")).toEqual([]);
      }),
    );
  });
});

describe("addAllKeystrokeBadges", () => {
  it("creates 1.2s bottom-center fixed badges", () => {
    const keys: KeyTelemetryEvent[] = [
      [500, "KeyK", MOD.meta],
      [4000, "KeyS", MOD.meta],
      [4050, "KeyX", 0],
    ];
    const badges = addAllKeystrokeBadges(keys, "mac", { timelineDurationMs: 10_000, newId });
    expect(badges.map((b) => b.label)).toEqual(["⌘K", "⌘S"]);
    for (const b of badges) {
      expect(b.kind).toBe("keystrokeBadge");
      expect(b.endMs - b.startMs).toBe(KEYSTROKE_BADGE_MS);
      expect(b.x + b.w / 2).toBeCloseTo(0.5, 12);
      expect(b.y).toBeGreaterThan(0.5);
      expect(b.followZoom).toBe(false);
    }
  });

  it("clips at the timeline end and skips existing badges", () => {
    const keys: KeyTelemetryEvent[] = [
      [500, "KeyK", MOD.meta],
      [9500, "KeyS", MOD.meta],
      [20000, "KeyZ", MOD.meta],
    ];
    const first = addAllKeystrokeBadges(keys, "mac", { timelineDurationMs: 10_000, newId });
    expect(first).toHaveLength(2);
    expect(first[1]?.endMs).toBe(10_000);
    const again = addAllKeystrokeBadges(keys, "mac", {
      timelineDurationMs: 10_000,
      newId,
      existing: first,
    });
    expect(again).toEqual([]);
  });
});
