import { z } from "zod";
import { type LogEntry, formatLogEntry } from "./logger";
import { type Scrubber, scrubValue } from "./scrub";

/**
 * "Copy diagnostics" bundle (design guide S24 About; ENGINEERING_SPEC §13).
 * Everything is injected; the result is plain JSON with paths and the user
 * name scrubbed and path-valued settings removed.
 */

export const DIAGNOSTICS_FORMAT_VERSION = 1;

export const DiagnosticsBundleSchema = z.object({
  format: z.literal(DIAGNOSTICS_FORMAT_VERSION),
  createdAt: z.string(),
  app: z.object({
    name: z.string(),
    version: z.string(),
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
    packaged: z.boolean(),
  }),
  os: z.object({
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    locale: z.string(),
    totalMemoryMb: z.number(),
  }),
  gpu: z.unknown(),
  settings: z.record(z.unknown()),
  logs: z.array(z.string()),
});
export type DiagnosticsBundle = z.infer<typeof DiagnosticsBundleSchema>;

export interface DiagnosticsInput {
  app: DiagnosticsBundle["app"];
  os: DiagnosticsBundle["os"];
  /** e.g. `app.getGPUFeatureStatus()` / `app.getGPUInfo("basic")`. */
  gpu: unknown;
  settings: Readonly<Record<string, unknown>>;
  logs: readonly LogEntry[];
}

export interface BuildDiagnosticsOptions {
  now: () => number;
  scrub: Scrubber;
  /** Settings keys holding filesystem paths — omitted entirely. */
  pathKeys?: readonly string[] | undefined;
  /** Most recent log lines to include. */
  maxLogLines?: number | undefined;
}

export const DEFAULT_DIAGNOSTICS_LOG_LINES = 500;

export function buildDiagnosticsBundle(
  input: DiagnosticsInput,
  opts: BuildDiagnosticsOptions,
): DiagnosticsBundle {
  const pathKeys = new Set(opts.pathKeys ?? ["recordingsFolder"]);
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.settings)) {
    if (!pathKeys.has(k)) settings[k] = scrubValue(v, opts.scrub);
  }
  const max = Math.max(0, opts.maxLogLines ?? DEFAULT_DIAGNOSTICS_LOG_LINES);
  const logs = max === 0 ? [] : input.logs.slice(-max);

  return {
    format: DIAGNOSTICS_FORMAT_VERSION,
    createdAt: new Date(opts.now()).toISOString(),
    app: scrubValue(input.app, opts.scrub) as DiagnosticsBundle["app"],
    os: scrubValue(input.os, opts.scrub) as DiagnosticsBundle["os"],
    gpu: scrubValue(input.gpu, opts.scrub),
    settings,
    // Entries are scrubbed at log time; scrub again in case of a custom sink/buffer.
    logs: logs.map((e) => opts.scrub(formatLogEntry(e))),
  };
}

export const serializeDiagnostics = (bundle: DiagnosticsBundle): string =>
  JSON.stringify(bundle, null, 2);
