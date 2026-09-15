import { z } from "zod";
import type { Channel } from "../ipc/contracts";

/**
 * System shell channels (ENGINEERING_SPEC §3 "system (reveal, openExternal,
 * pickFolder, clipboardWriteFile)", §10.7 finalize): reveal a file in the OS
 * file manager, native open/save/folder pickers, and putting a *file* (not its
 * path text) on the clipboard.
 *
 * Merge into `electron/ipc/contracts.ts` by spreading `systemFileContracts`
 * (`system:ping` / `system:openExternal` stay where they are).
 */

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

export const FileFilter = z.object({
  name: z.string().min(1).max(100),
  /** Extensions without the dot; `*` matches everything. */
  extensions: z
    .array(
      z
        .string()
        .min(1)
        .max(16)
        .regex(/^(\*|[A-Za-z0-9]+)$/),
    )
    .min(1)
    .max(32),
});
export type FileFilter = z.infer<typeof FileFilter>;

const absPath = z.string().min(1).max(4096);
const pickedPath = z.object({ path: z.string().nullable() });

export const ClipboardMethod = z.enum(["file-url", "cf-hdrop", "uri-list"]);
export type ClipboardMethod = z.infer<typeof ClipboardMethod>;

export const systemFileContracts = {
  "system:reveal": channel(
    "system:reveal",
    z.object({ path: absPath }),
    z.object({ ok: z.boolean() }),
  ),
  "system:pickFile": channel(
    "system:pickFile",
    z.object({
      filters: z.array(FileFilter).max(16).optional(),
      title: z.string().max(200).optional(),
    }),
    pickedPath,
  ),
  "system:pickFolder": channel(
    "system:pickFolder",
    z
      .object({
        title: z.string().max(200).optional(),
        defaultPath: absPath.optional(),
      })
      .optional(),
    pickedPath,
  ),
  "system:saveDialog": channel(
    "system:saveDialog",
    z.object({
      defaultName: z.string().min(1).max(255),
      filters: z.array(FileFilter).max(16).optional(),
      defaultDir: absPath.optional(),
    }),
    pickedPath,
  ),
  "system:clipboardWriteFile": channel(
    "system:clipboardWriteFile",
    z.object({ path: absPath }),
    z.object({ ok: z.boolean(), method: ClipboardMethod }),
  ),
} as const;

export type SystemFileContracts = typeof systemFileContracts;

export type SystemFileHandlers = {
  [K in keyof SystemFileContracts]: (
    req: z.infer<SystemFileContracts[K]["request"]>,
  ) => Promise<z.infer<SystemFileContracts[K]["response"]>>;
};

export type SystemFileRequest<K extends keyof SystemFileContracts> = z.infer<
  SystemFileContracts[K]["request"]
>;
export type SystemFileResponse<K extends keyof SystemFileContracts> = z.infer<
  SystemFileContracts[K]["response"]
>;

/**
 * Project-folder file access for the editor inspector (SPEC §9.4 webcam import,
 * §9.5 extra audio, §9.6 SRT/VTT import/export, §9.9 source sizes). Imports are
 * confined to `<project>/media/imported/<kind>/`; project-relative lookups may
 * not escape the project folder.
 */
export const ImportKind = z.enum(["webcam", "audio", "image"]);
export type ImportKind = z.infer<typeof ImportKind>;

export const systemProjectFileContracts = {
  "system:readTextFile": channel(
    "system:readTextFile",
    z.object({ path: absPath }),
    z.object({ text: z.string() }),
  ),
  "system:writeTextFile": channel(
    "system:writeTextFile",
    z.object({ path: absPath, contents: z.string().max(50_000_000) }),
    z.object({ ok: z.literal(true) }),
  ),
  "system:copyIntoProject": channel(
    "system:copyIntoProject",
    z.object({ projectPath: absPath, kind: ImportKind, sourcePath: absPath }),
    /** Project-relative, posix separators. */
    z.object({ relPath: z.string().min(1) }),
  ),
  "system:statFiles": channel(
    "system:statFiles",
    z.object({
      projectPath: absPath,
      relPaths: z.array(z.string().min(1).max(4096)).max(500),
    }),
    /** null = missing; an absent key = unknown (e.g. rejected path). */
    z.object({ stats: z.record(z.object({ sizeBytes: z.number().nonnegative() }).nullable()) }),
  ),
} as const;

export type SystemProjectFileContracts = typeof systemProjectFileContracts;

export type SystemProjectFileHandlers = {
  [K in keyof SystemProjectFileContracts]: (
    req: z.infer<SystemProjectFileContracts[K]["request"]>,
  ) => Promise<z.infer<SystemProjectFileContracts[K]["response"]>>;
};
