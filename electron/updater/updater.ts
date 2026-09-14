import {
  type UpdateChannel,
  type UpdaterEvent,
  type UpdaterState,
  initialUpdaterState,
  reduceUpdater,
  toUpdateInfo,
} from "./state";

/**
 * electron-updater wrapper (ENGINEERING_SPEC §11): Stable/Beta via
 * `allowPrerelease`, check on launch + every 6h, background download,
 * "Restart to update". `autoUpdater`, timers and clock are injected.
 */

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type Listener = (...args: unknown[]) => void;

/** The subset of electron-updater's `AppUpdater` we use. */
export interface AutoUpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface UpdaterDeps {
  autoUpdater: AutoUpdaterPort;
  timers: UpdaterTimers;
  now: () => number;
  currentVersion: string;
  channel: UpdateChannel;
  /** "Check for updates automatically" setting; manual checks ignore it. */
  autoCheckEnabled: () => boolean;
  onChange?: ((state: UpdaterState) => void) | undefined;
  intervalMs?: number | undefined;
}

export interface Updater {
  /** Subscribe to autoUpdater events, check now (if enabled), start the 6h timer. */
  start(): void;
  /** Manual "Check now". Resolves after the check request settles. */
  check(): Promise<UpdaterState>;
  setChannel(channel: UpdateChannel): void;
  /** Quit and install; only when an update is downloaded. */
  restart(): { ok: boolean };
  getState(): UpdaterState;
  dispose(): void;
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Update failed";

export function createUpdater(deps: UpdaterDeps): Updater {
  const { autoUpdater, timers, now } = deps;
  let state = initialUpdaterState(deps.currentVersion, deps.channel);
  let interval: unknown = null;
  let started = false;
  let inFlight: Promise<UpdaterState> | null = null;

  const dispatch = (event: UpdaterEvent): void => {
    const next = reduceUpdater(state, event);
    if (next === state) return;
    state = next;
    deps.onChange?.(state);
  };

  const listeners: [string, Listener][] = [
    ["checking-for-update", () => dispatch({ type: "checking" })],
    ["update-not-available", () => dispatch({ type: "not-available", at: now() })],
    [
      "update-available",
      ((info: unknown) =>
        dispatch({ type: "available", info: toUpdateInfo(info), at: now() })) as Listener,
    ],
    [
      "download-progress",
      ((p: { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number }) =>
        dispatch({
          type: "progress",
          progress: {
            percent: p?.percent ?? 0,
            bytesPerSecond: p?.bytesPerSecond ?? 0,
            transferred: p?.transferred ?? 0,
            total: p?.total ?? 0,
          },
        })) as Listener,
    ],
    [
      "update-downloaded",
      ((info: unknown) => dispatch({ type: "downloaded", info: toUpdateInfo(info) })) as Listener,
    ],
    ["error", ((e: unknown) => dispatch({ type: "error", message: errorMessage(e) })) as Listener],
  ];

  const configure = (channel: UpdateChannel): void => {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = channel === "beta";
    autoUpdater.allowDowngrade = false;
  };
  configure(deps.channel);
  // Listen from creation so manual checks before `start()` still settle.
  let listening = true;
  for (const [event, fn] of listeners) autoUpdater.on(event, fn);

  const check = (): Promise<UpdaterState> => {
    if (state.phase === "downloading" || state.phase === "downloaded")
      return Promise.resolve(state);
    if (inFlight) return inFlight;
    dispatch({ type: "checking" });
    inFlight = autoUpdater
      .checkForUpdates()
      .then(
        () => {
          // Dev / unconfigured builds resolve (often null) without emitting events.
          if (state.phase === "checking") {
            dispatch({ type: "not-available", at: now() });
          }
          return state;
        },
        (e: unknown) => {
          dispatch({ type: "error", message: errorMessage(e) });
          return state;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (!listening) {
        for (const [event, fn] of listeners) autoUpdater.on(event, fn);
        listening = true;
      }
      if (deps.autoCheckEnabled()) void check();
      interval = timers.setInterval(() => {
        if (deps.autoCheckEnabled()) void check();
      }, deps.intervalMs ?? CHECK_INTERVAL_MS);
    },
    check,
    setChannel(channel) {
      if (channel === state.channel) return;
      configure(channel);
      dispatch({ type: "channel", channel });
      if (started && deps.autoCheckEnabled()) void check();
    },
    restart() {
      if (state.phase !== "downloaded") return { ok: false };
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    },
    getState: () => state,
    dispose() {
      if (interval !== null) timers.clearInterval(interval);
      interval = null;
      if (listening) for (const [event, fn] of listeners) autoUpdater.removeListener(event, fn);
      listening = false;
      started = false;
    },
  };
}
