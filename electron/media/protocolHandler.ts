import { mimeForPath } from "./mime";
import { parseRange } from "./range";
import { type ResolveDeps, resolveMediaPath } from "./roots";
import { parseMediaUrl } from "./url";

/**
 * Pure request handler for the `reelform-media://` protocol (ENGINEERING_SPEC
 * §2): URL → allow-listed file → 200 / 206 / 4xx with range support so
 * `<video>` and fetch-based demuxers can seek. The Electron adapter turns the
 * result into a web `Response`; bytes come from an injected stream factory.
 */

/** The parts of a web `Request` the handler reads. */
export interface MediaRequest {
  url: string;
  method: string;
  headers: { get(name: string): string | null };
}

export interface MediaFileStat {
  size: number;
  isFile: boolean;
}

export interface MediaProtocolDeps<Body> extends ResolveDeps {
  stat(path: string): Promise<MediaFileStat>;
  /** Stream bytes `start..end` inclusive (same semantics as `fs.createReadStream`). */
  createReadStream(path: string, start: number, end: number): Body;
}

export interface MediaResponse<Body> {
  status: 200 | 206 | 400 | 403 | 404 | 405 | 416;
  headers: Record<string, string>;
  /** Null for errors, HEAD, and empty files. */
  body: Body | null;
}

const BASE_HEADERS = {
  "Accept-Ranges": "bytes",
  // Renderer origins (dev server / file) fetch cross-scheme; expose range headers.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  "Cache-Control": "no-store",
} as const;

function error<Body>(
  status: MediaResponse<Body>["status"],
  extra: Record<string, string> = {},
): MediaResponse<Body> {
  return { status, headers: { ...BASE_HEADERS, "Content-Length": "0", ...extra }, body: null };
}

export function createMediaProtocolHandler<Body>(
  deps: MediaProtocolDeps<Body>,
): (req: MediaRequest) => Promise<MediaResponse<Body>> {
  return async (req) => {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return error(405, { Allow: "GET, HEAD" });

    const parsed = parseMediaUrl(req.url);
    if (!parsed.ok) return error(parsed.reason === "traversal" ? 403 : 400);

    const resolved = await resolveMediaPath(deps, parsed.rootId, parsed.segments);
    if (!resolved.ok) return error(resolved.status);

    let stat: MediaFileStat;
    try {
      stat = await deps.stat(resolved.path);
    } catch {
      return error(404);
    }
    if (!stat.isFile) return error(404);

    const size = Math.max(0, Math.floor(stat.size));
    const contentType = mimeForPath(resolved.path);
    const range = parseRange(req.headers.get("range"), size);

    if (range.kind === "unsatisfiable") {
      return error(416, { "Content-Range": `bytes */${size}` });
    }

    const head = method === "HEAD";
    if (range.kind === "none") {
      return {
        status: 200,
        headers: { ...BASE_HEADERS, "Content-Type": contentType, "Content-Length": String(size) },
        body: head || size === 0 ? null : deps.createReadStream(resolved.path, 0, size - 1),
      };
    }

    const { start, end } = range;
    return {
      status: 206,
      headers: {
        ...BASE_HEADERS,
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: head ? null : deps.createReadStream(resolved.path, start, end),
    };
  };
}
