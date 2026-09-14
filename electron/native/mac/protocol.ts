import { z } from "zod";

/**
 * macOS native helper protocol (ENGINEERING_SPEC §5.3 / §5.5), zod side.
 *
 * Stdio, UTF-8, one JSON object per line: `{ "t": "<type>", "id"?: number, ...payload }`.
 * Mirrors `Sources/ReelformProtocol/Messages.swift`; both sides are pinned by
 * `fixtures/protocol-golden.json` (Swift self-check writes/compares it, the
 * vitest suite validates it). Main validates every helper line with these
 * schemas before acting on it.
 *
 * Host-clock nanosecond fields (`*Ns`) are integers from `mach_absolute_time`;
 * JS numbers are exact below 2^53 ns (~104 days of awake uptime) and off by a
 * few ns beyond, which is irrelevant at telemetry's ms resolution.
 */

export const HELPER_PROTOCOL_VERSION = "1.0.0";

export const SCK_CAPS = [
  "display",
  "window",
  "excludePids",
  "region",
  "systemAudio",
  "mic",
  "pause",
  "fragmentedMp4",
  "h264",
] as const;

export const CURSOR_CAPS = [
  "position",
  "clicks",
  "keys",
  "scroll",
  "cursorType",
  "cursorAssets",
] as const;

/** Cursor types matching style-pack sprite names (§9.2). */
export const CURSOR_KINDS = [
  "arrow",
  "ibeam",
  "hand",
  "grab",
  "resize-ew",
  "resize-ns",
  "resize-nesw",
  "resize-nwse",
] as const;

/** Modifier bitmask carried by `key` events. */
export const MODIFIER = {
  shift: 1,
  control: 2,
  option: 4,
  command: 8,
  function: 16,
  capsLock: 32,
} as const;

export const INTERRUPT_REASONS = [
  "streamStopped",
  "sourceLost",
  "deviceLost",
  "writerFailed",
  "parentGone",
] as const;

/** Stable `error.code` strings emitted by the helpers. */
export const HELPER_ERROR_CODES = [
  "badRequest",
  "unknownCommand",
  "invalidState",
  "permissionDenied",
  "sourceNotFound",
  "writerFailed",
  "streamFailed",
  "micUnavailable",
  "noFrames",
  "exportFailed",
  "internal",
] as const;

const id = z.number().int().nonnegative().optional();
const hostNs = z.number().int().nonnegative();
const finite = z.number().finite();
const uint32 = z.number().int().min(0).max(0xffff_ffff);

// ---- reelform-sck: inbound (main → helper) --------------------------------

export const SckSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("display"),
    displayId: uint32,
    /** PIDs whose windows (Reelform HUD / webcam bubble) are excluded. */
    excludePids: z.array(z.number().int().min(0).max(0x7fff_ffff)).optional(),
  }),
  z.object({ kind: z.literal("window"), windowId: uint32 }),
]);
export type SckSource = z.infer<typeof SckSource>;

/** Display points, origin top-left of the display. */
export const CaptureRegion = z.object({
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
});
export type CaptureRegion = z.infer<typeof CaptureRegion>;

export const SckPing = z.object({ t: z.literal("ping"), id });
export const SckStart = z
  .object({
    t: z.literal("start"),
    id,
    outputDir: z.string().min(1),
    source: SckSource,
    region: CaptureRegion.optional(),
    fps: z.union([z.literal(30), z.literal(60)]),
    audio: z.object({
      system: z.boolean(),
      /** `AVCaptureDevice.uniqueID` or "default"; absent = no mic. */
      mic: z.string().min(1).optional(),
    }),
  })
  .refine((m) => m.region === undefined || m.source.kind === "display", {
    message: "region is only valid for display sources",
    path: ["region"],
  });
export const SckPause = z.object({ t: z.literal("pause"), id });
export const SckResume = z.object({ t: z.literal("resume"), id });
export const SckStop = z.object({ t: z.literal("stop"), id });
export const SckDiscard = z.object({ t: z.literal("discard"), id });

export const SckCommand = z.union([SckPing, SckStart, SckPause, SckResume, SckStop, SckDiscard]);
export type SckCommand = z.infer<typeof SckCommand>;

// ---- reelform-sck: outbound (helper → main) -------------------------------

const caps = z.array(z.string());

