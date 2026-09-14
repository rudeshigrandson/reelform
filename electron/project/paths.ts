import * as path from "node:path";
import { FsIpcError, errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";

/** Project directory extension (ENGINEERING_SPEC §4). */
export const PROJECT_EXT = ".reelform";
export const PROJECT_FILE = "project.json";
export const MEDIA_DIR = "media";
export const CACHE_DIR = "cache";
export const EXPORTS_DIR = "exports";
export const BACKUPS_DIR = path.join(CACHE_DIR, "backups");
export const THUMBNAIL_FILE = "thumbnail.jpg";

/** Characters not allowed in a file name on any of the three OSes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what we strip.
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME_LENGTH = 200;

/**
 * Turn a user-typed name into a safe single path segment: illegal characters
 * become spaces, whitespace collapses, trailing dots/spaces (Windows) are
 * trimmed. Returns "" when nothing usable is left.
 */
export function sanitizeName(raw: string): string {
  let s = raw.replace(ILLEGAL_NAME_CHARS, " ").replace(/\s+/g, " ").trim();
  s = s
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "")
    .trim();
  if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH).trim();
  if (WINDOWS_RESERVED.test(s)) s = `${s}_`;
  return s;
}

/** Sanitize or throw INVALID_NAME. */
export function requireName(raw: string): string {
  const s = sanitizeName(raw);
  if (s === "") throw new FsIpcError("INVALID_NAME", `"${raw}" is not a usable name`);
  return s;
}

/**
 * Split `name.ext` into stem and extension. Directory-style extensions like
 * `.reelform` count as extensions; dotfiles (`.env`) have no extension.
 */
export function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

/** `name.mp4`, `name (2).mp4`, `name (3).mp4`, … for collision index `n` (1 = original). */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const { stem, ext } = splitExt(name);
  return `${stem} (${n})${ext}`;
}

/** Hard cap so a broken `exists` can never spin forever. */
const MAX_COLLISIONS = 10_000;

/** First of `name`, `name (2)`, … for which `exists` is false. */
export async function uniqueName(
  name: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; n <= MAX_COLLISIONS; n++) {
    const candidate = numberedName(name, n);
    if (!(await exists(candidate))) return candidate;
  }
  throw new FsIpcError("INVALID_NAME", `Could not find a free name for "${name}"`);
}

export async function pathExists(fs: FsLike, p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (e) {
    if (errnoCode(e) === "ENOENT" || errnoCode(e) === "ENOTDIR") return false;
    throw e;
  }
}

/** True when `child` is `root` itself or lexically inside it. */
export function isWithin(root: string, child: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a project-relative path, rejecting anything that escapes `root`:
 * absolute paths, `..` traversal, NUL bytes, and (when the target or its
 * nearest existing ancestor exists) symlinks pointing outside.
 */
export async function resolveWithin(fs: FsLike, root: string, relative: string): Promise<string> {
  const abs = resolveWithinSync(root, relative);
  const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
  let probe = abs;
  for (;;) {
    let real: string;
    try {
      real = await fs.realpath(probe);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe || !isWithin(root, parent)) break;
      probe = parent;
      continue;
    }
    if (!isWithin(realRoot, real)) {
      throw new FsIpcError("PATH_OUTSIDE_ROOT", "Path escapes the project folder", { relative });
    }
    break;
  }
  return abs;
}

/** Lexical-only variant of {@link resolveWithin}. */
export function resolveWithinSync(root: string, relative: string): string {
  if (relative.includes("\0")) {
    throw new FsIpcError("INVALID_PATH", "Path contains a NUL byte");
  }
  if (relative === "" || path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new FsIpcError("PATH_OUTSIDE_ROOT", "Expected a path relative to the project folder", {
      relative,
    });
  }
  const abs = path.resolve(root, relative);
  if (!isWithin(root, abs) || path.resolve(root) === abs) {
    throw new FsIpcError("PATH_OUTSIDE_ROOT", "Path escapes the project folder", { relative });
  }
  return abs;
}

/** Validate an absolute `.reelform` project directory path from the renderer. */
export function requireProjectPath(p: string): string {
  if (p.includes("\0") || !path.isAbsolute(p)) {
    throw new FsIpcError("INVALID_PATH", "Project path must be absolute", { path: p });
  }
  const resolved = path.resolve(p);
  if (path.extname(resolved).toLowerCase() !== PROJECT_EXT) {
    throw new FsIpcError("INVALID_PATH", `Project folders end in ${PROJECT_EXT}`, { path: p });
  }
  return resolved;
}

/** Validate an absolute path (file or directory) from the renderer. */
export function requireAbsolute(p: string): string {
  if (p.includes("\0") || !path.isAbsolute(p)) {
    throw new FsIpcError("INVALID_PATH", "Path must be absolute", { path: p });
  }
  return path.resolve(p);
}
