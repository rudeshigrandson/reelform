import {
  type ShortcutPlatform,
  formatAccelerator,
  toElectronAccelerator,
} from "../../src/shortcuts/accelerator";
import { type ShortcutOverrides, resolveShortcuts } from "../../src/shortcuts/registry";

/**
 * OS-level shortcuts via Electron `globalShortcut` (ENGINEERING_SPEC §5.6,
 * §11). Registered from settings, but only while the HUD is open or a
 * recording is running; the countdown-cancel key (Esc) only during the
 * countdown so Esc is never stolen from other apps otherwise. Registration
 * failures (key owned by another app, duplicate binding) are reported, not
 * thrown, so Settings can show an inline conflict.
 */

export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface GlobalShortcutContext {
  hudOpen: boolean;
  recording: boolean;
  countdown: boolean;
}

export type GlobalShortcutFailureReason = "os-conflict" | "duplicate";

export interface GlobalShortcutEntry {
  id: string;
  /** Platform display string ("⇧⌘R"). */
  accelerator: string;
}

export interface GlobalShortcutStatus {
  context: GlobalShortcutContext;
  registered: GlobalShortcutEntry[];
  failures: (GlobalShortcutEntry & { reason: GlobalShortcutFailureReason })[];
}

export interface GlobalShortcutManagerDeps {
  globalShortcut: GlobalShortcutApi;
  platform: ShortcutPlatform;
  onTrigger: (id: string) => void;
  onStatus?: ((status: GlobalShortcutStatus) => void) | undefined;
}

/**
 * Global shortcuts registered whenever the app runs, regardless of context.
 * Deliberate deviation from §5.6 ("only while HUD open / recording"): the
 * start/stop key must be able to summon the HUD from anywhere, otherwise it
 * is useless until the user has already opened the recorder. Kept here rather
 * than as a registry flag because `src/shortcuts/registry.ts` is renderer-owned.
 */
export const ALWAYS_REGISTERED_SHORTCUTS: ReadonlySet<string> = new Set(["record.toggle"]);

export interface GlobalShortcutManager {
  setOverrides(overrides: ShortcutOverrides): void;
  setContext(patch: Partial<GlobalShortcutContext>): void;
  getStatus(): GlobalShortcutStatus;
  /** Unregister everything this manager registered. */
  dispose(): void;
}

/**
 * How a `recording:event` changes which global shortcuts are live. Events
 * that don't change the session phase (stats, diskLow, deviceLost) → null.
 */
export function shortcutContextForRecordingEvent(
  type: string,
):
  | Pick<GlobalShortcutContext, "recording" | "countdown">
  | Pick<GlobalShortcutContext, "countdown">
  | null {
  switch (type) {
    case "countdown":
      return { countdown: true };
    case "started":
    case "resumed":
    case "paused":
      return { recording: true, countdown: false };
    case "stopped":
    case "interrupted":
    case "discarded":
    case "error":
      return { recording: false, countdown: false };
    default:
      return null;
  }
}

export type GlobalShortcutRoute = "open-hud" | "broadcast";

/**
 * Route a fired global shortcut. Start/stop with no HUD and no live session
 * summons the HUD (§5.6 "⌘⇧R from anywhere"); everything else is forwarded to
 * the windows, where the HUD / recording UI acts on it.
 */
export function routeGlobalShortcut(
  id: string,
  state: { hudOpen: boolean; sessionActive: boolean },
): GlobalShortcutRoute {
  return id === "record.toggle" && !state.hudOpen && !state.sessionActive
    ? "open-hud"
    : "broadcast";
}

export function createGlobalShortcutManager(
  deps: GlobalShortcutManagerDeps,
): GlobalShortcutManager {
  const { globalShortcut, platform } = deps;
  let overrides: ShortcutOverrides = {};
  let context: GlobalShortcutContext = { hudOpen: false, recording: false, countdown: false };
  /** electron accelerator → id */
  const registered = new Map<string, { id: string; display: string }>();
  let status: GlobalShortcutStatus = { context, registered: [], failures: [] };

  const sync = (): void => {
    const desired = new Map<string, { id: string; display: string }>();
    const failures: GlobalShortcutStatus["failures"] = [];

    for (const r of resolveShortcuts(platform, overrides)) {
      if (r.scope !== "global" || !r.accelerator) continue;
      const live = ALWAYS_REGISTERED_SHORTCUTS.has(r.id)
        ? true
        : r.def.countdownOnly
          ? context.countdown
          : context.hudOpen || context.recording;
      if (!live) continue;
      const electron = toElectronAccelerator(r.accelerator, platform);
      const display = formatAccelerator(r.accelerator, platform);
      if (desired.has(electron)) {
        failures.push({ id: r.id, accelerator: display, reason: "duplicate" });
        continue;
      }
      desired.set(electron, { id: r.id, display });
    }

    for (const [electron, entry] of [...registered]) {
      if (desired.get(electron)?.id !== entry.id) {
        globalShortcut.unregister(electron);
        registered.delete(electron);
      }
    }

    for (const [electron, entry] of desired) {
      if (registered.has(electron)) continue;
      let ok = false;
      try {
        const id = entry.id;
        ok = globalShortcut.register(electron, () => deps.onTrigger(id));
      } catch {
        ok = false;
      }
      if (ok) registered.set(electron, entry);
      else failures.push({ id: entry.id, accelerator: entry.display, reason: "os-conflict" });
    }

    const next: GlobalShortcutStatus = {
      context: { ...context },
      registered: [...registered.values()].map((e) => ({ id: e.id, accelerator: e.display })),
      failures,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(status);
    status = next;
    if (changed) deps.onStatus?.(status);
  };

  return {
    setOverrides(next) {
      overrides = next;
      sync();
    },
    setContext(patch) {
      context = { ...context, ...patch };
      sync();
    },
    getStatus: () => status,
    dispose() {
      for (const electron of registered.keys()) globalShortcut.unregister(electron);
      registered.clear();
      status = { context, registered: [], failures: [] };
    },
  };
}
