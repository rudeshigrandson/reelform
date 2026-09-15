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

export interface GlobalShortcutManager {
  setOverrides(overrides: ShortcutOverrides): void;
  setContext(patch: Partial<GlobalShortcutContext>): void;
  getStatus(): GlobalShortcutStatus;
  /** Unregister everything this manager registered. */
  dispose(): void;
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
      const live = r.def.countdownOnly ? context.countdown : context.hudOpen || context.recording;
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
