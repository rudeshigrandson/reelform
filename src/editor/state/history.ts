import { type Draft, Immer } from "immer";
import type { Command } from "./command";

/**
 * Command history (ENGINEERING_SPEC §6.2 / §7): capped undo stack, redo stack,
 * slider-drag coalescing and a save-point dirty flag. Per project window, never
 * persisted. Deterministic: time comes from the injected `now`.
 */

export const DEFAULT_HISTORY_CAP = 100;
export const DEFAULT_COALESCE_MS = 300;

export interface HistoryOptions<S> {
  getState: () => S;
  /** Receives the full next state (zustand: `(s) => store.setState(s, true)`). */
  setState: (next: S) => void;
  /** Injected clock in ms (e.g. `performance.now`). */
  now: () => number;
  cap?: number | undefined;
  coalesceMs?: number | undefined;
}

export interface HistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  /** "Undo: Move zoom", or null when there is nothing to undo. */
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
  /** `now()` of the last push/undo/redo, null until the first one. */
  modifiedAt: number | null;
}

export interface History<S> {
  /** Executes and records. Throws (state untouched, nothing recorded) if `do` throws. */
  push(cmd: Command<S>): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | null;
  redoLabel(): string | null;
  isDirty(): boolean;
  /** The current state becomes the clean save point. */
  markSaved(): void;
  /** Drops both stacks; the current state becomes the save point. */
  clear(): void;
  /** Stable between changes (for `useSyncExternalStore`). */
  getSnapshot(): HistorySnapshot;
  subscribe(listener: () => void): () => void;
}

/**
 * Flat record: a coalesced entry points straight at the FIRST command's undo and
 * the LATEST command's do, so a long drag never builds nested closures (which
 * retained every intermediate command and overflowed the stack on undo).
 */
interface Entry<S> {
  label: string;
  coalesceKey: string | undefined;
  doCmd: Command<S>;
  undoCmd: Command<S>;
  /** Revision of the state after this entry is applied. */
  rev: number;
}

// Store state is shared with non-history code (e.g. `update`), so never freeze it.
const immer = new Immer({ autoFreeze: false });

export function createHistory<S extends object>(options: HistoryOptions<S>): History<S> {
  const { getState, setState, now } = options;
  const rawCap = options.cap ?? DEFAULT_HISTORY_CAP;
  const cap = Number.isFinite(rawCap) ? Math.max(1, Math.floor(rawCap)) : DEFAULT_HISTORY_CAP;
  const rawCoalesce = options.coalesceMs ?? DEFAULT_COALESCE_MS;
  const coalesceMs = Number.isFinite(rawCoalesce) ? Math.max(0, rawCoalesce) : DEFAULT_COALESCE_MS;

  const undoStack: Entry<S>[] = [];
  let redoStack: Entry<S>[] = [];
  let nextRev = 1;
  /** Revision of the state below the oldest undo entry. */
  let baseRev = 0;
  let savedRev = 0;
  let modifiedAt: number | null = null;
  /** Time of the last push that may still be coalesced into; null breaks the chain. */
  let lastPushAt: number | null = null;
  const listeners = new Set<() => void>();
  let snapshot: HistorySnapshot | null = null;

  const currentRev = (): number => undoStack[undoStack.length - 1]?.rev ?? baseRev;

  /** Computes the next state without committing it (throws leave everything untouched). */
  const compute = (run: (draft: Draft<S>) => void): S =>
    immer.produce(getState(), (draft: Draft<S>) => {
      run(draft);
    });

  const emit = (): void => {
    snapshot = null;
    for (const l of [...listeners]) l();
  };

  const label = (prefix: string, entry: Entry<S> | undefined): string | null =>
    entry ? `${prefix}: ${entry.label}` : null;

  return {
    push(cmd) {
      const t = now();
      const next = compute((d) => cmd.do(d));
      const top = undoStack[undoStack.length - 1];
      const coalesce =
        top !== undefined &&
        cmd.coalesceKey !== undefined &&
        top.coalesceKey === cmd.coalesceKey &&
        lastPushAt !== null &&
        t - lastPushAt >= 0 &&
        t - lastPushAt <= coalesceMs;
      if (coalesce) {
        undoStack[undoStack.length - 1] = {
          label: cmd.label,
          coalesceKey: cmd.coalesceKey,
          doCmd: cmd,
          undoCmd: top.undoCmd,
          rev: nextRev++,
        };
      } else {
        undoStack.push({
          label: cmd.label,
          coalesceKey: cmd.coalesceKey,
          doCmd: cmd,
          undoCmd: cmd,
          rev: nextRev++,
        });
        while (undoStack.length > cap) {
          const evicted = undoStack.shift();
          if (evicted) baseRev = evicted.rev;
        }
      }
      redoStack = [];
      lastPushAt = t;
      modifiedAt = t;
      // Bookkeeping first, so store subscribers reading history see the new stacks.
      setState(next);
      emit();
    },
    undo() {
      const entry = undoStack[undoStack.length - 1];
      if (!entry) return false;
      const next = compute((d) => entry.undoCmd.undo(d));
      undoStack.pop();
      redoStack.push(entry);
      lastPushAt = null;
      modifiedAt = now();
      setState(next);
      emit();
      return true;
    },
    redo() {
      const entry = redoStack[redoStack.length - 1];
      if (!entry) return false;
      const next = compute((d) => entry.doCmd.do(d));
      redoStack.pop();
      undoStack.push(entry);
      lastPushAt = null;
      modifiedAt = now();
      setState(next);
      emit();
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => label("Undo", undoStack[undoStack.length - 1]),
    redoLabel: () => label("Redo", redoStack[redoStack.length - 1]),
    isDirty: () => currentRev() !== savedRev,
    markSaved() {
      savedRev = currentRev();
      lastPushAt = null;
      emit();
    },
    clear() {
      undoStack.length = 0;
      redoStack = [];
      baseRev = nextRev++;
      savedRev = baseRev;
      lastPushAt = null;
      emit();
    },
    getSnapshot() {
      snapshot ??= {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoLabel: label("Undo", undoStack[undoStack.length - 1]),
        redoLabel: label("Redo", redoStack[redoStack.length - 1]),
        dirty: currentRev() !== savedRev,
        modifiedAt,
      };
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
