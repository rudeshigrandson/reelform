import type { ProjectV1 } from "../model/v1";
import type { EditorData } from "../store";
import { isDocumentChange, touchModified } from "./mapping";

/**
 * Dirty tracking + autosave (ENGINEERING_SPEC §4 "Save semantics"): autosave
 * every 30s while dirty and on window blur; a manual save always writes and
 * clears dirty. Timer, clock and the save port are injected so the controller
 * is deterministic under test.
 */

export const AUTOSAVE_INTERVAL_MS = 30_000;

export type SaveReason = "interval" | "blur" | "manual";

/** Renderer → main bridge (e.g. `project:save`). Atomic write is main's job. */
export interface AutosavePort {
  save(doc: ProjectV1, reason: SaveReason): Promise<void>;
}

export interface IntervalTimer {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Real timers, for production wiring. */
export const systemTimer: IntervalTimer = {
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface AutosaveStatus {
  readonly dirty: boolean;
  readonly saving: boolean;
  /** `modifiedAt` of the last successful save. */
  readonly lastSavedAt: string | null;
  /** Error of the most recent attempt; cleared by the next success. */
  readonly lastError: unknown;
}

export interface AutosaveOptions {
  port: AutosavePort;
  /** Current document (usually `toProjectDocument(store state, meta)`). */
  getDocument: () => ProjectV1;
  /** ISO-8601 timestamp for `modifiedAt`. */
  now: () => string;
  timer?: IntervalTimer | undefined;
  intervalMs?: number | undefined;
  onStatus?: ((status: AutosaveStatus) => void) | undefined;
}

export interface AutosaveController {
  markDirty(): void;
  /** Mark the current state as persisted (e.g. right after load). */
  markClean(): void;
  isDirty(): boolean;
  getStatus(): AutosaveStatus;
  /** Window blur: save if dirty. Resolves true when a save succeeded. */
  handleBlur(): Promise<boolean>;
  /** Manual save: waits for any in-flight save, then always writes. */
  save(): Promise<boolean>;
  dispose(): void;
}

export function createAutosaveController(options: AutosaveOptions): AutosaveController {
  const timer = options.timer ?? systemTimer;
  const intervalMs = options.intervalMs ?? AUTOSAVE_INTERVAL_MS;

  let revision = 0;
  let savedRevision = 0;
  let inFlight: Promise<boolean> | null = null;
  let disposed = false;
  let lastSavedAt: string | null = null;
  let lastError: unknown = null;

  const isDirty = () => revision !== savedRevision;
  const getStatus = (): AutosaveStatus => ({
    dirty: isDirty(),
    saving: inFlight !== null,
    lastSavedAt,
    lastError,
  });
  const emit = () => options.onStatus?.(getStatus());

  async function write(reason: SaveReason): Promise<boolean> {
    const rev = revision;
    try {
      const doc = touchModified(options.getDocument(), options.now());
      await options.port.save(doc, reason);
      // Edits made while the save was in flight keep the project dirty.
      if (rev > savedRevision) savedRevision = rev;
      lastSavedAt = doc.modifiedAt;
      lastError = null;
      return true;
    } catch (err) {
      lastError = err;
      return false;
    }
  }

  function run(reason: SaveReason): Promise<boolean> {
    // `.finally` always runs asynchronously, so `inFlight` is assigned first.
    const p = write(reason).finally(() => {
      inFlight = null;
      emit();
    });
    inFlight = p;
    emit();
    return p;
  }

  function autosave(reason: SaveReason): Promise<boolean> {
    if (disposed || inFlight !== null || !isDirty()) return Promise.resolve(false);
    return run(reason);
  }

  const handle = timer.setInterval(() => {
    void autosave("interval");
  }, intervalMs);

  return {
    markDirty() {
      if (disposed) return;
      const was = isDirty();
      revision += 1;
      if (!was) emit();
    },
    markClean() {
      const was = isDirty();
      savedRevision = revision;
      if (was) emit();
    },
    isDirty,
    getStatus,
    handleBlur: () => autosave("blur"),
    async save() {
      if (disposed) return false;
      while (inFlight !== null) await inFlight;
      return run("manual");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timer.clearInterval(handle);
    },
  };
}

/** zustand's `store.subscribe` shape. */
export type StoreSubscribe<S> = (listener: (state: S, prev: S) => void) => () => void;

/** Mark the controller dirty whenever a document field of the store changes. */
export function bindDirtyTracking(
  subscribe: StoreSubscribe<EditorData>,
  controller: Pick<AutosaveController, "markDirty">,
): () => void {
  return subscribe((next, prev) => {
    if (isDocumentChange(prev, next)) controller.markDirty();
  });
}

export interface BlurTarget {
  addEventListener(type: "blur", listener: () => void): void;
  removeEventListener(type: "blur", listener: () => void): void;
}

/** Autosave on window blur. Returns an unbind function. */
export function bindBlurAutosave(
  target: BlurTarget,
  controller: Pick<AutosaveController, "handleBlur">,
): () => void {
  const listener = () => {
    void controller.handleBlur();
  };
  target.addEventListener("blur", listener);
  return () => target.removeEventListener("blur", listener);
}
