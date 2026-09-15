import { describe, expect, it } from "vitest";
import type { Telemetry } from "../../autozoom";
import { MOD } from "../annotations/keystrokes";
import { detectIdleSections } from "../effects/logic";
import {
  REC_MOD,
  cursorSamplesFromTelemetry,
  detectTelemetryShortcuts,
  recorderModsToMod,
  telemetryKeysToEvents,
  uiohookToDomCode,
} from "./telemetryInputs";

const K = {
  k: 0x25,
  s: 0x1f,
  p: 0x19,
  one: 0x02,
  zero: 0x0b,
  enter: 0x1c,
  metaL: 0x0e5b,
  left: 0xe04b,
};

const tel = (over: Partial<Telemetry>): Telemetry => ({
  points: [],
  clicks: [],
  keys: [],
  scrolls: [],
  ...over,
});

describe("uiohook key codes", () => {
  it("maps letters, digits, named and extended keys", () => {
    expect(uiohookToDomCode(K.k)).toBe("KeyK");
    expect(uiohookToDomCode(0x10)).toBe("KeyQ");
    expect(uiohookToDomCode(0x32)).toBe("KeyM");
    expect(uiohookToDomCode(K.one)).toBe("Digit1");
    expect(uiohookToDomCode(K.zero)).toBe("Digit0");
    expect(uiohookToDomCode(K.enter)).toBe("Enter");
    expect(uiohookToDomCode(K.metaL)).toBe("MetaLeft");
    expect(uiohookToDomCode(K.left)).toBe("ArrowLeft");
    expect(uiohookToDomCode(0x3b)).toBe("F1");
    expect(uiohookToDomCode(0x44)).toBe("F10");
    expect(uiohookToDomCode(0xffff)).toBeNull();
  });

  it("converts the recorder modifier mask to the detector mask", () => {
    expect(recorderModsToMod(REC_MOD.shift)).toBe(MOD.shift);
    expect(recorderModsToMod(REC_MOD.ctrl | REC_MOD.meta)).toBe(MOD.ctrl | MOD.meta);
    expect(recorderModsToMod(15)).toBe(15);
    expect(recorderModsToMod(0)).toBe(0);
  });

  it("drops unknown codes", () => {
    expect(
      telemetryKeysToEvents([
        [5, 0xffff, 0],
        [6, K.k, REC_MOD.meta],
      ]),
    ).toEqual([[6, "KeyK", MOD.meta]]);
  });
});

describe("detectTelemetryShortcuts", () => {
  const keys: Telemetry["keys"] = [
    [1000, K.k, REC_MOD.meta], // ⌘K
    [1100, K.k, REC_MOD.meta], // key repeat → collapsed
    [3000, K.s, REC_MOD.shift], // Shift+S is typing → dropped
    [4000, K.p, REC_MOD.meta | REC_MOD.shift], // ⇧⌘P
    [5000, K.one, 0], // plain typing → dropped
    [9000, K.s, REC_MOD.ctrl], // inside a trimmed range below
  ];

  it("detects shortcuts with mac glyphs", () => {
    expect(detectTelemetryShortcuts(tel({ keys }), [], "mac")).toEqual([
      { tMs: 1000, label: "⌘K" },
      { tMs: 4000, label: "⇧⌘P" },
      { tMs: 9000, label: "⌃S" },
    ]);
  });

  it("uses PC labels and maps to timeline ms, dropping trimmed presses", () => {
    const clips = [
      { id: "a", sourceStartMs: 500, sourceEndMs: 6000, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 10_000, sourceEndMs: 12_000, timelineStartMs: 5500 },
    ];
    expect(detectTelemetryShortcuts(tel({ keys }), clips, "win")).toEqual([
      { tMs: 500, label: "Win+K" },
      { tMs: 3500, label: "Shift+Win+P" },
    ]);
  });

  it("handles no telemetry / no keys", () => {
    expect(detectTelemetryShortcuts(null, [], "mac")).toEqual([]);
    expect(detectTelemetryShortcuts(tel({}), [], "mac")).toEqual([]);
  });
});

describe("cursorSamplesFromTelemetry", () => {
  const still = Array.from({ length: 81 }, (_, i) => [i * 100, 0.5, 0.5, "arrow"] as const);

  it("returns null without points", () => {
    expect(cursorSamplesFromTelemetry(null, [])).toBeNull();
    expect(cursorSamplesFromTelemetry(tel({}), [])).toBeNull();
  });

  it("clicks and keys break idle stretches", () => {
    const idleOnly = cursorSamplesFromTelemetry(tel({ points: still }), []);
    expect(detectIdleSections(idleOnly ?? [])).toEqual([{ startMs: 0, endMs: 8000 }]);
    const broken = cursorSamplesFromTelemetry(
      tel({ points: still, clicks: [[4000, 0.5, 0.5, "left", "down"]], keys: [[6000, K.k, 0]] }),
      [],
    );
    expect(broken?.filter((s) => s.click)).toHaveLength(2);
    expect(detectIdleSections(broken ?? [])).toEqual([{ startMs: 0, endMs: 4000 }]);
  });

  it("maps to timeline and drops trimmed samples", () => {
    const out = cursorSamplesFromTelemetry(tel({ points: still }), [
      { id: "a", sourceStartMs: 2000, sourceEndMs: 5000, timelineStartMs: 0 },
    ]);
    expect(out?.[0]?.tMs).toBe(0);
    expect(out?.at(-1)?.tMs).toBe(2900);
    expect(out).toHaveLength(30);
  });
});
