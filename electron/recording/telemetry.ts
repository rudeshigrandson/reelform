import { z } from "zod";
import type { Rect } from "../capture/types";

/**
 * Cursor / click / key / scroll telemetry (ENGINEERING_SPEC §4 telemetry file,
 * §5.6 alignment, §9.7 + §13 privacy).
 *
 * The collector stamps input-hook events with an injected host clock (the same
 * clock the capture backend reports `firstFramePtsNs` in), stores raw ns, and
 * rebases at finalize: `tMs = (hostNs - firstFramePtsNs) / 1e6`, minus paused
 * time. Key events are stored only while recording (codes + modifiers, never
 * characters); plain typing is discarded at finalize unless opted in.
 */

export const MOD_SHIFT = 1;
export const MOD_CTRL = 2;
export const MOD_ALT = 4;
export const MOD_META = 8;

export const CursorType = z.enum([
  "arrow",
  "ibeam",
  "hand",
  "grab",
  "resize-ew",
  "resize-ns",
  "resize-nesw",
  "resize-nwse",
]);
export type CursorType = z.infer<typeof CursorType>;

export const TelemetryFile = z.object({
  version: z.literal(1),
  sampleHz: z.number().positive(),
  origin: z.enum(["display", "window", "region"]),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  scaleFactor: z.number().positive(),
  points: z.array(z.tuple([z.number(), z.number(), z.number(), CursorType])),
  clicks: z.array(
    z.tuple([z.number(), z.number(), z.number(), z.number(), z.enum(["down", "up"])]),
  ),
  keys: z.array(z.tuple([z.number(), z.number(), z.number()])),
  scrolls: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
export type TelemetryFile = z.infer<typeof TelemetryFile>;

/** uiohook-like global input hook. Coordinates share the space of `bounds`. */
export interface InputHookEvents {
  mousemove: { x: number; y: number };
  mousedown: { x: number; y: number; button: number };
  mouseup: { x: number; y: number; button: number };
  keydown: {
    keycode: number;
    shiftKey?: boolean | undefined;
    ctrlKey?: boolean | undefined;
    altKey?: boolean | undefined;
    metaKey?: boolean | undefined;
  };
  wheel: { dx: number; dy: number };
}

export interface InputHook {
  on<K extends keyof InputHookEvents>(
    type: K,
    listener: (e: InputHookEvents[K]) => void,
  ): () => void;
}

/** `tMs = (hostNs - firstFramePtsNs) / 1e6` (§5.6). */
export function rebaseTMs(hostNs: bigint, firstFramePtsNs: bigint): number {
  return Number(hostNs - firstFramePtsNs) / 1e6;
}

export interface NsRange {
  startNs: bigint;
  endNs: bigint;
}

/**
 * Rebase onto the video timeline, which excludes paused time (helpers subtract
 * pauses from PTS). Returns `null` for events before the first frame or inside
 * a pause.
 */
export function rebaseWithPauses(
  hostNs: bigint,
  firstFramePtsNs: bigint,
  pauses: readonly NsRange[],
): number | null {
  if (hostNs < firstFramePtsNs) return null;
  let pausedNs = 0n;
  for (const p of pauses) {
    const s = p.startNs > firstFramePtsNs ? p.startNs : firstFramePtsNs;
    // Open at the start: an event stamped at the pause instant was recorded before it.
    if (hostNs > s && hostNs < p.endNs) return null;
    if (p.endNs <= hostNs && p.endNs > s) pausedNs += p.endNs - s;
  }
  return rebaseTMs(hostNs - pausedNs, firstFramePtsNs);
}

/**
 * uiohook key codes (PC set-1 scan codes) that produce text without a
 * ctrl/alt/meta modifier: digits, letters, punctuation, space, numpad.
 */
const TYPING_CODES = new Set<number>([
  ...range(0x02, 0x0d), // 1..0 - =
  ...range(0x10, 0x1b), // Q..P [ ]
  ...range(0x1e, 0x29), // A..L ; ' `
  ...range(0x2b, 0x35), // \ Z..M , . /
  0x39, // space
  0x37, // numpad *
  0x4a, // numpad -
  0x4e, // numpad +
  0x53, // numpad .
  ...range(0x47, 0x49),
  ...range(0x4b, 0x4d),
  ...range(0x4f, 0x52),
  0x0e35, // numpad /
]);

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function isUiohookTypingKey(keycode: number): boolean {
  return TYPING_CODES.has(keycode);
}

/** Plain typing = a text-producing key without ctrl/alt/meta (shift alone still types). */
export function isPlainTyping(
  keycode: number,
  modifiers: number,
  isTypingKey: (code: number) => boolean,
): boolean {
  return (modifiers & (MOD_CTRL | MOD_ALT | MOD_META)) === 0 && isTypingKey(keycode);
}

export function modifiersOf(e: InputHookEvents["keydown"]): number {
  return (
    (e.shiftKey ? MOD_SHIFT : 0) |
    (e.ctrlKey ? MOD_CTRL : 0) |
    (e.altKey ? MOD_ALT : 0) |
    (e.metaKey ? MOD_META : 0)
  );
}

export interface CollectorOptions {
  hook: InputHook;
  nowNs: () => bigint;
  origin: TelemetryFile["origin"];
  bounds: Rect;
  scaleFactor: number;
  sampleHz?: number | undefined;
  cursorType?: (() => CursorType) | undefined;
  isTypingKey?: ((keycode: number) => boolean) | undefined;
}

export interface FinalizeOptions {
  /** `null` when the backend never reported a first frame; falls back to collector start. */
  firstFramePtsNs: bigint | null;
  /** §9.7 "Record typed text badges" (off by default). */
  keepTypedText: boolean;
}

type RawPoint = [bigint, number, number, CursorType];
type CollectorState = "idle" | "recording" | "paused" | "stopped";

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const DEFAULT_SAMPLE_HZ = 120;

export class TelemetryCollector {
  private state: CollectorState = "idle";
  private readonly unsubs: (() => void)[] = [];
  private readonly points: RawPoint[] = [];
  private readonly clicks: [bigint, number, number, number, "down" | "up"][] = [];
  private readonly keys: [bigint, number, number][] = [];
  private readonly scrolls: [bigint, number, number][] = [];
  private readonly pauses: NsRange[] = [];
  private pauseStart: bigint | null = null;
  private lastKept: RawPoint | null = null;
  private pending: RawPoint | null = null;
  private startNs: bigint | null = null;
  private readonly intervalNs: bigint;
  private readonly sampleHz: number;

  constructor(private readonly opts: CollectorOptions) {
    const hz = opts.sampleHz ?? DEFAULT_SAMPLE_HZ;
    this.sampleHz = Number.isFinite(hz) && hz > 0 ? hz : DEFAULT_SAMPLE_HZ;
    this.intervalNs = BigInt(Math.round(1e9 / this.sampleHz));
  }

  get currentState(): CollectorState {
    return this.state;
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "recording";
    this.startNs = this.opts.nowNs();
    const h = this.opts.hook;
    this.unsubs.push(
      h.on("mousemove", (e) => this.onMove(e.x, e.y)),
      h.on("mousedown", (e) => this.onButton(e.x, e.y, e.button, "down")),
      h.on("mouseup", (e) => this.onButton(e.x, e.y, e.button, "up")),
      h.on("keydown", (e) => {
        if (this.state !== "recording") return;
        this.keys.push([this.opts.nowNs(), e.keycode, modifiersOf(e)]);
      }),
      h.on("wheel", (e) => {
        if (this.state !== "recording") return;
        this.scrolls.push([this.opts.nowNs(), e.dx, e.dy]);
      }),
    );
  }

  pause(): void {
    if (this.state !== "recording") return;
    this.flushPending();
    this.state = "paused";
    this.pauseStart = this.opts.nowNs();
  }

  resume(): void {
    if (this.state !== "paused") return;
    const now = this.opts.nowNs();
    if (this.pauseStart !== null && now > this.pauseStart)
      this.pauses.push({ startNs: this.pauseStart, endNs: now });
    this.pauseStart = null;
    this.state = "recording";
  }

  /** Unsubscribe from the hook; nothing more is recorded. */
  stop(): void {
    if (this.state === "stopped") return;
    if (this.state === "paused") this.resume();
    this.flushPending();
    this.state = "stopped";
    for (const u of this.unsubs.splice(0)) u();
  }

  finalize(opts: FinalizeOptions): TelemetryFile {
    this.stop();
    const first = opts.firstFramePtsNs ?? this.startNs ?? 0n;
    const isTyping = this.opts.isTypingKey ?? isUiohookTypingKey;
    const t = (ns: bigint): number | null => {
      const ms = rebaseWithPauses(ns, first, this.pauses);
      return ms === null ? null : round(ms, 3);
    };
    const nx = (x: number): number =>
      round((x - this.opts.bounds.x) / (this.opts.bounds.width || 1), 5);
    const ny = (y: number): number =>
      round((y - this.opts.bounds.y) / (this.opts.bounds.height || 1), 5);

    const points: TelemetryFile["points"] = [];
    for (const [ns, x, y, c] of this.points) {
      const ms = t(ns);
      if (ms !== null) points.push([ms, nx(x), ny(y), c]);
    }
    const clicks: TelemetryFile["clicks"] = [];
    for (const [ns, x, y, b, phase] of this.clicks) {
      const ms = t(ns);
      if (ms !== null) clicks.push([ms, nx(x), ny(y), b, phase]);
    }
    const keys: TelemetryFile["keys"] = [];
    for (const [ns, code, mods] of this.keys) {
      if (!opts.keepTypedText && isPlainTyping(code, mods, isTyping)) continue;
      const ms = t(ns);
      if (ms !== null) keys.push([ms, code, mods]);
    }
    const scrolls: TelemetryFile["scrolls"] = [];
    for (const [ns, dx, dy] of this.scrolls) {
      const ms = t(ns);
      if (ms !== null) scrolls.push([ms, dx, dy]);
    }
    return {
      version: 1,
      sampleHz: this.sampleHz,
      origin: this.opts.origin,
      bounds: { ...this.opts.bounds },
      scaleFactor: this.opts.scaleFactor,
      points,
      clicks,
      keys,
      scrolls,
    };
  }

  private cursor(): CursorType {
    return this.opts.cursorType?.() ?? "arrow";
  }

  private onMove(x: number, y: number): void {
    if (this.state !== "recording") return;
    const p: RawPoint = [this.opts.nowNs(), x, y, this.cursor()];
    if (this.lastKept === null || p[0] - this.lastKept[0] >= this.intervalNs) {
      // Keep the position the cursor rested at (≥ one interval) before this move;
      // otherwise the newer sample supersedes it.
      if (this.pending && p[0] - this.pending[0] >= this.intervalNs) this.flushPending();
      this.keep(p);
    } else {
      this.pending = p;
    }
  }

  private onButton(x: number, y: number, button: number, phase: "down" | "up"): void {
    if (this.state !== "recording") return;
    const ns = this.opts.nowNs();
    this.flushPending();
    this.clicks.push([ns, x, y, button, phase]);
  }

  private keep(p: RawPoint): void {
    this.points.push(p);
    this.lastKept = p;
    this.pending = null;
  }

  private flushPending(): void {
    if (this.pending) this.keep(this.pending);
  }
}

/** Serialize + gzip a telemetry file (gzip injected; e.g. `zlib.gzip`). */
export async function encodeTelemetry(
  file: TelemetryFile,
  gzip: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(file)));
}
