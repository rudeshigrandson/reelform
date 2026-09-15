import { z } from "zod";
import type { GlobalShortcutManager } from "./globalShortcuts";
import { SettingsPatchSchema, SettingsSchema } from "./schema";
import type { SettingsStore } from "./store";

/** IPC surface for settings + global shortcut status (ENGINEERING_SPEC §3, §11). */

export const SettingsSetResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), settings: SettingsSchema, changed: z.array(z.string()) }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(["INVALID_PATCH", "SHORTCUT_CONFLICT", "WRITE_FAILED"]),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
]);

const GlobalShortcutEntrySchema = z.object({ id: z.string(), accelerator: z.string() });

export const GlobalShortcutStatusSchema = z.object({
  context: z.object({ hudOpen: z.boolean(), recording: z.boolean(), countdown: z.boolean() }),
  registered: z.array(GlobalShortcutEntrySchema),
  failures: z.array(
    GlobalShortcutEntrySchema.extend({ reason: z.enum(["os-conflict", "duplicate"]) }),
  ),
});

export const SettingsChangedSchema = z.object({
  settings: SettingsSchema,
  changed: z.array(z.string()),
});

export const settingsContracts = {
  "settings:get": { name: "settings:get", request: z.void(), response: SettingsSchema },
  "settings:set": {
    name: "settings:set",
    request: z.object({ patch: SettingsPatchSchema }),
    response: SettingsSetResultSchema,
  },
  "settings:reset": {
    name: "settings:reset",
    request: z.void(),
    response: SettingsSetResultSchema,
  },
  "shortcuts:globalStatus": {
    name: "shortcuts:globalStatus",
    request: z.void(),
    response: GlobalShortcutStatusSchema,
  },
} as const;

export const settingsEvents = {
  /** Broadcast to every window after a successful write. */
  "settings:changed": { name: "settings:changed", payload: SettingsChangedSchema },
  /** Global shortcut registration changed (HUD opened, key taken by another app…). */
  "shortcuts:globalStatusChanged": {
    name: "shortcuts:globalStatusChanged",
    payload: GlobalShortcutStatusSchema,
  },
} as const;

type SettingsContracts = typeof settingsContracts;

export type SettingsHandlers = {
  [K in keyof SettingsContracts]: (
    req: z.infer<SettingsContracts[K]["request"]>,
  ) => Promise<z.infer<SettingsContracts[K]["response"]>>;
};

export interface SettingsDeps {
  store: SettingsStore;
  shortcuts: Pick<GlobalShortcutManager, "getStatus">;
}

export function createSettingsHandlers(deps: SettingsDeps): SettingsHandlers {
  return {
    "settings:get": async () => {
      await deps.store.load();
      return deps.store.get();
    },
    // The store re-validates: handlers may be called without the IPC boundary parse.
    "settings:set": async ({ patch }) => deps.store.set(patch),
    "settings:reset": async () => deps.store.reset(),
    "shortcuts:globalStatus": async () => deps.shortcuts.getStatus(),
  };
}
