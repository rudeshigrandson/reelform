import { z } from "zod";
import type { Channel } from "../ipc/contracts";

/**
 * Project storage channels (ENGINEERING_SPEC §3 `project:*`, §4 save
 * semantics, §9.9 relink). The document itself is opaque here — main treats
 * `project.json` as unknown JSON checked by an injected validator; the model
 * lives in the renderer (`src/editor/model/schema.ts`).
 *
 * Merge into `electron/ipc/contracts.ts` by spreading `projectContracts`.
 */

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

/** Absolute path to a `.reelform` project directory. */
const ProjectPath = z.string().min(1);
const Iso = z.string();

export const MediaProbe = z.object({
  durationMs: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type MediaProbe = z.infer<typeof MediaProbe>;

export const BackupInfo = z.object({ name: z.string(), savedAt: Iso });
export type BackupInfo = z.infer<typeof BackupInfo>;

/** Present when an autosave backup is newer than `project.json` → offer restore. */
export const RecoveryInfo = z.object({
  backupName: z.string(),
  backupSavedAt: Iso,
  /** `null` when project.json is missing or unreadable. */
  projectModifiedAt: Iso.nullable(),
  backups: z.array(BackupInfo),
});
export type RecoveryInfo = z.infer<typeof RecoveryInfo>;

export const ProjectListEntry = z.object({
  path: z.string(),
  name: z.string(),
  modifiedAt: Iso.nullable(),
  thumbnailPath: z.string().nullable(),
  /** In the recents list but the folder is gone. */
  missing: z.boolean(),
  /** Folder exists but project.json is missing or not JSON. */
  corrupt: z.boolean(),
  recent: z.boolean(),
  /** `ProjectV1.id` (editor route param); null when unreadable. */
  id: z.string().nullable().default(null),
  /** `timeline.durationMs`; null when unreadable. */
  durationMs: z.number().nullable().default(null),
});
export type ProjectListEntry = z.infer<typeof ProjectListEntry>;

export const MediaImport = z.object({
  /** Absolute path of a recorded/imported file (e.g. from `recording:finalize`). */
  sourcePath: z.string().min(1),
  /** File name inside `media/` (sanitized; uniquified on collision). */
  fileName: z.string().min(1),
  /** Remove the source after the project is written (default: copy only). */
  move: z.boolean().optional(),
});

const DocumentResult = z.object({
  path: z.string(),
  document: z.unknown(),
  modifiedAt: Iso,
});

export const TrashedProjectEntry = z.object({
  /** Current location inside the library trash folder. */
  path: z.string(),
  name: z.string(),
  id: z.string().nullable(),
  trashedAt: Iso.nullable(),
  thumbnailPath: z.string().nullable(),
});
export type TrashedProjectEntry = z.infer<typeof TrashedProjectEntry>;

/** A timeline clip; extra fields pass through untouched. */
export const TrimClip = z
  .object({
    id: z.string(),
    sourceStartMs: z.number().finite().nonnegative(),
    sourceEndMs: z.number().finite().nonnegative(),
    timelineStartMs: z.number().finite().nonnegative(),
  })
  .passthrough();

const projectRef = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      projectId: z.string().min(1).optional(),
      /** Alternative to `projectId` when the caller holds the folder path. */
      path: ProjectPath.optional(),
      ...shape,
    })
    .refine((r) => r.projectId !== undefined || r.path !== undefined, {
      message: "projectId or path is required",
    });

export const projectMediaContracts = {
  /**
   * §9.9 trim source to used range: `-c copy` cut with 1s handles into `media/`;
   * the original moves to `<project>/.trash/<undoToken>/` until app quit.
   * Clips passed in come back rewritten (source times minus `offsetMs`).
   */
  "project:trimSource": channel(
    "project:trimSource",
    projectRef({
      usedRange: z.object({
        startMs: z.number().finite().nonnegative(),
        endMs: z.number().finite().positive(),
      }),
      /** Project-relative video path; defaults to `sources.video.path` in project.json. */
      videoPath: z.string().min(1).optional(),
      clips: z.array(TrimClip).max(10_000).optional(),
      /**
       * Mic/system/webcam/telemetry share the video's source time. Trimming only
       * the video desyncs them, so it is refused (TRIM_LINKED_TRACKS) unless the
       * caller shifts those tracks by `offsetMs` itself.
       */
      allowLinkedTracks: z.boolean().optional(),
    }),
    z.object({
      clips: z.array(TrimClip),
      /** New project-relative (posix) video path. */
      videoPath: z.string(),
      videoDurationMs: z.number().nonnegative(),
      savedBytes: z.number().int().nonnegative(),
      offsetMs: z.number().nonnegative(),
      undoToken: z.string(),
    }),
  ),
  "project:restoreTrimmedSource": channel(
    "project:restoreTrimmedSource",
    projectRef({ undoToken: z.string().min(1).max(128) }),
    z.object({ ok: z.literal(true), videoPath: z.string() }),
  ),
  /** §6.3: 1080p proxy for sources >1440p or >30 min; progress via `project:proxyProgress`. */
  "project:ensureProxy": channel(
    "project:ensureProxy",
    z.object({ projectId: z.string().min(1) }),
    /** `proxyPath` is project-relative (posix); null when no proxy is needed. */
    z.object({ proxyPath: z.string().nullable(), generated: z.boolean() }),
  ),
  /** §6.7 filmstrip: cached JPEGs every `intervalMs` of source at `height` px. */
  "project:ensureThumbnails": channel(
    "project:ensureThumbnails",
    z.object({
      projectId: z.string().min(1),
      intervalMs: z.number().int().min(250).max(60_000).optional(),
      height: z.number().int().min(16).max(720).optional(),
    }),
    /** `path` is project-relative (posix). */
    z.object({ items: z.array(z.object({ sourceMs: z.number(), path: z.string() })) }),
  ),
} as const;

