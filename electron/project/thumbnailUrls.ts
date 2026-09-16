import { createHash } from "node:crypto";
import type { MediaRoot } from "../media/roots";
import { toMediaUrl } from "../media/url";
import { THUMBNAIL_FILE } from "./paths";

/**
 * Renderer-loadable thumbnail URLs for `project:list` / `project:listTrash`.
 * Each project folder is allow-listed on the `reelform-media://` registry under
 * a stable id derived from its real path (the same folders a renderer may
 * already register via `media:registerRoot`), and the URL carries the
 * thumbnail's mtime so a re-generated thumbnail is not served from cache.
 */

export type ThumbnailUrlResolver = (projectDir: string, mtimeMs: number) => Promise<string | null>;

export interface ThumbnailUrlDeps {
  registry: { add(root: MediaRoot): void; get(id: string): MediaRoot | undefined };
  /** `fs.promises.realpath`. */
  realpath: (p: string) => Promise<string>;
}

/** Stable, DNS-label-safe root id for a project folder. */
export function projectRootId(realDir: string): string {
  return `p-${createHash("sha256").update(realDir).digest("hex").slice(0, 16)}`;
}

export function createThumbnailUrlResolver(deps: ThumbnailUrlDeps): ThumbnailUrlResolver {
  return async (projectDir, mtimeMs) => {
    const realPath = await deps.realpath(projectDir);
    const id = projectRootId(realPath);
    if (deps.registry.get(id)?.realPath !== realPath) deps.registry.add({ id, realPath });
    return `${toMediaUrl(id, THUMBNAIL_FILE)}?v=${Math.round(mtimeMs)}`;
  };
}
