import { z } from "zod";
import type {
  MouseButton,
  Telemetry,
  TelemetryClick,
  TelemetryKey,
  TelemetryPoint,
  TelemetryScroll,
} from "../autozoom/types";
import { type ProjectIssue, type TelemetryRef, issuesFromZod } from "../model/v1";
import type { CursorPoint } from "../preview/cursorSmoothing";

/**
 * `telemetry.json(.gz)` reader (ENGINEERING_SPEC §4). Produces the auto-zoom
 * `Telemetry` input (§8) and the raw cursor points for cursor smoothing (§6.6).
 * Decompression is injected (renderer: `DecompressionStream`; main: zlib).
 */

const n = z.number().finite();
const MOUSE_BUTTONS = ["left", "middle", "right"] as const;

function buttonFromIndex(i: number): MouseButton {
  // DOM convention: 0 = left, 1 = middle, 2 = right.
  return i === 1 ? "middle" : i === 2 ? "right" : "left";
}

const buttonSchema = z.union([
  z.enum(MOUSE_BUTTONS),
  z.number().int().min(0).max(2).transform(buttonFromIndex),
]);

export const telemetryFileSchema = z.object({
  version: z.literal(1),
  sampleHz: n.positive(),
  origin: z.enum(["display", "window", "region"]),
  bounds: z.object({ x: n, y: n, width: n.nonnegative(), height: n.nonnegative() }),
  scaleFactor: n.positive(),
  /** [tMs, x, y, cursorType]; cursorType may be omitted (→ "arrow"). */
  points: z.array(z.tuple([n, n, n]).rest(z.string())),
  clicks: z.array(z.tuple([n, n, n, buttonSchema, z.enum(["down", "up"])])).default([]),
  keys: z.array(z.tuple([n, z.number().int(), z.number().int().nonnegative()])).default([]),
  scrolls: z.array(z.tuple([n, n, n])).default([]),
});
export type TelemetryFile = z.infer<typeof telemetryFileSchema>;

export const DEFAULT_CURSOR_TYPE = "arrow";

export type TelemetryParseErrorCode =
  | "decompress-failed"
  | "invalid-encoding"
  | "invalid-json"
  | "invalid-telemetry";

export class TelemetryParseError extends Error {
  readonly code: TelemetryParseErrorCode;
  readonly issues: readonly ProjectIssue[];

  constructor(
    code: TelemetryParseErrorCode,
    message: string,
    issues: readonly ProjectIssue[] = [],
  ) {
    super(message);
    this.name = "TelemetryParseError";
    this.code = code;
    this.issues = issues;
  }
}

export interface TelemetryDeps {
  /** gunzip. Only called for gzip input (magic bytes 1f 8b). */
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface ParsedTelemetry {
  readonly file: TelemetryFile;
  /** Time-sorted input for `suggestZooms`. */
  readonly telemetry: Telemetry;
  /** Time-sorted input for `buildSmoothedCursorTrack`. */
  readonly cursorPoints: CursorPoint[];
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

const byTime = <T extends readonly [number, ...unknown[]]>(a: T, b: T) => a[0] - b[0];

export function toAutoZoomTelemetry(file: TelemetryFile): Telemetry {
  const points = file.points
    .map(([t, x, y, type]): TelemetryPoint => [t, x, y, type ?? DEFAULT_CURSOR_TYPE])
    .sort(byTime);
  const clicks = file.clicks
    .map(([t, x, y, button, phase]): TelemetryClick => [t, x, y, button, phase])
    .sort(byTime);
  const keys = file.keys.map(([t, code, mods]): TelemetryKey => [t, code, mods]).sort(byTime);
  const scrolls = file.scrolls.map(([t, dx, dy]): TelemetryScroll => [t, dx, dy]).sort(byTime);
  return { points, clicks, keys, scrolls };
}

export function toCursorPoints(telemetry: Pick<Telemetry, "points">): CursorPoint[] {
  return telemetry.points.map(([tMs, x, y, cursorType]) => ({ tMs, x, y, cursorType }));
}

/** Validate an already-decoded JSON value. Throws `TelemetryParseError`. */
export function parseTelemetryJson(raw: unknown): ParsedTelemetry {
  const parsed = telemetryFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = issuesFromZod(parsed.error);
    const first = issues[0];
    throw new TelemetryParseError(
      "invalid-telemetry",
      `Invalid telemetry file${first ? ` (${first.path}: ${first.message})` : ""}`,
      issues,
    );
  }
  const telemetry = toAutoZoomTelemetry(parsed.data);
  return { file: parsed.data, telemetry, cursorPoints: toCursorPoints(telemetry) };
}

/** Read `telemetry.json` or `telemetry.json.gz` bytes (or already-decoded text). */
export async function readTelemetryFile(
  input: Uint8Array | string,
  deps: TelemetryDeps,
): Promise<ParsedTelemetry> {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    let bytes = input;
    if (isGzip(bytes)) {
      try {
        bytes = await deps.decompress(bytes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TelemetryParseError(
          "decompress-failed",
          `Could not decompress telemetry: ${message}`,
        );
      }
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new TelemetryParseError("invalid-encoding", "Telemetry is not valid UTF-8");
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TelemetryParseError("invalid-json", `Telemetry is not valid JSON: ${message}`);
  }
  return parseTelemetryJson(raw);
}

/** Project `sources.telemetry` entry for a parsed file stored at `path`. */
export function telemetryRefFromFile(file: TelemetryFile, path: string): TelemetryRef {
  return {
    path,
    pointCount: file.points.length,
    hasClicks: file.clicks.length > 0,
    hasKeys: file.keys.length > 0,
    sampleHz: file.sampleHz,
  };
}