export const SckPong = z.object({
  t: z.literal("pong"),
  id,
  version: z.string(),
  caps,
});
export const SckReady = z.object({ t: z.literal("ready") });
export const SckStarted = z.object({
  t: z.literal("started"),
  id,
  /** Host-clock PTS of the first video frame; telemetry rebases against it. */
  firstFramePtsNs: hostNs,
  /** Host time when capture was started (before the first frame). */
  startHostTimeNs: hostNs,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: finite.positive(),
});
export const SckStats = z.object({
  t: z.literal("stats"),
  fps: finite.nonnegative(),
  droppedFrames: z.number().int().nonnegative(),
  fileBytes: z.number().int().nonnegative(),
});
export const SckInterrupted = z.object({
  t: z.literal("interrupted"),
  reason: z.enum(INTERRUPT_REASONS),
  message: z.string(),
});
export const PausedRange = z
  .object({ startNs: hostNs, endNs: hostNs })
  .refine((r) => r.endNs >= r.startNs, { message: "endNs < startNs" });
export type PausedRange = z.infer<typeof PausedRange>;
export const SckStopped = z.object({
  t: z.literal("stopped"),
  id,
  durationMs: z.number().int().nonnegative(),
  /** Absolute paths; empty when discarded or nothing was captured. */
  paths: z.object({
    screen: z.string().min(1).optional(),
    system: z.string().min(1).optional(),
    mic: z.string().min(1).optional(),
  }),
  pausedRanges: z.array(PausedRange),
  discarded: z.boolean(),
});
export const HelperErrorMessage = z.object({
  t: z.literal("error"),
  id,
  code: z.string().min(1),
  message: z.string(),
});

export const SckEvent = z.discriminatedUnion("t", [
  SckPong,
  SckReady,
  SckStarted,
  SckStats,
  SckInterrupted,
  SckStopped,
  HelperErrorMessage,
]);
export type SckEvent = z.infer<typeof SckEvent>;

// ---- reelform-cursor-monitor ----------------------------------------------

export const CursorCommand = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping"), id }),
  z.object({ t: z.literal("start"), id }),
  z.object({ t: z.literal("pause"), id }),
  z.object({ t: z.literal("resume"), id }),
  z.object({ t: z.literal("stop"), id }),
  z.object({ t: z.literal("exportCursors"), id, dir: z.string().min(1) }),
]);
export type CursorCommand = z.infer<typeof CursorCommand>;

export const CursorKind = z.enum(CURSOR_KINDS);
export type CursorKind = z.infer<typeof CursorKind>;

export const CursorAsset = z.object({
  type: CursorKind,
  file: z.string().regex(/^[a-z-]+@2x\.png$/),
  /** Hotspot in @1x points. */
  hotspot: z.tuple([finite, finite]),
  /** Size in @1x points (PNG is 2×). */
  size: z.tuple([finite.positive(), finite.positive()]),
});
export type CursorAsset = z.infer<typeof CursorAsset>;

/** Coordinates: CoreGraphics global points, origin top-left of the primary display. */
export const CursorEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pong"), id, version: z.string(), caps }),
  z.object({ t: z.literal("ready") }),
  z.object({
    t: z.literal("started"),
    id,
    hostTimeNs: hostNs,
    sampleHz: z.number().int().positive(),
    /** `eventTap` gives clicks + keys; `globalMonitor` (no permission) clicks only. */
    clickSource: z.enum(["eventTap", "globalMonitor"]),
    keys: z.boolean(),
  }),
  z.object({ t: z.literal("move"), tNs: hostNs, x: finite, y: finite, cursor: CursorKind }),
  z.object({
    t: z.literal("click"),
    tNs: hostNs,
    x: finite,
    y: finite,
    button: z.enum(["left", "middle", "right"]),
    phase: z.enum(["down", "up"]),
  }),
  z.object({
    t: z.literal("key"),
    tNs: hostNs,
    keyCode: z.number().int().min(0).max(0xffff),
    modifiers: z.number().int().min(0).max(63),
  }),
  z.object({ t: z.literal("scroll"), tNs: hostNs, dx: finite, dy: finite }),
  z.object({
    t: z.literal("cursorsExported"),
    id,
    dir: z.string().min(1),
    files: z.array(CursorAsset),
  }),
  z.object({ t: z.literal("stopped"), id, samples: z.number().int().nonnegative() }),
  HelperErrorMessage,
]);
export type CursorEvent = z.infer<typeof CursorEvent>;

// ---- one-shot CLI outputs --------------------------------------------------

