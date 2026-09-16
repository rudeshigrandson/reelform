import { z } from "zod";
import type { Channel } from "../ipc/contracts";
import { TelemetryFile } from "../recording/telemetry";

/**
 * `telemetry:read` (ENGINEERING_SPEC §3): decode a `telemetry.json.gz` into a
 * validated {@link TelemetryFile}. Addressed either by an absolute path (a
 * fresh recording's `TelemetryRef.path`) or by a project id plus the
 * project-relative `sources.telemetry` ref. Pure zod: safe for the renderer.
 */

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

export const TelemetryReadRequest = z.union([
  z.object({ path: z.string().min(1) }).strict(),
  z.object({
    projectId: z.string().min(1),
    /** `sources.telemetry` from the document; `path` is relative to the project dir. */
    ref: z.object({ path: z.string().min(1) }).passthrough(),
  }),
]);
export type TelemetryReadRequest = z.infer<typeof TelemetryReadRequest>;

export const telemetryContracts = {
  "telemetry:read": channel("telemetry:read", TelemetryReadRequest, TelemetryFile),
} as const;

export type TelemetryErrorCode =
  | "TELEMETRY_PATH_FORBIDDEN"
  | "TELEMETRY_NOT_FOUND"
  | "TELEMETRY_CORRUPT"
  | "TELEMETRY_INVALID";
