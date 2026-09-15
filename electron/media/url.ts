/**
 * `reelform-media://<rootId>/<relative/path>` URL shape (ENGINEERING_SPEC §2).
 *
 * The host is a registered root id (lower-case, since the scheme is registered
 * as `standard` and Chromium lower-cases hosts); the path is the file relative
 * to that root, one percent-encoded segment per directory level.
 */

export const MEDIA_SCHEME = "reelform-media";

const ROOT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Root ids double as URL hosts, so they must be DNS-label-like. */
export function isValidRootId(id: string): boolean {
  return ROOT_ID.test(id);
}

/** Base URL (trailing slash) for a root. */
export function mediaRootUrl(rootId: string): string {
  return `${MEDIA_SCHEME}://${rootId}/`;
}

/** Build a media URL for a root-relative path (either separator accepted). */
export function toMediaUrl(rootId: string, relativePath: string): string {
  const segments = relativePath.split(/[\\/]+/).filter((s) => s !== "");
  return mediaRootUrl(rootId) + segments.map(encodeURIComponent).join("/");
}

export type ParsedMediaUrl =
  | { ok: true; rootId: string; segments: string[] }
  | { ok: false; reason: "malformed" | "traversal" };

/**
 * Split a media URL into its root id and decoded path segments. Any segment that
 * decodes to `.`/`..` or smuggles a separator or NUL is rejected as traversal —
 * the resolver additionally checks the real path, this is the cheap first gate.
 */
export function parseMediaUrl(raw: string): ParsedMediaUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (url.protocol !== `${MEDIA_SCHEME}:`) return { ok: false, reason: "malformed" };
  const rootId = url.hostname.toLowerCase();
  if (!isValidRootId(rootId)) return { ok: false, reason: "malformed" };

  // Inspect the raw path too: WHATWG URL silently folds `..` segments away.
  const rawPath = raw
    .slice(raw.indexOf("//") + 2)
    .replace(/^[^/?#]*/, "")
    .replace(/[?#].*$/, "");
  const segments: string[] = [];
  for (const part of rawPath.split("/")) {
    if (part === "") continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (decoded === "." || decoded === ".." || /[\\/\0]/.test(decoded)) {
      return { ok: false, reason: "traversal" };
    }
    segments.push(decoded);
  }
  return { ok: true, rootId, segments };
}
