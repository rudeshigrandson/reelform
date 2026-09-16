import * as path from "node:path";
import type { ClipboardMethod, FileFilter, SystemFileHandlers } from "./contracts";
import type { PickedPathRegistry } from "./pickedPaths";

/**
 * System shell handlers (§3 system domain, §10.7 finalize). Electron-free: the
 * adapter injects `shell` / `dialog` / `clipboard` shaped functions so every
 * branch is testable in node.
 */

export type SystemErrorCode = "INVALID_PATH" | "FILE_NOT_FOUND" | "CLIPBOARD_FAILED";

/** IpcError-shaped failure (`code` crosses IPC → ReelformIpcError). */
export class SystemIpcError extends Error {
  override name = "SystemIpcError";
  constructor(
    readonly code: SystemErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface OpenDialogOptionsLike {
  title?: string | undefined;
  defaultPath?: string | undefined;
  filters?: FileFilter[] | undefined;
  properties: ("openFile" | "openDirectory" | "createDirectory")[];
}

export interface SaveDialogOptionsLike {
  defaultPath: string;
  filters?: FileFilter[] | undefined;
}

export interface SystemDeps {
  /** `process.platform`. */
  platform: string;
  pathExists(p: string): Promise<boolean>;
  showItemInFolder(p: string): void;
  showOpenDialog(
    options: OpenDialogOptionsLike,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    options: SaveDialogOptionsLike,
  ): Promise<{ canceled: boolean; filePath?: string | undefined }>;
  /** `clipboard.writeBuffer(format, Buffer)`; replaces the clipboard contents. */
  clipboardWriteBuffer(format: string, bytes: Uint8Array): void;
  /** Default folder for save dialogs without `defaultDir` (e.g. Videos). */
  defaultSaveDir?: (() => string) | undefined;
  /** Records files chosen in open/save dialogs so text I/O may touch them (§13). */
  pickedPaths?: PickedPathRegistry | undefined;
}

const pathApi = (platform: string): path.PlatformPath =>
  platform === "win32" ? path.win32 : path.posix;

function requireAbsolute(p: string, platform: string): string {
  const api = pathApi(platform);
  if (!api.isAbsolute(p) || p.includes("\0")) {
    throw new SystemIpcError("INVALID_PATH", "Path must be absolute", { path: p });
  }
  return api.normalize(p);
}

async function requireExisting(deps: SystemDeps, p: string): Promise<string> {
  const abs = requireAbsolute(p, deps.platform);
  if (!(await deps.pathExists(abs))) {
    throw new SystemIpcError("FILE_NOT_FOUND", "File does not exist", { path: abs });
  }
  return abs;
}

/** `file://` URL for an absolute path on `platform` (percent-encoded segments). */
export function fileUrlFor(absPath: string, platform: string): string {
  const slashed = platform === "win32" ? absPath.replace(/\\/g, "/") : absPath;
  const segments = slashed.split("/").map((seg, i) =>
    // Keep a Windows drive letter ("C:") intact.
    platform === "win32" && i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg),
  );
  const joined = segments.join("/");
  return `file://${joined.startsWith("/") ? "" : "/"}${joined}`;
}

/**
 * Win32 `DROPFILES` struct followed by a double-NUL-terminated UTF-16LE path
 * list — the payload of the CF_HDROP clipboard format.
 */
export function dropFilesBuffer(paths: readonly string[]): Uint8Array {
  const HEADER = 20;
  const units = paths.reduce((n, p) => n + p.length + 1, 0) + 1;
  const buf = new Uint8Array(HEADER + units * 2);
  const view = new DataView(buf.buffer);
  view.setUint32(0, HEADER, true); // pFiles
  view.setInt32(4, 0, true); // pt.x
  view.setInt32(8, 0, true); // pt.y
  view.setInt32(12, 0, true); // fNC
  view.setInt32(16, 1, true); // fWide → UTF-16
  let o = HEADER;
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) {
      view.setUint16(o, p.charCodeAt(i), true);
      o += 2;
    }
    o += 2; // NUL terminator (already zero)
  }
  return buf;
}

/**
 * Clipboard format + bytes for a file on each platform.
 * - macOS: `public.file-url` (what NSPasteboard writes for a Finder copy).
 * - Windows: `CF_HDROP`. Electron registers named formats with
 *   `RegisterClipboardFormat`, so Explorer may not treat it as the predefined
 *   CF_HDROP (id 15); unverified here — the UI falls back to "path copied".
 * - Linux: `text/uri-list` (GNOME/KDE file managers paste it as a file).
 */
export function clipboardPayload(
  absPath: string,
  platform: string,
): { format: string; bytes: Uint8Array; method: ClipboardMethod } {
  if (platform === "darwin") {
    return {
      format: "public.file-url",
      bytes: new TextEncoder().encode(fileUrlFor(absPath, platform)),
      method: "file-url",
    };
  }
  if (platform === "win32") {
    return { format: "CF_HDROP", bytes: dropFilesBuffer([absPath]), method: "cf-hdrop" };
  }
  return {
    format: "text/uri-list",
    bytes: new TextEncoder().encode(`${fileUrlFor(absPath, platform)}\r\n`),
    method: "uri-list",
  };
}

export function createSystemFileHandlers(deps: SystemDeps): SystemFileHandlers {
  return {
    "system:reveal": async (req) => {
      const abs = await requireExisting(deps, req.path);
      deps.showItemInFolder(abs);
      return { ok: true };
    },

    "system:pickFile": async (req) => {
      const res = await deps.showOpenDialog({
        title: req.title,
        filters: req.filters,
        properties: ["openFile"],
      });
      const picked = res.canceled ? null : (res.filePaths[0] ?? null);
      if (picked) deps.pickedPaths?.add(picked);
      return { path: picked };
    },

    "system:pickFolder": async (req) => {
      const res = await deps.showOpenDialog({
        title: req?.title,
        defaultPath: req?.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
      return { path: res.canceled ? null : (res.filePaths[0] ?? null) };
    },

    "system:saveDialog": async (req) => {
      const name = pathApi(deps.platform).basename(req.defaultName);
      const dir = req.defaultDir ?? deps.defaultSaveDir?.();
      const defaultPath = dir ? pathApi(deps.platform).join(dir, name) : name;
      const res = await deps.showSaveDialog({ defaultPath, filters: req.filters });
      const picked = res.canceled || !res.filePath ? null : res.filePath;
      if (picked) deps.pickedPaths?.add(picked);
      return { path: picked };
    },

    "system:clipboardWriteFile": async (req) => {
      const abs = await requireExisting(deps, req.path);
      const payload = clipboardPayload(abs, deps.platform);
      try {
        deps.clipboardWriteBuffer(payload.format, payload.bytes);
      } catch (e) {
        throw new SystemIpcError("CLIPBOARD_FAILED", "Could not write to the clipboard", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return { ok: true, method: payload.method };
    },
  };
}
