import type { FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { FsIpcError, errnoCode } from "../project/errors";
import type { FsLike } from "../project/fsTypes";
import { pathExists, requireAbsolute, requireName, uniqueName } from "../project/paths";
import type { ExportHandlers } from "./contracts";

export interface ExportDeps {
  fs: FsLike;
  /** Unique id for a new export (e.g. `crypto.randomUUID`). */
  newId: () => string;
  /** Absolute default destination for a project (its `exports/` folder). */
  defaultExportDir: (projectId: string) => Promise<string>;
}

type Entry =
  | {
      state: "open";
      dir: string;
      tempPath: string;
      handle: FileHandle;
      /** Next append offset = furthest byte written so far. */
      size: number;
      /** Serializes writes so chunks land in arrival order. */
      chain: Promise<void>;
      writeError: FsIpcError | null;
      closing: Promise<unknown> | null;
    }
  | { state: "finished"; path: string }
  | { state: "cancelled" }
  | { state: "failed"; error: FsIpcError };

type OpenEntry = Extract<Entry, { state: "open" }>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const tempFileName = (exportId: string): string => `.reelform-export-${exportId}.partial`;

const toBytes = (chunk: ArrayBuffer | Uint8Array): Uint8Array =>
  chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

export interface ExportService {
  handlers: ExportHandlers;
  /** Cancel every open export (app quit / window closed). */
  cancelAll(): Promise<void>;
  /** Ids of exports still accepting chunks. */
  openExportIds(): string[];
}

export function createExportService(deps: ExportDeps): ExportService {
  const { fs } = deps;
  const entries = new Map<string, Entry>();

  const lookup = (exportId: string): Entry => {
    const e = entries.get(exportId);
    if (!e) throw new FsIpcError("EXPORT_NOT_FOUND", "Unknown export", { exportId });
    return e;
  };

  const discard = async (e: OpenEntry): Promise<void> => {
    await e.chain.catch(() => undefined);
    await e.handle.close().catch(() => undefined);
    await fs.rm(e.tempPath, { force: true }).catch(() => undefined);
  };

  const finish = async (exportId: string, e: OpenEntry, finalName: string): Promise<string> => {
    try {
      await e.chain;
      if (e.writeError) throw e.writeError;
      await e.handle.sync();
      await e.handle.close();
    } catch (err) {
      const error =
        err instanceof FsIpcError
          ? err
          : new FsIpcError("EXPORT_WRITE_FAILED", "Could not finalize the export", {
              errno: errnoCode(err),
            });
      await discard(e);
      entries.set(exportId, { state: "failed", error });
      throw error;
    }
    try {
      const name = await uniqueName(finalName, (c) => pathExists(fs, path.join(e.dir, c)));
      const finalPath = path.join(e.dir, name);
      await fs.rename(e.tempPath, finalPath);
      entries.set(exportId, { state: "finished", path: finalPath });
      return finalPath;
    } catch (err) {
      const error =
        err instanceof FsIpcError
          ? err
          : new FsIpcError("EXPORT_WRITE_FAILED", "Could not move the export into place", {
              errno: errnoCode(err),
            });
      await fs.rm(e.tempPath, { force: true }).catch(() => undefined);
      entries.set(exportId, { state: "failed", error });
      throw error;
    }
  };

  const handlers: ExportHandlers = {
    "export:begin": async (req) => {
      const dir = req.config.destinationDir
        ? requireAbsolute(req.config.destinationDir)
        : requireAbsolute(await deps.defaultExportDir(req.projectId));
      const exportId = deps.newId();
      if (!SAFE_ID.test(exportId) || entries.has(exportId)) {
        throw new Error(`newId() returned an unusable id: ${exportId}`);
      }
      await fs.mkdir(dir, { recursive: true });
      const tempPath = path.join(dir, tempFileName(exportId));
      const handle = await fs.open(tempPath, "w");
      entries.set(exportId, {
        state: "open",
        dir,
        tempPath,
        handle,
        size: 0,
        chain: Promise.resolve(),
        writeError: null,
        closing: null,
      });
      return { exportId, tempPath };
    },

    "export:writeChunk": async (req) => {
      const e = lookup(req.exportId);
      if (e.state === "cancelled") {
        throw new FsIpcError("EXPORT_CANCELLED", "Export was cancelled", {
          exportId: req.exportId,
        });
      }
      if (e.state !== "open" || e.closing) {
        throw new FsIpcError("EXPORT_CLOSED", "Export is no longer accepting data", {
          exportId: req.exportId,
        });
      }
      const bytes = toBytes(req.chunk);
      const run = e.chain.then(async () => {
        if (e.writeError) throw e.writeError;
        const position = req.position ?? e.size;
        let offset = 0;
        try {
          while (offset < bytes.byteLength) {
            const { bytesWritten } = await e.handle.write(
              bytes,
              offset,
              bytes.byteLength - offset,
              position + offset,
            );
            if (bytesWritten <= 0) throw new Error("Short write");
            offset += bytesWritten;
          }
        } catch (err) {
          e.writeError = new FsIpcError("EXPORT_WRITE_FAILED", "Writing the export failed", {
            errno: errnoCode(err),
          });
          throw e.writeError;
        }
        e.size = Math.max(e.size, position + bytes.byteLength);
        return { bytesWritten: bytes.byteLength, size: e.size };
      });
      e.chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    "export:finish": async (req) => {
      const e = lookup(req.exportId);
      switch (e.state) {
        case "finished":
          return { path: e.path };
        case "cancelled":
          throw new FsIpcError("EXPORT_CANCELLED", "Export was cancelled", {
            exportId: req.exportId,
          });
        case "failed":
          throw e.error;
      }
      if (e.closing) {
        await e.closing.catch(() => undefined);
        return handlers["export:finish"](req);
      }
      // Validate the name before closing so a bad name doesn't kill the export.
      const finalName = requireName(req.finalName);
      const p = finish(req.exportId, e, finalName);
      e.closing = p;
      return { path: await p };
    },

    "export:cancel": async (req) => {
      const e = lookup(req.exportId);
      if (e.state !== "open") return { cancelled: false };
      if (e.closing) {
        await e.closing.catch(() => undefined);
        return { cancelled: false };
      }
      const p = discard(e).then(() => {
        entries.set(req.exportId, { state: "cancelled" });
      });
      e.closing = p;
      await p;
      return { cancelled: true };
    },
  };

  return {
    handlers,
    openExportIds: () =>
      [...entries].filter(([, e]) => e.state === "open" && !e.closing).map(([id]) => id),
    cancelAll: async () => {
      const ids = [...entries].filter(([, e]) => e.state === "open").map(([id]) => id);
      await Promise.all(ids.map((exportId) => handlers["export:cancel"]({ exportId })));
    },
  };
}

/** Handler map only (convention used by the IPC registry). */
export function createExportHandlers(deps: ExportDeps): ExportHandlers {
  return createExportService(deps).handlers;
}
