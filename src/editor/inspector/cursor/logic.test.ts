import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_CURSOR_BYTES,
  formatPointCount,
  hasTelemetry,
  parseCursorSettings,
  smoothingToKnob,
  smoothingToMinCutoffHz,
  validateCustomCursorFile,
} from "./logic";
import { DEFAULT_CURSOR_SETTINGS, cursorSettingsSchema } from "./types";

describe("smoothing mapping", () => {
  it("maps 0–100 to the engine's 0..1 knob, clamped", () => {
    expect(smoothingToKnob(0)).toBe(0);
    expect(smoothingToKnob(50)).toBe(0.5);
    expect(smoothingToKnob(100)).toBe(1);
    expect(smoothingToKnob(-20)).toBe(0);
    expect(smoothingToKnob(250)).toBe(1);
    expect(smoothingToKnob(Number.NaN)).toBe(DEFAULT_CURSOR_SETTINGS.smoothing / 100);
  });

  it("matches §6.6: snappy 5 Hz → silky 0.5 Hz min-cutoff", () => {
    expect(smoothingToMinCutoffHz(0)).toBeCloseTo(5);
    expect(smoothingToMinCutoffHz(100)).toBeCloseTo(0.5);
    expect(smoothingToMinCutoffHz(50)).toBeCloseTo(2.75);
  });
});

describe("formatPointCount", () => {
  it("uses thousands separators and pluralizes", () => {
    expect(formatPointCount(1204)).toBe("1,204 points");
    expect(formatPointCount(1)).toBe("1 point");
    expect(formatPointCount(1_000_000)).toBe("1,000,000 points");
  });

  it("treats junk as zero", () => {
    expect(formatPointCount(0)).toBe("0 points");
    expect(formatPointCount(-5)).toBe("0 points");
    expect(formatPointCount(Number.POSITIVE_INFINITY)).toBe("0 points");
    expect(formatPointCount(12.9)).toBe("12 points");
  });
});

describe("hasTelemetry", () => {
  it("requires a positive finite count", () => {
    expect(hasTelemetry(null)).toBe(false);
    expect(hasTelemetry(0)).toBe(false);
    expect(hasTelemetry(Number.NaN)).toBe(false);
    expect(hasTelemetry(3)).toBe(true);
  });
});

describe("validateCustomCursorFile", () => {
  it("accepts PNG and SVG by MIME", () => {
    expect(validateCustomCursorFile({ name: "a.png", type: "image/png", size: 100 })).toEqual({ ok: true, kind: "png" });
    expect(validateCustomCursorFile({ name: "a.svg", type: "image/svg+xml", size: 100 })).toEqual({ ok: true, kind: "svg" });
  });

  it("falls back to extension when MIME is empty (case-insensitive)", () => {
    expect(validateCustomCursorFile({ name: "Arrow.PNG", type: "", size: 10 })).toEqual({ ok: true, kind: "png" });
    expect(validateCustomCursorFile({ name: "x.svg", type: "", size: 10 })).toEqual({ ok: true, kind: "svg" });
  });

  it("rejects other types, even with a spoofed extension", () => {
    expect(validateCustomCursorFile({ name: "a.jpg", type: "image/jpeg", size: 10 }).ok).toBe(false);
    expect(validateCustomCursorFile({ name: "a.png", type: "image/jpeg", size: 10 }).ok).toBe(false);
    expect(validateCustomCursorFile({ name: "noext", type: "", size: 10 }).ok).toBe(false);
  });

  it("rejects empty and oversized files", () => {
    expect(validateCustomCursorFile({ name: "a.png", type: "image/png", size: 0 })).toEqual({
      ok: false,
      error: "That file is empty.",
    });
    expect(validateCustomCursorFile({ name: "a.png", type: "image/png", size: MAX_CUSTOM_CURSOR_BYTES }).ok).toBe(true);
    expect(validateCustomCursorFile({ name: "a.png", type: "image/png", size: MAX_CUSTOM_CURSOR_BYTES + 1 }).ok).toBe(false);
  });
});

describe("settings schema", () => {
  it("defaults are valid", () => {
    expect(cursorSettingsSchema.safeParse(DEFAULT_CURSOR_SETTINGS).success).toBe(true);
  });

  it("parseCursorSettings round-trips valid input and rejects out-of-range", () => {
    const custom = {
      ...DEFAULT_CURSOR_SETTINGS,
      style: "custom",
      customCursor: { fileName: "a.svg", path: "/p/a.svg", kind: "svg" },
    };
    expect(parseCursorSettings(custom)).toEqual(custom);
    expect(parseCursorSettings({ ...DEFAULT_CURSOR_SETTINGS, size: 400 })).toBe(DEFAULT_CURSOR_SETTINGS);
    expect(parseCursorSettings({ ...DEFAULT_CURSOR_SETTINGS, clickEffect: { type: "ripple", color: "red", size: 100 } })).toBe(
      DEFAULT_CURSOR_SETTINGS,
    );
    expect(parseCursorSettings(null)).toBe(DEFAULT_CURSOR_SETTINGS);
  });
});
