import { SETTINGS_SCHEMA_VERSION, type Settings, SettingsShape } from "./schema";

/**
 * Versioned settings migrations (ENGINEERING_SPEC §11).
 *
 * Pipeline: raw JSON → step migrations `vN → vN+1` → per-key coercion against
 * the current schema. Coercion is per key: one corrupt value falls back to its
 * default instead of resetting the whole file. Unknown keys are dropped.
 *
 * Version history:
 * - v1 (M0, no `schemaVersion` field): the flat `SettingsState` from
 *   `src/settings/types.ts`; `autoPruneDays: 0` meant "never prune".
 * - v2: full S24 schema; pruning is an explicit `autoPrune` switch.
 */

type Raw = Record<string, unknown>;

/** `MIGRATIONS[n]` upgrades a version-n object to version n+1. */
export const MIGRATIONS: Readonly<Record<number, (raw: Raw) => Raw>> = {
  1: (raw) => {
    if (raw.autoPruneDays === 0) {
      // Omitting the key lets coercion fill the v2 default day count.
      const { autoPruneDays: _never, ...rest } = raw;
      return { ...rest, autoPrune: false, schemaVersion: 2 };
    }
    return { ...raw, schemaVersion: 2 };
  },
};

export interface MigrationResult {
  settings: Settings;
  /** Version found on disk; null when the input was not an object. */
  fromVersion: number | null;
  /** Keys present on disk whose values were invalid and replaced by defaults. */
  repairedKeys: string[];
  /** Keys on disk the current schema does not know (dropped). */
  droppedKeys: string[];
  /** True when the result differs from what is on disk and should be rewritten. */
  needsWrite: boolean;
  /** File was written by a newer app version — avoid rewriting it on load. */
  fromNewerVersion: boolean;
}

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function migrateSettings(raw: unknown, defaults: Settings): MigrationResult {
  if (!isObject(raw)) {
    return {
      settings: structuredClone(defaults),
      fromVersion: null,
      repairedKeys: [],
      droppedKeys: [],
      needsWrite: true,
      fromNewerVersion: false,
    };
  }

  const declared = raw.schemaVersion;
  const fromVersion =
    typeof declared === "number" && Number.isInteger(declared) && declared >= 1 ? declared : 1;

  let current: Raw = raw;
  let version = fromVersion;
  while (version < SETTINGS_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    current = step(current);
    version++;
  }

  const settings = structuredClone(defaults);
  const repairedKeys: string[] = [];
  const out = settings as unknown as Raw;
  for (const [key, schema] of Object.entries(SettingsShape)) {
    if (key === "schemaVersion" || !Object.hasOwn(current, key)) continue;
    const parsed = schema.safeParse(current[key]);
    if (parsed.success) out[key] = parsed.data;
    else repairedKeys.push(key);
  }
  const droppedKeys = Object.keys(current).filter((k) => !Object.hasOwn(SettingsShape, k));

  return {
    settings,
    fromVersion,
    repairedKeys,
    droppedKeys,
    needsWrite:
      fromVersion !== SETTINGS_SCHEMA_VERSION || repairedKeys.length > 0 || droppedKeys.length > 0,
    fromNewerVersion: fromVersion > SETTINGS_SCHEMA_VERSION,
  };
}
