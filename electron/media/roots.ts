import * as nodePath from "node:path";
import { MediaError } from "./errors";
import { isValidRootId } from "./url";

/**
 * Allow-list of directories servable over `reelform-media://` (ENGINEERING_SPEC
 * §2, §13). Project and recording folders register on open and unregister on
 * close; nothing outside a registered root is ever resolvable.
 */

/** Subset of `node:path` the resolver needs (inject `path.win32` in tests). */
export interface PathOps {
  isAbsolute(p: string): boolean;
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}

export interface MediaRoot {
  id: string;
  /** Canonical (realpath'd) absolute directory. */
  realPath: string;
}

export interface MediaRootRegistry {
  add(root: MediaRoot): void;
  remove(id: string): boolean;
  get(id: string): MediaRoot | undefined;
  list(): MediaRoot[];
}

export function createMediaRootRegistry(): MediaRootRegistry {
  const roots = new Map<string, MediaRoot>();
  return {
    add(root) {
      if (!isValidRootId(root.id)) {
        throw new MediaError("MEDIA_INVALID_ROOT_ID", `Invalid media root id: ${root.id}`);
      }
      roots.set(root.id, { ...root });
    },
    remove: (id) => roots.delete(id),
    get: (id) => roots.get(id),
    list: () => [...roots.values()],
  };
}

/** True when `candidate` is `root` itself or lies beneath it (both canonical). */
export function isInsideRoot(root: string, candidate: string, path: PathOps = nodePath): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  // `..` or `../x` escapes; a child literally named `..foo` does not.
  return rel !== ".." && !/^\.\.[\\/]/.test(rel) && !path.isAbsolute(rel);
}

export type ResolveResult =
  | { ok: true; path: string }
  | { ok: false; status: 403 | 404; reason: string };

export interface ResolveDeps {
  registry: MediaRootRegistry;
  /** `fs.promises.realpath`; rejects (ENOENT) for missing files. */
  realpath(p: string): Promise<string>;
  path?: PathOps | undefined;
}

/**
 * Resolve decoded URL segments against a registered root. Lexical containment is
 * checked first; then the real path (symlinks followed) must still be inside the
 * root's real path, so a symlink pointing out of the project is a 403.
 */
export async function resolveMediaPath(
  deps: ResolveDeps,
  rootId: string,
  segments: readonly string[],
): Promise<ResolveResult> {
  const path = deps.path ?? nodePath;
  const root = deps.registry.get(rootId);
  if (!root) return { ok: false, status: 403, reason: "root not registered" };
  if (segments.length === 0)
    return { ok: false, status: 403, reason: "root itself is not servable" };

  const lexical = path.resolve(root.realPath, ...segments);
  if (!isInsideRoot(root.realPath, lexical, path) || lexical === path.resolve(root.realPath)) {
    return { ok: false, status: 403, reason: "path escapes root" };
  }
  let real: string;
  try {
    real = await deps.realpath(lexical);
  } catch {
    return { ok: false, status: 404, reason: "not found" };
  }
  if (!isInsideRoot(root.realPath, real, path)) {
    return { ok: false, status: 403, reason: "symlink escapes root" };
  }
  return { ok: true, path: real };
}
