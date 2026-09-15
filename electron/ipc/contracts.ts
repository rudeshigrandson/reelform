import { z } from "zod";
import { captionsContracts, captionsEvents } from "../captions/contracts";
import { diagnosticsContracts } from "../diagnostics/contracts";
import { exportContracts } from "../export/contracts";
import { mediaContracts } from "../media/contracts";
import { permissionsContracts, permissionsEvents } from "../permissions/contracts";
import { projectContracts, projectEvents } from "../project/contracts";
import { recordingContracts, recordingEvents } from "../recording/contracts";
import { isAllowedExternalUrl } from "../security/hardening";
import { settingsContracts, settingsEvents } from "../settings/contracts";
import { systemFileContracts, systemProjectFileContracts } from "../system/contracts";
import { telemetryContracts } from "../telemetry/contracts";
import { updaterContracts, updaterEvents } from "../updater/contracts";
import { windowsContracts } from "../windows/contracts";

/**
 * Single source of truth for every IPC channel name and its request/response
 * shape. Shared by main (handler registration) and renderer (typed invoke) via
 * the `@contracts` path alias. Renderer never imports anything else from
 * `electron/`. Channels are named `domain:verb`; each domain owns its fragment
 * in `electron/<domain>/contracts.ts` and is merged here.
 */

export const IpcError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type IpcError = z.infer<typeof IpcError>;

/** One channel: its name + zod schemas for the request and response bodies. */
export interface Channel<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny> {
  name: string;
  request: Req;
  response: Res;
}

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

// ---- system domain ------------------------------------------------------
const systemContracts = {
  "system:ping": channel(
    "system:ping",
    z.void(),
    z.object({ pong: z.literal(true), version: z.string() }),
  ),
  "system:openExternal": channel(
    "system:openExternal",
    z.object({
      // Only web and mail links reach the OS; file:, smb:, custom app schemes are refused (§13).
      url: z.string().url().refine(isAllowedExternalUrl, {
        message: "Only https, http and mailto links can be opened",
      }),
    }),
    z.object({ ok: z.boolean() }),
  ),
} as const;

export const contracts = {
  ...systemContracts,
  ...projectContracts,
  ...exportContracts,
  ...mediaContracts,
  ...recordingContracts,
  ...captionsContracts,
  ...permissionsContracts,
  ...settingsContracts,
  ...updaterContracts,
  ...diagnosticsContracts,
  // After diagnostics: the system domain owns `system:pickFolder` (same shape).
  ...systemFileContracts,
  ...systemProjectFileContracts,
  ...windowsContracts,
  ...telemetryContracts,
} as const;

/** Main → renderer push events, delivered through `ReelformApi.on`. */
export const events = {
  ...recordingEvents,
  ...projectEvents,
  ...captionsEvents,
  ...permissionsEvents,
  ...settingsEvents,
  ...updaterEvents,
} as const;

export type Contracts = typeof contracts;
export type ChannelName = keyof Contracts;

export type RequestOf<K extends ChannelName> = z.infer<Contracts[K]["request"]>;
export type ResponseOf<K extends ChannelName> = z.infer<Contracts[K]["response"]>;

export type Events = typeof events;
export type EventName = keyof Events;
type EventSchema<K extends EventName> = Events[K] extends { payload: infer P extends z.ZodTypeAny }
  ? P
  : Events[K] extends { schema: infer S extends z.ZodTypeAny }
    ? S
    : z.ZodUnknown;
export type EventPayloadOf<K extends EventName> = z.infer<EventSchema<K>>;

/** The typed API exposed on `window.reelform` by the preload bridge. */
export interface ReelformApi {
  invoke<K extends ChannelName>(channel: K, payload: RequestOf<K>): Promise<ResponseOf<K>>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
  /** On-disk path of a dropped / picked `File` (`webUtils.getPathForFile`); "" when it has none. */
  getPathForFile(file: File): string;
}

export { IPC_ERROR_PREFIX, ReelformIpcError, decodeIpcError, toIpcError } from "./errors";
export { FRAME_USER_PRESETS_MAX } from "../settings/schema";
