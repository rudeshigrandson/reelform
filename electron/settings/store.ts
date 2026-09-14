import type { ShortcutPlatform } from "../../src/shortcuts/accelerator";
import { type ShortcutConflict, detectConflicts } from "../../src/shortcuts/conflicts";
import { resolveShortcuts } from "../../src/shortcuts/registry";
import { migrateSettings } from "./migrations";
import {
  type Settings,
  type SettingsKey,
  SettingsPatchSchema,
  SettingsSchema,
  changedKeys,
} from "./schema";

/**
 * Settings JSON store (ENGINEERING_SPEC §11) at `userData/settings.json`.
 * - Load: missing → defaults; corrupt JSON → backed up to `.corrupt`, defaults;
 *   old versions migrated and rewritten.
 * - Set: partial patch validated with zod (unknown keys rejected), new
 *   blocking shortcut conflicts rejected, then written atomically (tmp file +
 *   rename) and broadcast to subscribers.
 * - Every mutation is serialized so concurrent sets never interleave writes.
 */

export interface SettingsFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Recursive mkdir; must not fail when the directory exists. */
  mkdir(path: string): Promise<void>;
}

export interface SettingsStoreDeps {
  fs: SettingsFs;
  filePath: string;
  defaults: Settings;
  platform: ShortcutPlatform;
  log?: ((level: "warn" | "error", message: string) => void) | undefined;
}

export type SettingsErrorCode = "INVALID_PATCH" | "SHORTCUT_CONFLICT" | "WRITE_FAILED";

export type SettingsSetResult =
  | { ok: true; settings: Settings; changed: SettingsKey[] }
  | { ok: false; error: { code: SettingsErrorCode; message: string; details?: unknown } };

export interface SettingsChange {
  settings: Settings;
  changed: SettingsKey[];
}

export interface SettingsStore {
  load(): Promise<Settings>;
  /** Current in-memory settings (defaults until `load` resolves). */
  get(): Settings;
  set(patch: unknown): Promise<SettingsSetResult>;
  reset(): Promise<SettingsSetResult>;
  subscribe(listener: (change: SettingsChange) => void): () => void;
}

const dirname = (p: string): string => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return ".";
  return i === 0 ? p.slice(0, 1) : p.slice(0, i);
};

const errnoCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : undefined;

const conflictKey = (c: ShortcutConflict) => `${c.ids[0]}|${c.ids[1]}|${c.accelerator}`;

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const { fs, filePath, defaults, platform } = deps;
  const log = deps.log ?? (() => undefined);
  let current: Settings = structuredClone(defaults);
  let loading: Promise<Settings> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(change: SettingsChange) => void>();

  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const writeAtomic = async (settings: Settings): Promise<void> => {
    const tmp = `${filePath}.tmp`;
    await fs.mkdir(dirname(filePath));
    await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
    await fs.rename(tmp, filePath);
  };

  const emit = (change: SettingsChange): void => {
    for (const l of [...listeners]) {
      try {
        l(change);
      } catch (e) {
        log("error", `settings listener threw: ${String(e)}`);
      }
    }
  };

  const doLoad = async (): Promise<Settings> => {
    let text: string | null = null;
    let unreadable = false;
    try {
      text = await fs.readFile(filePath);
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") {
        // EACCES/EBUSY/EIO: the file may be fine — never clobber it with defaults on load.
        unreadable = true;
        log("warn", `settings read failed (${errnoCode(e) ?? "unknown"})`);
      }
    }

    let raw: unknown;
    let corrupt = false;
    if (text !== null) {
      try {
        raw = JSON.parse(text);
      } catch {
        corrupt = true;
      }
    }
    if (corrupt) {
      log("warn", "settings file is not valid JSON; backing up and using defaults");
      await fs.rename(filePath, `${filePath}.corrupt`).catch(() => undefined);
    }

    const result = migrateSettings(text === null || corrupt ? undefined : raw, defaults);
    current = result.settings;
    if (result.repairedKeys.length > 0) {
      log("warn", `settings keys reset to defaults: ${result.repairedKeys.join(", ")}`);
    }
    if (result.needsWrite && !result.fromNewerVersion && !unreadable) {
      await writeAtomic(current).catch((e) => log("error", `settings write failed: ${String(e)}`));
    }
    return current;
  };

  const ensureLoaded = (): Promise<Settings> => {
    loading ??= serialized(doLoad);
    return loading;
  };

  const commit = async (next: Settings): Promise<SettingsSetResult> => {
    const changed = changedKeys(current, next);
    if (changed.length === 0) return { ok: true, settings: current, changed };
    try {
      await writeAtomic(next);
    } catch (e) {
      return {
        ok: false,
        error: { code: "WRITE_FAILED", message: `Could not save settings: ${String(e)}` },
      };
    }
    current = next;
    emit({ settings: current, changed });
    return { ok: true, settings: current, changed };
  };

  return {
    // Resolve to the live settings, not the load-time snapshot (sets may have landed since).
    load: async () => {
      await ensureLoaded();
      return current;
    },
    get: () => current,

    async set(patch) {
      await ensureLoaded();
      return serialized(async (): Promise<SettingsSetResult> => {
        const parsed = SettingsPatchSchema.safeParse(patch);
        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "INVALID_PATCH",
              message: "Invalid settings patch",
              details: parsed.error.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
          };
        }
        const merged = SettingsSchema.safeParse({ ...current, ...parsed.data });
        if (!merged.success) {
          return { ok: false, error: { code: "INVALID_PATCH", message: merged.error.message } };
        }
        const next = merged.data;

        if (parsed.data.shortcuts !== undefined) {
          const before = new Set(
            detectConflicts(resolveShortcuts(platform, current.shortcuts))
              .filter((c) => c.kind === "duplicate")
              .map(conflictKey),
          );
          const introduced = detectConflicts(resolveShortcuts(platform, next.shortcuts)).filter(
            (c) => c.kind === "duplicate" && !before.has(conflictKey(c)),
          );
          if (introduced.length > 0) {
            return {
              ok: false,
              error: {
                code: "SHORTCUT_CONFLICT",
                message: "Shortcut already in use",
                details: introduced,
              },
            };
          }
        }
        return commit(next);
      });
    },

    async reset() {
      await ensureLoaded();
      return serialized(() => commit(structuredClone(defaults)));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
