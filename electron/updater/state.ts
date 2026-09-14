import { z } from "zod";

/**
 * Updater state machine (ENGINEERING_SPEC §11). Pure reducer so transitions
 * are testable without electron-updater.
 *
 *   idle ─check→ checking ─available→ available ─progress→ downloading ─downloaded→ downloaded
 *     ▲             │ not-available                                  │ error
 *     └─────────────┘                    error ← (any in-flight phase)
 *
 * `downloaded` is sticky: later checks and their errors never hide a pending
 * "Restart to update".
 */

export const UpdateChannelSchema = z.enum(["stable", "beta"]);
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;

export const UpdatePhaseSchema = z.enum([
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "error",
]);
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>;

export const UpdateInfoSchema = z.object({
  version: z.string(),
  releaseName: z.string().nullable(),
  releaseDate: z.string().nullable(),
  /** GitHub release body as provided by electron-updater (HTML); renderer must sanitize. */
  releaseNotes: z.string().nullable(),
});
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>;

export const UpdateProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  bytesPerSecond: z.number().min(0),
  transferred: z.number().min(0),
  total: z.number().min(0),
});
export type UpdateProgress = z.infer<typeof UpdateProgressSchema>;

export const UpdaterStateSchema = z.object({
  phase: UpdatePhaseSchema,
  currentVersion: z.string(),
  channel: UpdateChannelSchema,
  info: UpdateInfoSchema.nullable(),
  progress: UpdateProgressSchema.nullable(),
  error: z.string().nullable(),
  /** Epoch ms of the last completed check (injected clock). */
  lastCheckedAt: z.number().nullable(),
});
export type UpdaterState = z.infer<typeof UpdaterStateSchema>;

export type UpdaterEvent =
  | { type: "checking" }
  | { type: "not-available"; at: number }
  | { type: "available"; info: UpdateInfo; at: number }
  | { type: "progress"; progress: UpdateProgress }
  | { type: "downloaded"; info: UpdateInfo }
  | { type: "error"; message: string }
  | { type: "channel"; channel: UpdateChannel };

export function initialUpdaterState(currentVersion: string, channel: UpdateChannel): UpdaterState {
  return {
    phase: "idle",
    currentVersion,
    channel,
    info: null,
    progress: null,
    error: null,
    lastCheckedAt: null,
  };
}

const clampProgress = (p: UpdateProgress): UpdateProgress => {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    percent: Math.min(100, n(p.percent)),
    bytesPerSecond: n(p.bytesPerSecond),
    transferred: n(p.transferred),
    total: n(p.total),
  };
};

export function reduceUpdater(state: UpdaterState, event: UpdaterEvent): UpdaterState {
  const downloaded = state.phase === "downloaded";
  switch (event.type) {
    case "channel":
      return { ...state, channel: event.channel };
    case "checking":
      if (downloaded || state.phase === "downloading" || state.phase === "checking") return state;
      return { ...state, phase: "checking", error: null };
    case "not-available":
      if (downloaded || state.phase === "downloading") return { ...state, lastCheckedAt: event.at };
      return {
        ...state,
        phase: "idle",
        info: null,
        progress: null,
        error: null,
        lastCheckedAt: event.at,
      };
    case "available":
      if (downloaded) return { ...state, lastCheckedAt: event.at };
      if (state.phase === "downloading")
        return { ...state, info: event.info, lastCheckedAt: event.at };
      return {
        ...state,
        phase: "available",
        info: event.info,
        progress: null,
        error: null,
        lastCheckedAt: event.at,
      };
    case "progress":
      if (downloaded) return state;
      return {
        ...state,
        phase: "downloading",
        progress: clampProgress(event.progress),
        error: null,
      };
    case "downloaded":
      return {
        ...state,
        phase: "downloaded",
        info: event.info,
        progress: state.progress ? { ...state.progress, percent: 100 } : null,
        error: null,
      };
    case "error":
      if (downloaded) return state;
      return { ...state, phase: "error", progress: null, error: event.message };
  }
}

/** electron-updater `releaseNotes`: string | {version, note}[] | null → one string. */
export function normalizeReleaseNotes(notes: unknown): string | null {
  if (typeof notes === "string") return notes;
  if (!Array.isArray(notes)) return null;
  const parts = notes
    .map((n: unknown) => {
      if (typeof n !== "object" || n === null) return null;
      const { version, note } = n as { version?: unknown; note?: unknown };
      if (typeof note !== "string" || note === "") return null;
      return typeof version === "string" ? `<h3>${version}</h3>\n${note}` : note;
    })
    .filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join("\n") : null;
}

/** electron-updater `UpdateInfo` (loosely typed) → our summary. */
export function toUpdateInfo(raw: unknown): UpdateInfo {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    version: str(o.version) ?? "unknown",
    releaseName: str(o.releaseName),
    releaseDate: str(o.releaseDate),
    releaseNotes: normalizeReleaseNotes(o.releaseNotes),
  };
}
