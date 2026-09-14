import { z } from "zod";
import { ProbeResult } from "./probe";

/**
 * Media domain IPC channels (ENGINEERING_SPEC §2, §3). Shape matches `Channel`
 * in `electron/ipc/contracts.ts`; the orchestrator merges these into the central
 * contract map.
 */

const absPath = z.string().min(1);

export const mediaContracts = {
  /** Allow-list a directory for `reelform-media://`. Omitted id → generated. */
  "media:registerRoot": {
    name: "media:registerRoot",
    request: z.object({
      path: absPath,
      rootId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
        .optional(),
    }),
    response: z.object({ rootId: z.string(), baseUrl: z.string() }),
  },
  "media:unregisterRoot": {
    name: "media:unregisterRoot",
    request: z.object({ rootId: z.string() }),
    response: z.object({ ok: z.boolean() }),
  },
  "media:probe": {
    name: "media:probe",
    request: z.object({ path: absPath }),
    response: ProbeResult,
  },
  "media:thumbnail": {
    name: "media:thumbnail",
    request: z.object({
      path: absPath,
      atMs: z.number().finite().nonnegative(),
      width: z.number().int().min(2).max(7680).optional(),
      format: z.enum(["png", "jpg"]).optional(),
    }),
    response: z.object({ dataUrl: z.string() }),
  },
} as const;

export type MediaContracts = typeof mediaContracts;
