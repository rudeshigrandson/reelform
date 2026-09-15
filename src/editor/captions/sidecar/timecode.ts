/**
 * Sidecar timestamps (ENGINEERING_SPEC §9.6 export/import).
 * SRT: `HH:MM:SS,mmm`. WebVTT: `HH:MM:SS.mmm`, hours optional (`MM:SS.mmm`).
 */

export type TimecodeSeparator = "," | ".";

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** Format ms as `HH:MM:SS<sep>mmm`. Negative/non-finite → 0; hours may exceed 99. */
export function formatTimecode(ms: number, sep: TimecodeSeparator): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const milli = total % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(milli, 3)}`;
}

const TIMECODE_RE = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)[,.](\d{1,3})$/;

/**
 * Parse a timestamp, tolerating `,` or `.`, 1–3 fractional digits (as a decimal
 * fraction: `.5` = 500ms) and missing hours. Returns null when malformed.
 */
export function parseTimecode(text: string): number | null {
  const m = TIMECODE_RE.exec(text.trim());
  if (!m || m[2] === undefined || m[3] === undefined || m[4] === undefined) return null;
  const h = m[1] === undefined ? 0 : Number(m[1]);
  const frac = Number(m[4].padEnd(3, "0"));
  return h * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + frac;
}

export interface TimingLine {
  startMs: number;
  endMs: number;
}

/** `start --> end [cue settings]`; settings are ignored. Null when not a timing line. */
export function parseTimingLine(line: string): TimingLine | null {
  const m = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(line);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const startMs = parseTimecode(m[1]);
  const endMs = parseTimecode(m[2]);
  if (startMs === null || endMs === null) return null;
  return { startMs, endMs };
}

export const isTimingLine = (line: string): boolean => line.includes("-->");
