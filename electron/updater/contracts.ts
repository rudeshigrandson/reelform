import { z } from "zod";
import { UpdaterStateSchema } from "./state";
import type { Updater } from "./updater";

/** IPC surface for the updater (ENGINEERING_SPEC §3, §11). */

export const updaterContracts = {
  "updater:status": { name: "updater:status", request: z.void(), response: UpdaterStateSchema },
  "updater:check": { name: "updater:check", request: z.void(), response: UpdaterStateSchema },
  "updater:restart": {
    name: "updater:restart",
    request: z.void(),
    response: z.object({ ok: z.boolean() }),
  },
} as const;

export const updaterEvents = {
  /** Every state transition (drives the launcher banner + Settings › Updates). */
  "updater:changed": { name: "updater:changed", payload: UpdaterStateSchema },
} as const;

type UpdaterContracts = typeof updaterContracts;

export type UpdaterHandlers = {
  [K in keyof UpdaterContracts]: (
    req: z.infer<UpdaterContracts[K]["request"]>,
  ) => Promise<z.infer<UpdaterContracts[K]["response"]>>;
};

export interface UpdaterIpcDeps {
  updater: Pick<Updater, "getState" | "check" | "restart">;
}

export function createUpdaterHandlers(deps: UpdaterIpcDeps): UpdaterHandlers {
  return {
    "updater:status": async () => deps.updater.getState(),
    "updater:check": async () => deps.updater.check(),
    "updater:restart": async () => deps.updater.restart(),
  };
}
