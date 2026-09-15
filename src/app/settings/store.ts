import type { EventPayloadOf, ResponseOf } from "@contracts";
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { type SettingsPatch, type SettingsState, sampleSettings } from "../../settings/types";
import { invoke, onEvent } from "../ipc";
import {
  type MainSettingsPatch,
  applySettingsPatch,
  fromMainSettings,
  toMainPatch,
} from "./mapping";

/**
 * Renderer mirror of the main settings store (SPEC §11): loads with
 * `settings:get`, writes with `settings:set` (optimistic, rolled back on
 * INVALID_PATCH / SHORTCUT_CONFLICT / WRITE_FAILED or a rejected invoke), and
 * follows `settings:changed` broadcasts from other windows.
 *
 * Model: `confirmed` is the last state main acknowledged; `settings` is
 * `confirmed` with every still-pending patch re-applied in order, so a failed
 * patch rolls back only its own keys and never clobbers later edits.
 */

export type SettingsSetResult = ResponseOf<"settings:set">;
export type SettingsChange = EventPayloadOf<"settings:changed">;

/** IPC seam; `null` results mean "not running in Electron". */
export interface SettingsTransport {
  get(): Promise<ResponseOf<"settings:get"> | null>;
  set(patch: MainSettingsPatch): Promise<SettingsSetResult | null>;
  reset(): Promise<SettingsSetResult | null>;
  subscribe(listener: (change: SettingsChange) => void): () => void;
}

export const ipcSettingsTransport: SettingsTransport = {
  get: () => invoke("settings:get", undefined),
  set: (patch) => invoke("settings:set", { patch }),
  reset: () => invoke("settings:reset", undefined),
  subscribe: (listener) => onEvent("settings:changed", listener),
};

/** loading → ready | offline (no Electron: local-only edits) | error (load failed). */
export type SettingsSyncStatus = "idle" | "loading" | "ready" | "offline" | "error";

export interface SettingsSyncError {
  code: string;
  message: string;
  details?: unknown;
}

export type SettingsWriteOutcome = { ok: true } | { ok: false; error: SettingsSyncError };

interface PendingPatch {
  seq: number;
  patch: SettingsPatch;
}

export interface AppSettingsState {
  status: SettingsSyncStatus;
  settings: SettingsState;
  confirmed: SettingsState;
  pending: readonly PendingPatch[];
  lastError: SettingsSyncError | null;
  /** Load + subscribe. Idempotent; resolves when the first load settles. */
  init(): Promise<void>;
  patch(patch: SettingsPatch): Promise<SettingsWriteOutcome>;
  reset(): Promise<SettingsWriteOutcome>;
  clearError(): void;
  /** Unsubscribe from `settings:changed` (tests / window teardown). */
  dispose(): void;
}

export type AppSettingsStore = UseBoundStore<StoreApi<AppSettingsState>>;

function toSyncError(err: unknown): SettingsSyncError {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    const e = err as { code: unknown; message: unknown; details?: unknown };
    return {
      code: String(e.code),
      message: String(e.message),
      ...(e.details !== undefined ? { details: e.details } : {}),
    };
  }
  return { code: "IPC_FAILED", message: err instanceof Error ? err.message : String(err) };
}

const recompute = (confirmed: SettingsState, pending: readonly PendingPatch[]): SettingsState =>
  pending.reduce((acc, p) => applySettingsPatch(acc, p.patch), confirmed);

export function createAppSettingsStore(
  transport: SettingsTransport,
  initial: SettingsState = sampleSettings,
): AppSettingsStore {
  let seq = 0;
  let initPromise: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;

  return create<AppSettingsState>((set, get) => {
    const settle = (confirmed: SettingsState, pending: readonly PendingPatch[]) =>
      set({ confirmed, pending, settings: recompute(confirmed, pending) });

    const write = async (
      run: () => Promise<SettingsSetResult | null>,
      local: (confirmed: SettingsState) => SettingsState,
      entry: PendingPatch | null,
    ): Promise<SettingsWriteOutcome> => {
      const drop = () => get().pending.filter((p) => p !== entry);
      try {
        const res = await run();
        if (res === null) {
          settle(local(get().confirmed), drop());
          return { ok: true };
        }
        if (res.ok) {
          settle(fromMainSettings(res.settings), drop());
          set({ lastError: null });
          return { ok: true };
        }
        settle(get().confirmed, drop());
        set({ lastError: res.error });
        return { ok: false, error: res.error };
      } catch (err) {
        const error = toSyncError(err);
        settle(get().confirmed, drop());
        set({ lastError: error });
        return { ok: false, error };
      }
    };

    return {
      status: "idle",
      settings: initial,
      confirmed: initial,
      pending: [],
      lastError: null,

      init() {
        if (initPromise) return initPromise;
        set({ status: "loading" });
        unsubscribe = transport.subscribe((change) => {
          settle(fromMainSettings(change.settings), get().pending);
          if (get().status !== "ready") set({ status: "ready" });
        });
        initPromise = transport.get().then(
          (loaded) => {
            if (loaded === null) {
              set({ status: "offline" });
              return;
            }
            settle(fromMainSettings(loaded), get().pending);
            set({ status: "ready", lastError: null });
          },
          (err: unknown) => {
            set({ status: "error", lastError: toSyncError(err) });
          },
        );
        return initPromise;
      },

      patch(patch) {
        const payload = toMainPatch(patch);
        if (Object.keys(payload).length === 0) return Promise.resolve({ ok: true });
        const entry: PendingPatch = { seq: ++seq, patch: payload as SettingsPatch };
        const pending = [...get().pending, entry];
        settle(get().confirmed, pending);
        return write(
          () => transport.set(payload),
          (confirmed) => applySettingsPatch(confirmed, entry.patch),
          entry,
        );
      },

      reset() {
        return write(
          () => transport.reset(),
          () => ({ ...initial }),
          null,
        );
      },

      clearError: () => set({ lastError: null }),

      dispose() {
        unsubscribe?.();
        unsubscribe = null;
        initPromise = null;
      },
    };
  });
}

/** The window's settings mirror over real IPC. Call `init()` once at window boot. */
export const useAppSettings: AppSettingsStore = createAppSettingsStore(ipcSettingsTransport);
