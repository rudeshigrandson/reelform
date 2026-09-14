import { knobToMinCutoff } from "../../preview/cursorSmoothing";
import { cursorSettingsSchema, CURSOR_LIMITS, DEFAULT_CURSOR_SETTINGS, type CursorSettings } from "./types";

/** Map the inspector's 0–100 "Snappy ⟷ Silky" value to the preview engine's 0..1 knob. */
export function smoothingToKnob(smoothing: number): number {
  if (!Number.isFinite(smoothing)) return DEFAULT_CURSOR_SETTINGS.smoothing / 100;
  const { min, max } = CURSOR_LIMITS.smoothing;
  return Math.min(max, Math.max(min, smoothing)) / 100;
}

/** One-euro min-cutoff (Hz) that the preview engine will use for a 0–100 smoothing value. */
export function smoothingToMinCutoffHz(smoothing: number): number {
  return knobToMinCutoff(smoothingToKnob(smoothing));
}

/** "1,204 points" / "1 point". Negative or non-finite counts read as 0. */
export function formatPointCount(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${n.toLocaleString("en-US")} ${n === 1 ? "point" : "points"}`;
}

/** True when there's usable cursor telemetry for the rendered cursor. */
export function hasTelemetry(pointCount: number | null): pointCount is number {
  return pointCount !== null && Number.isFinite(pointCount) && pointCount > 0;
}

/** Custom cursor size limit — sprites are tiny; anything bigger is almost certainly the wrong file. */
export const MAX_CUSTOM_CURSOR_BYTES = 2 * 1024 * 1024;

export type CustomCursorValidation =
  | { ok: true; kind: "png" | "svg" }
  | { ok: false; error: string };

/** Minimal file shape so this stays testable without a DOM `File`. */
export interface CursorFileLike {
  name: string;
  type: string;
  size: number;
}

/** Validate a custom cursor upload: PNG or SVG (by MIME or extension), non-empty, ≤ 2 MB. */
export function validateCustomCursorFile(file: CursorFileLike): CustomCursorValidation {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const mime = file.type.toLowerCase();
  let kind: "png" | "svg" | null = null;
  if (mime === "image/png" || (mime === "" && ext === "png")) kind = "png";
  else if (mime === "image/svg+xml" || (mime === "" && ext === "svg")) kind = "svg";
  if (kind === null) return { ok: false, error: "Use a PNG or SVG file." };
  if (file.size <= 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_CUSTOM_CURSOR_BYTES) return { ok: false, error: "Cursor image must be 2 MB or smaller." };
  return { ok: true, kind };
}

/** Parse persisted settings; anything invalid falls back to the defaults. */
export function parseCursorSettings(input: unknown): CursorSettings {
  const parsed = cursorSettingsSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_CURSOR_SETTINGS;
}
