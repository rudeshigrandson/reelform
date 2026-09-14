import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  KEYSTROKE_BADGE_MS,
  MOD,
  detectKeystrokes,
  formatShortcut,
  keyGlyph,
  keystrokeBadgesFromCandidates,
  summarizeShortcuts,
  type KeyTelemetryEvent,
} from "./index";

const ALL = MOD.ctrl | MOD.alt | MOD.shift | MOD.meta;

describe("formatShortcut", () => {
  it("formats mac glyphs in ⌃⌥⇧⌘ order", () => {
    expect(formatShortcut(MOD.meta, "KeyK", "mac")).toBe("⌘K");
    expect(formatShortcut(MOD.meta | MOD.shift, "KeyP", "mac")).toBe("⇧⌘P");
    expect(formatShortcut(ALL, "Digit1", "mac")).toBe("⌃⌥⇧⌘1");
    expect(formatShortcut(MOD.meta, "Enter", "mac")).toBe("⌘↩");
  });

  it("formats win/linux with + separators", () => {
    expect(formatShortcut(MOD.ctrl | MOD.shift, "KeyP", "win")).toBe("Ctrl+Shift+P");
    expect(formatShortcut(ALL, "Escape", "win")).toBe("Ctrl+Alt+Shift+Win+Esc");
    expect(formatShortcut(MOD.meta, "KeyL", "linux")).toBe("Super+L");
  });

  it("mac modifier order is stable for any mask (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: ALL }), (mask) => {
        const label = formatShortcut(mask, "KeyA", "mac");
        const mods = label.slice(0, -1);
        const order = "⌃⌥⇧⌘";
        const idx = [...mods].map((g) => order.indexOf(g));
        return idx.every((v, i) => v >= 0 && (i === 0 || v > (idx[i - 1] ?? -1)));
      }),
    );
  });

  it("maps punctuation and falls back to the raw code", () => {
    expect(keyGlyph("BracketLeft", "mac")).toBe("[");
    expect(keyGlyph("F5", "win")).toBe("F5");
  });
});

describe("detectKeystrokes", () => {
  it("keeps shortcuts and drops plain typing and Shift+letters", () => {
    const keys: KeyTelemetryEvent[] = [
      [100, "KeyH", 0],
      [200, "KeyI", MOD.shift],
      [300, "KeyK", MOD.meta],
      [900, "Tab", MOD.shift],
    ];
    expect(detectKeystrokes(keys, "mac")).toEqual([
      { tMs: 300, label: "⌘K" },
      { tMs: 900, label: "⇧⇥" },
    ]);
  });

  it("merges a modifier press into a key within 80ms", () => {
    expect(detectKeystrokes([[1000, "MetaLeft", 0], [1050, "KeyS", 0]], "mac")).toEqual([{ tMs: 1050, label: "⌘S" }]);
    expect(detectKeystrokes([[1000, "MetaLeft", 0], [1200, "KeyS", 0]], "mac")).toEqual([]);
  });

  it("collapses key repeat but keeps separate presses", () => {
    const keys: KeyTelemetryEvent[] = [
      [0, "KeyZ", MOD.meta],
      [100, "KeyZ", MOD.meta],
      [200, "KeyZ", MOD.meta],
      [2000, "KeyZ", MOD.meta],
    ];
    expect(detectKeystrokes(keys, "mac").map((c) => c.tMs)).toEqual([0, 2000]);
  });

  it("sorts unsorted telemetry and ignores modifier-only events", () => {
    const keys: KeyTelemetryEvent[] = [
      [500, "KeyB", MOD.ctrl],
      [100, "KeyA", MOD.ctrl],
      [900, "ShiftLeft", MOD.ctrl],
    ];
    expect(detectKeystrokes(keys, "win").map((c) => c.label)).toEqual(["Ctrl+A", "Ctrl+B"]);
  });

  it("never emits an unmodified label (property)", () => {
    const codes = ["KeyA", "KeyK", "Digit3", "Enter", "Space", "MetaLeft", "ShiftLeft", "Comma"];
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 5000 }), fc.constantFrom(...codes), fc.integer({ min: 0, max: ALL }))),
        (keys) => detectKeystrokes(keys, "win").every((c) => c.label.includes("+")),
      ),
    );
  });
});

describe("summarizeShortcuts", () => {
  it("dedupes with counts ordered by first use", () => {
    const s = summarizeShortcuts([
      { tMs: 500, label: "⌘K" },
      { tMs: 100, label: "⌘S" },
      { tMs: 900, label: "⌘K" },
    ]);
    expect(s).toEqual([
      { label: "⌘S", count: 1, firstMs: 100 },
      { label: "⌘K", count: 2, firstMs: 500 },
    ]);
  });
});

describe("keystrokeBadgesFromCandidates", () => {
  let n = 0;
  const newId = () => `k${n++}`;

  it("creates 1.2s bottom-center badges clamped to the timeline", () => {
    const badges = keystrokeBadgesFromCandidates(
      [
        { tMs: 1000, label: "⌘K" },
        { tMs: 9500, label: "⌘S" },
        { tMs: 10_000, label: "⌘Z" },
      ],
      { timelineDurationMs: 10_000, newId },
    );
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({ kind: "keystrokeBadge", label: "⌘K", startMs: 1000, endMs: 1000 + KEYSTROKE_BADGE_MS });
    expect(badges[1]?.endMs).toBe(10_000);
    const b = badges[0];
    expect(b && b.x + b.w / 2).toBeCloseTo(0.5);
    expect(b?.y).toBeGreaterThan(0.5);
  });

  it("is idempotent: Add all twice adds nothing new", () => {
    const cands = [{ tMs: 1000, label: "⌘K" }, { tMs: 1000, label: "⌘K" }];
    const first = keystrokeBadgesFromCandidates(cands, { timelineDurationMs: 10_000, newId });
    expect(first).toHaveLength(1);
    expect(keystrokeBadgesFromCandidates(cands, { timelineDurationMs: 10_000, newId, existing: first })).toEqual([]);
  });
});