/** Main → renderer push events of the project domain. */
export const projectEvents = {
  "project:proxyProgress": {
    name: "project:proxyProgress",
    payload: z.object({ projectId: z.string(), progress: z.number().min(0).max(1) }),
  },
} as const;

export const projectContracts = {
  /** Editor windows are routed by project id; main maps it back to a folder (library + recents). */
  "project:resolve": channel(
    "project:resolve",
    z.object({ projectId: z.string().min(1) }),
    z.object({ path: z.string() }),
  ),
  /** Rename the folder (uniquified) and the document `name`. */
  "project:rename": channel(
    "project:rename",
    z.object({ path: ProjectPath, name: z.string().min(1) }),
    DocumentResult,
  ),
  /** Soft delete (launcher "Move to Trash"): moves into the library's `.trash/` folder. */
  "project:moveToTrash": channel(
    "project:moveToTrash",
    z.object({ path: ProjectPath }),
    z.object({ path: z.string() }),
  ),
  "project:listTrash": channel(
    "project:listTrash",
    z.object({}).optional(),
    z.object({ projects: z.array(TrashedProjectEntry) }),
  ),
  /** Move a soft-deleted project back into the library (uniquified name). */
  "project:restoreFromTrash": channel(
    "project:restoreFromTrash",
    z.object({ path: ProjectPath }),
    z.object({ path: z.string() }),
  ),
  /** Drop every autosave backup (user chose "Don't save" / dismissed recovery). */
  "project:discardBackups": channel(
    "project:discardBackups",
    z.object({ path: ProjectPath }),
    z.object({ removed: z.number().int().nonnegative() }),
  ),

  "project:create": channel(
    "project:create",
    z.object({
      name: z.string().min(1),
      /** Defaults to the projects library root. */
      parentDir: z.string().min(1).optional(),
      document: z.unknown(),
      media: z.array(MediaImport).optional(),
    }),
    DocumentResult.extend({
      /** Final `media/` file names, in request order. */
      mediaFiles: z.array(z.string()),
    }),
  ),
  "project:open": channel(
    "project:open",
    z.object({ path: ProjectPath }),
    z.object({
      path: z.string(),
      document: z.unknown(),
      modifiedAt: Iso.nullable(),
      recovery: RecoveryInfo.nullable(),
    }),
  ),
  "project:save": channel(
    "project:save",
    z.object({
      path: ProjectPath,
      document: z.unknown(),
      /** Autosave → write a rotated backup in cache/backups/ instead of project.json. */
      autosave: z.boolean().optional(),
    }),
    z.object({
      path: z.string(),
      modifiedAt: Iso,
      backupName: z.string().nullable(),
    }),
  ),
  "project:saveAs": channel(
    "project:saveAs",
    z.object({
      path: ProjectPath,
      document: z.unknown(),
      name: z.string().min(1),
      /** Defaults to the folder containing the current project. */
      parentDir: z.string().min(1).optional(),
    }),
    DocumentResult,
  ),
  "project:list": channel(
    "project:list",
    z.object({}).optional(),
    z.object({ projects: z.array(ProjectListEntry) }),
  ),
  "project:trash": channel(
    "project:trash",
    z.object({ path: ProjectPath }),
    z.object({ trashed: z.literal(true) }),
  ),
  "project:recovery": channel(
    "project:recovery",
    z.object({ path: ProjectPath }),
    z.object({ recovery: RecoveryInfo.nullable() }),
  ),
  "project:restore": channel(
    "project:restore",
    z.object({
      path: ProjectPath,
      /** Defaults to the newest backup. */
      backupName: z.string().min(1).optional(),
    }),
    DocumentResult.extend({ restoredFrom: z.string() }),
  ),
  "project:relink": channel(
    "project:relink",
    z.object({
      path: ProjectPath,
      /** Absolute path of the replacement file the user picked. */
      filePath: z.string().min(1),
      /** Stored source metadata to validate against (duration ±1s, exact dimensions). */
      expected: z.object({
        durationMs: z.number().nonnegative(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
      /** copy (default) into media/ → relative path; reference → absolute path. */
      mode: z.enum(["copy", "reference"]).optional(),
    }),
    z.object({
      /** New value for the source's `path`: project-relative (posix separators) or absolute. */
      path: z.string(),
      probe: MediaProbe,
    }),
  ),
  ...projectMediaContracts,
} as const;

export type ProjectContracts = typeof projectContracts;

export type ProjectHandlers = {
  [K in keyof ProjectContracts]: (
    req: z.infer<ProjectContracts[K]["request"]>,
  ) => Promise<z.infer<ProjectContracts[K]["response"]>>;
};
