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

export const projectContracts = {
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
} as const;

export type ProjectContracts = typeof projectContracts;

export type ProjectHandlers = {
  [K in keyof ProjectContracts]: (
    req: z.infer<ProjectContracts[K]["request"]>,
  ) => Promise<z.infer<ProjectContracts[K]["response"]>>;
};
