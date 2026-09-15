import { type ExitInfo, type HelperDeps, HelperProcess } from "../../capture/helperProcess";
import type { VerifyResult } from "../../capture/manifest";
import type { CursorType, InputHook, InputHookEvents } from "../../recording/telemetry";
import { macKeyCodeToUiohook } from "./macKeyCodes";
import { CursorEvent, MODIFIER } from "./protocol";

/**
 * `InputHook` (electron/recording/telemetry.ts) over the `reelform-cursor-monitor`
 * helper (ENGINEERING_SPEC §5.3 cursor, §5.5 protocol).
 *
 * The helper runs only while someone listens: the first `on()` spawns it
 * (verify → ping → `start`), the last unsubscribe sends `stop` and kills it. The
 * `TelemetryCollector` subscribes at capture start and unsubscribes at stop, so
 * keys are only ever observed while recording (§13).
 *
 * Mapping to uiohook-style events:
 *   move   → `mousemove {x,y}` (CoreGraphics global points = Electron screen DIP on macOS)
 *   click  → `mousedown|mouseup {x,y,button}` with DOM button indices (0 left, 1 middle, 2 right)
 *   key    → `keydown {keycode}` in uiohook code space + modifier booleans; unmapped keys dropped
 *   scroll → `wheel {dx,dy}`
 * The latest `move.cursor` is exposed via {@link CursorMonitorBridge.cursorType}
 * for the collector's `cursorType` option. Timestamps are re-stamped by the
 * collector's host clock; stdio latency is well under a frame.
 */

export const CURSOR_MONITOR_HELPER_NAME = "reelform-cursor-monitor";
/** The helper stops its timer and exits immediately; this only bounds a hung helper. */
export const CURSOR_STOP_TIMEOUT_MS = 3_000;

export type CursorMonitorStatus =
  | { state: "idle" }
  | { state: "starting" }
  | {
      state: "running";
      sampleHz: number;
      /** `globalMonitor` = no Input Monitoring permission: clicks + scroll, no keys. */
      clickSource: "eventTap" | "globalMonitor";
      keys: boolean;
    }
  | { state: "unavailable"; reason: string }
  | { state: "crashed"; reason: string };

/** The part of {@link HelperProcess} the bridge uses (tests may substitute it). */
export interface CursorHelper {
  readonly running: boolean;
  start(): Promise<unknown>;
  request(
    msg: { t: string; [key: string]: unknown },
    timeoutMs?: number,
  ): Promise<{ t: string; [key: string]: unknown }>;
  onEvent(listener: (msg: { t: string; [key: string]: unknown }) => void): () => void;
  onExit(listener: (info: ExitInfo) => void): () => void;
  kill(): Promise<void>;
}

export interface CursorMonitorBridgeOptions {
  /** sha256 manifest check (§5.5); resolves the binary path to spawn. */
  resolveBinary(): Promise<VerifyResult>;
  /** Injected spawn / killTree / timers. Ignored when `createHelper` is given. */
  helperDeps?: HelperDeps | undefined;
  /** Override helper construction (defaults to `new HelperProcess({ command }, helperDeps)`). */
  createHelper?: ((command: string) => CursorHelper) | undefined;
  /** Key code translation; default mac virtual key → uiohook. `null` drops the key. */
  mapKeyCode?: ((helperKeyCode: number) => number | null) | undefined;
  /** Diagnostics sink (invalid lines, helper errors, listener exceptions). */
  log?: ((message: string) => void) | undefined;
}

type Listener = (e: never) => void;
type AnyMessage = { t: string; [key: string]: unknown };

