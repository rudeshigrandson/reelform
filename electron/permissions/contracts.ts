import { z } from "zod";
import {
  PERMISSION_KINDS,
  type PermissionsSystem,
  readPermissions,
  requestPermission,
} from "./permissionModel";
import { settingsDeepLink } from "./settingsLinks";

export const PermissionKindSchema = z.enum(PERMISSION_KINDS);
export const PermissionStatusSchema = z.enum([
  "granted",
  "denied",
  "not-determined",
  "restricted",
  "not-applicable",
]);

export const PermissionEntrySchema = z.object({
  kind: PermissionKindSchema,
  status: PermissionStatusSchema,
  required: z.boolean(),
  canRequest: z.boolean(),
  canOpenSettings: z.boolean(),
});

export const PermissionsSnapshotSchema = z.object({
  platform: z.enum(["darwin", "win32", "linux"]),
  permissions: z.object({
    screen: PermissionEntrySchema,
    microphone: PermissionEntrySchema,
    camera: PermissionEntrySchema,
    accessibility: PermissionEntrySchema,
    notifications: PermissionEntrySchema,
  }),
});

export const permissionsContracts = {
  "permissions:status": {
    name: "permissions:status",
    request: z.void(),
    response: PermissionsSnapshotSchema,
  },
  "permissions:request": {
    name: "permissions:request",
    request: z.object({ kind: PermissionKindSchema }),
    response: z.object({
      kind: PermissionKindSchema,
      status: PermissionStatusSchema,
      /** `open-settings`: main already opened the System Settings pane. */
      outcome: z.enum(["prompted", "open-settings", "none"]),
    }),
  },
  "permissions:openSettings": {
    name: "permissions:openSettings",
    request: z.object({ kind: PermissionKindSchema }),
    response: z.object({ ok: z.boolean() }),
  },
} as const;

export const permissionsEvents = {
  /** Emitted by the poller when any status changes (and once on start). */
  "permissions:changed": { name: "permissions:changed", payload: PermissionsSnapshotSchema },
} as const;

type PermissionsContracts = typeof permissionsContracts;

export type PermissionsHandlers = {
  [K in keyof PermissionsContracts]: (
    req: z.infer<PermissionsContracts[K]["request"]>,
  ) => Promise<z.infer<PermissionsContracts[K]["response"]>>;
};

export interface PermissionsDeps {
  system: PermissionsSystem;
  openExternal(url: string): Promise<void>;
}

export function createPermissionsHandlers(deps: PermissionsDeps): PermissionsHandlers {
  const open = async (kind: z.infer<typeof PermissionKindSchema>): Promise<boolean> => {
    const url = settingsDeepLink(deps.system.platform, kind);
    if (!url) return false;
    try {
      await deps.openExternal(url);
      return true;
    } catch {
      return false;
    }
  };

  return {
    "permissions:status": async () => readPermissions(deps.system),
    "permissions:request": async ({ kind }) => {
      const res = await requestPermission(deps.system, kind);
      if (res.outcome === "open-settings") {
        const opened = await open(kind);
        return { kind, status: res.status, outcome: opened ? "open-settings" : "none" };
      }
      return { kind, ...res };
    },
    "permissions:openSettings": async ({ kind }) => ({ ok: await open(kind) }),
  };
}
