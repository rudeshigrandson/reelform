import { z } from "zod";
import { MODEL_IDS } from "./models";

/**
 * Captions domain IPC channels (ENGINEERING_SPEC §3, §9.6). Shape matches
 * `Channel` in `electron/ipc/contracts.ts`; the orchestrator merges these into
 * the central contract map. Long work reports through `captions:progress`.
 */

export const ModelIdSchema = z.enum(MODEL_IDS);

export const ModelInfoSchema = z.object({
  id: ModelIdSchema,
  tier: z.enum(["fast", "balanced", "accurate"]),
  label: z.string(),
  displaySize: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  installed: z.boolean(),
  /** Bytes of a resumable partial download on disk (0 when none). */
  partialBytes: z.number().int().nonnegative(),
  downloading: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

const WordSchema = z.object({ t0: z.number(), t1: z.number(), text: z.string() });

export const CaptionSchema = z.object({
  id: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
  words: z.array(WordSchema),
});

const AudioRangeSchema = z
  .object({
    startMs: z.number().finite().nonnegative(),
    endMs: z.number().finite().nonnegative(),
    rate: z.number().finite().positive().optional(),
  })
  .refine((r) => r.endMs > r.startMs, { message: "endMs must be greater than startMs" });

export const captionsContracts = {
  "captions:models": {
    name: "captions:models",
    request: z.void(),
    response: z.array(ModelInfoSchema),
  },
  /** Resolves when the model is installed; progress via `captions:progress` (taskId = model). */
  "captions:download": {
    name: "captions:download",
    request: z.object({ model: ModelIdSchema }),
    response: z.object({
      model: ModelIdSchema,
      path: z.string(),
      verified: z.boolean(),
      alreadyInstalled: z.boolean(),
    }),
  },
  /** Aborts an in-flight download; the partial is kept so the next download resumes. */
  "captions:cancelDownload": {
    name: "captions:cancelDownload",
    request: z.object({ model: ModelIdSchema }),
    response: z.object({ cancelled: z.boolean() }),
  },
  "captions:transcribe": {
    name: "captions:transcribe",
    request: z.object({
      /** Caller-chosen id echoed as `taskId` in progress events. */
      jobId: z.string().min(1),
      /** Absolute path of the chosen audio candidate (mic, else system, else video). */
      audio: z.object({ path: z.string().min(1) }),
      /** Source ranges in timeline order (after trims/speeds). */
      ranges: z.array(AudioRangeSchema).min(1),
      model: ModelIdSchema,
      /** Whisper language code or "auto". */
      language: z
        .string()
        .regex(/^(auto|[a-z]{2,3})$/)
        .optional(),
    }),
    response: z.object({
      captions: z.array(CaptionSchema),
      language: z.string().nullable(),
      durationMs: z.number().nonnegative(),
    }),
  },
} as const;

export type CaptionsContracts = typeof captionsContracts;

export const CaptionsProgressSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("download"),
    taskId: z.string(),
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative().nullable(),
    /** 0–1, null when the size is unknown. */
    progress: z.number().min(0).max(1).nullable(),
  }),
  z.object({
    kind: z.literal("transcribe"),
    taskId: z.string(),
    stage: z.enum(["extracting", "transcribing", "segmenting"]),
    progress: z.number().min(0).max(1),
    doneMs: z.number().nonnegative(),
    totalMs: z.number().nonnegative(),
  }),
]);
export type CaptionsProgress = z.infer<typeof CaptionsProgressSchema>;

export const captionsEvents = {
  "captions:progress": { name: "captions:progress", payload: CaptionsProgressSchema },
} as const;

export type CaptionsEvents = typeof captionsEvents;