const permissionStatus = z.enum(["granted", "denied", "notDetermined", "restricted"]);
export type PermissionStatus = z.infer<typeof permissionStatus>;

/** `reelform-sck --permissions | --request-permissions`. */
export const SckPermissions = z.object({
  t: z.literal("permissions"),
  screen: permissionStatus,
  microphone: permissionStatus,
});
export type SckPermissions = z.infer<typeof SckPermissions>;

/** `reelform-cursor-monitor --permissions | --request-permissions`. */
export const CursorPermissions = z.object({
  t: z.literal("permissions"),
  inputMonitoring: permissionStatus,
  accessibility: permissionStatus,
});
export type CursorPermissions = z.infer<typeof CursorPermissions>;

/** `pack.json` written next to exported cursor PNGs (§9.2). */
export const CursorPackManifest = z.object({
  name: z.string(),
  scale: z.literal(2),
  cursors: z.record(
    CursorKind,
    z.object({
      file: z.string(),
      hotspot: z.tuple([finite, finite]),
      size: z.tuple([finite.positive(), finite.positive()]),
    }),
  ),
});
export type CursorPackManifest = z.infer<typeof CursorPackManifest>;

// ---- encode / decode -------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalidJson" | "invalidMessage"; message: string; line: string };

function parseWith<S extends z.ZodTypeAny>(schema: S, line: string): ParseResult<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (e) {
    return { ok: false, error: "invalidJson", message: String(e), line };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: "invalidMessage", message: result.error.message, line };
  }
  return { ok: true, value: result.data };
}

export const parseSckEvent = (line: string): ParseResult<SckEvent> => parseWith(SckEvent, line);
export const parseCursorEvent = (line: string): ParseResult<CursorEvent> =>
  parseWith(CursorEvent, line);
export const parseSckCommand = (line: string): ParseResult<SckCommand> =>
  parseWith(SckCommand, line);
export const parseCursorCommand = (line: string): ParseResult<CursorCommand> =>
  parseWith(CursorCommand, line);

/** Validates and serializes a command as one protocol line (with trailing `\n`). Throws on invalid input. */
export function encodeSckCommand(command: SckCommand): string {
  return `${JSON.stringify(SckCommand.parse(command))}\n`;
}

export function encodeCursorCommand(command: CursorCommand): string {
  return `${JSON.stringify(CursorCommand.parse(command))}\n`;
}

// ---- stdout framing ----------------------------------------------------------

export interface LineDecoder {
  /** Feed a stdout chunk; returns every complete, non-empty line. */
  push(chunk: string): string[];
  /** End of stream: returns the trailing unterminated line, if any. */
  end(): string[];
  /** Lines dropped for exceeding `maxLineLength`. */
  readonly overflowCount: number;
}

/**
 * Splits a helper's stdout into lines regardless of chunk boundaries. Accepts
 * `\n` and `\r\n`. A line longer than `maxLineLength` is discarded (a helper
 * never legitimately emits one) so a misbehaving binary cannot grow memory.
 * Feed it strings from a UTF-8 `StringDecoder` so multi-byte characters split
 * across chunks stay intact.
 */
export function createLineDecoder(maxLineLength = 1 << 20): LineDecoder {
  let buffer = "";
  let discarding = false;
  let overflowCount = 0;

  const clean = (line: string): string | null => {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    return trimmed.trim().length === 0 ? null : trimmed;
  };

  return {
    push(chunk) {
      const lines: string[] = [];
      let start = 0;
      for (let nl = chunk.indexOf("\n", start); nl !== -1; nl = chunk.indexOf("\n", start)) {
        const piece = chunk.slice(start, nl);
        start = nl + 1;
        if (discarding) {
          discarding = false;
          buffer = "";
          continue;
        }
        const full = buffer + piece;
        buffer = "";
        if (full.length > maxLineLength) {
          overflowCount++;
          continue;
        }
        const line = clean(full);
        if (line !== null) lines.push(line);
      }
      if (!discarding) {
        buffer += chunk.slice(start);
        if (buffer.length > maxLineLength) {
          overflowCount++;
          discarding = true;
          buffer = "";
        }
      }
      return lines;
    },
    end() {
      const rest = discarding ? null : clean(buffer);
      buffer = "";
      discarding = false;
      return rest === null ? [] : [rest];
    },
    get overflowCount() {
      return overflowCount;
    },
  };
}
