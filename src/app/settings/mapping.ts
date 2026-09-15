import type { RequestOf } from "@contracts";
import {
  type MainSettings,
  SETTINGS_KEYS,
  type SettingsKey,
  type SettingsPatch,
  type SettingsState,
} from "../../settings/types";

/**
 * Renderer `SettingsState` ↔ main `SettingsSchema`. The two are the same type
 * except for `schemaVersion`; these helpers strip it, drop unknown/undefined
 * keys from outgoing patches, and apply patches locally (optimistic updates).
 */

export type MainSettingsPatch = RequestOf<"settings:set">["patch"];

const KEY_SET: ReadonlySet<string> = new Set(SETTINGS_KEYS);

export function isSettingsKey(key: string): key is SettingsKey {
  return KEY_SET.has(key);
}

/** Main settings → renderer state (deep copy, `schemaVersion` removed). */
export function fromMainSettings(settings: MainSettings): SettingsState {
  const { schemaVersion: _version, ...rest } = settings;
  return structuredClone(rest);
}

/** Renderer patch → `settings:set` payload patch (known, defined keys only). */
export function toMainPatch(patch: SettingsPatch | Record<string, unknown>): MainSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !isSettingsKey(key)) continue;
    out[key] = value;
  }
  return out as MainSettingsPatch;
}

/** Shallow-merge a patch (records like `shortcuts` are replaced whole, as in main). */
export function applySettingsPatch(state: SettingsState, patch: SettingsPatch): SettingsState {
  return { ...state, ...(toMainPatch(patch) as SettingsPatch) };
}