const DOM_BUTTON = { left: 0, middle: 1, right: 2 } as const;

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class CursorMonitorBridge implements InputHook {
  private readonly listeners = new Map<keyof InputHookEvents, Set<Listener>>();
  private readonly statusListeners = new Set<(s: CursorMonitorStatus) => void>();
  private listenerCount = 0;
  private helper: CursorHelper | null = null;
  private generation = 0;
  private cursor: CursorType = "arrow";
  private status: CursorMonitorStatus = { state: "idle" };
  private stopping: Promise<void> = Promise.resolve();

  constructor(private readonly opts: CursorMonitorBridgeOptions) {}

  on<K extends keyof InputHookEvents>(
    type: K,
    listener: (e: InputHookEvents[K]) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    // A function subscribed twice under one type still counts once, like a Set.
    const wrapped = listener as Listener;
    if (!set.has(wrapped)) {
      set.add(wrapped);
      this.listenerCount++;
      if (this.listenerCount === 1) void this.activate();
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (!set.delete(wrapped)) return;
      this.listenerCount--;
      if (this.listenerCount === 0) void this.deactivate();
    };
  }

  /** Latest cursor type reported by the helper (for `TelemetryCollector` `cursorType`). */
  cursorType(): CursorType {
    return this.cursor;
  }

  getStatus(): CursorMonitorStatus {
    return this.status;
  }

  onStatus(listener: (s: CursorMonitorStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Resolves once any in-flight shutdown has finished (tests / app quit). */
  whenStopped(): Promise<void> {
    return this.stopping;
  }

  /** Drop every listener and stop the helper. */
  async dispose(): Promise<void> {
    for (const set of this.listeners.values()) set.clear();
    const had = this.listenerCount > 0;
    this.listenerCount = 0;
    if (had) await this.deactivate();
    await this.stopping;
  }

  // ---- lifecycle -----------------------------------------------------------

  private setStatus(s: CursorMonitorStatus): void {
    this.status = s;
    for (const l of [...this.statusListeners]) {
      try {
        l(s);
      } catch (err) {
        this.log(`status listener threw: ${errMessage(err)}`);
      }
    }
  }

  private log(message: string): void {
    this.opts.log?.(`[cursor-monitor] ${message}`);
  }

  private async activate(): Promise<void> {
    const gen = ++this.generation;
    // Let a previous helper finish exiting before spawning its replacement.
    await this.stopping;
    if (gen !== this.generation) return;
    this.cursor = "arrow";
    this.setStatus({ state: "starting" });

    let verified: VerifyResult;
    try {
      verified = await this.opts.resolveBinary();
    } catch (err) {
      verified = { ok: false, reason: errMessage(err) };
    }
    if (gen !== this.generation) return;
    if (!verified.ok) {
      this.setStatus({ state: "unavailable", reason: verified.reason });
      return;
    }

    let helper: CursorHelper;
    try {
      helper = this.createHelper(verified.path);
    } catch (err) {
      this.setStatus({ state: "unavailable", reason: errMessage(err) });
      return;
    }
    this.helper = helper;
    helper.onEvent((msg) => {
      if (this.helper === helper) this.handleMessage(msg);
    });
    helper.onExit((info) => {
      if (this.helper !== helper || info.expected) return;
      this.helper = null;
      const tail = info.stderrTail[info.stderrTail.length - 1];
      const reason =
        info.cause ??
        tail ??
        `helper exited (code ${info.code ?? "null"}, signal ${info.signal ?? "null"})`;
      this.log(`crashed: ${reason}`);
      this.setStatus({ state: "crashed", reason });
    });

    try {
      await helper.start();
      if (gen !== this.generation) return;
      const res = await helper.request({ t: "start" });
      if (gen !== this.generation) return;
      const parsed = CursorEvent.safeParse(res);
      if (!parsed.success || parsed.data.t !== "started") {
        throw new Error(`unexpected reply "${res.t}" to start`);
      }
      this.setStatus({
        state: "running",
        sampleHz: parsed.data.sampleHz,
        clickSource: parsed.data.clickSource,
        keys: parsed.data.keys,
      });
    } catch (err) {
      if (gen !== this.generation || this.helper !== helper) return;
      this.helper = null;
      const code = err instanceof Error && "code" in err ? `${String(err.code)}: ` : "";
      this.setStatus({ state: "unavailable", reason: `${code}${errMessage(err)}` });
      await helper.kill();
    }
  }

  private deactivate(): Promise<void> {
    this.generation++;
    const helper = this.helper;
    this.helper = null;
    if (this.status.state !== "unavailable" && this.status.state !== "crashed") {
      this.setStatus({ state: "idle" });
    }
    if (!helper) return this.stopping;
    const previous = this.stopping;
    this.stopping = (async () => {
      await previous;
      try {
        if (helper.running) await helper.request({ t: "stop" }, CURSOR_STOP_TIMEOUT_MS);
      } catch {
        // Already gone or hung: killing below is enough.
      } finally {
        await helper.kill();
      }
    })();
    return this.stopping;
  }

  private createHelper(command: string): CursorHelper {
    if (this.opts.createHelper) return this.opts.createHelper(command);
    if (!this.opts.helperDeps) throw new Error("cursor monitor: no helperDeps or createHelper");
    return new HelperProcess({ command }, this.opts.helperDeps);
  }

  // ---- events --------------------------------------------------------------

  private emit<K extends keyof InputHookEvents>(type: K, event: InputHookEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of [...set]) {
      try {
        (l as (e: InputHookEvents[K]) => void)(event);
      } catch (err) {
        this.log(`${type} listener threw: ${errMessage(err)}`);
      }
    }
  }

  private handleMessage(msg: AnyMessage): void {
    const parsed = CursorEvent.safeParse(msg);
    if (!parsed.success) {
      this.log(`ignored invalid message "${String(msg.t)}"`);
      return;
    }
    const ev = parsed.data;
    switch (ev.t) {
      case "move":
        this.cursor = ev.cursor;
        this.emit("mousemove", { x: ev.x, y: ev.y });
        return;
      case "click":
        this.emit(ev.phase === "down" ? "mousedown" : "mouseup", {
          x: ev.x,
          y: ev.y,
          button: DOM_BUTTON[ev.button],
        });
        return;
      case "key": {
        const keycode = (this.opts.mapKeyCode ?? macKeyCodeToUiohook)(ev.keyCode);
        if (keycode === null) return;
        this.emit("keydown", {
          keycode,
          shiftKey: (ev.modifiers & MODIFIER.shift) !== 0,
          ctrlKey: (ev.modifiers & MODIFIER.control) !== 0,
          altKey: (ev.modifiers & MODIFIER.option) !== 0,
          metaKey: (ev.modifiers & MODIFIER.command) !== 0,
        });
        return;
      }
      case "scroll":
        this.emit("wheel", { dx: ev.dx, dy: ev.dy });
        return;
      case "error":
        this.log(`helper error ${ev.code}: ${ev.message}`);
        return;
      default:
        return;
    }
  }
}

export function createCursorMonitorBridge(opts: CursorMonitorBridgeOptions): CursorMonitorBridge {
  return new CursorMonitorBridge(opts);
}
