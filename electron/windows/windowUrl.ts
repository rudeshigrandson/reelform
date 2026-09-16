import { type WindowParams, isWindowKind } from "./windowKinds";

/**
 * Where a window's renderer is loaded from: the Vite dev server in dev, the
 * built `index.html` in production. Parameters travel as the query string
 * `?window=<kind>&projectId=..&displayId=..`.
 */
export type LoadSource =
  | { type: "dev"; devServerUrl: string }
  | { type: "file"; indexHtmlPath: string };

export type LoadTarget =
  | { type: "url"; url: string }
  | { type: "file"; filePath: string; query: Record<string, string> };

/** Query record for a window (only defined, non-empty params are included). */
export function windowQuery(params: WindowParams): Record<string, string> {
  const q: Record<string, string> = { window: params.kind };
  if (params.projectId) q.projectId = params.projectId;
  if (params.displayId) q.displayId = params.displayId;
  return q;
}

/**
 * Query flag telling the renderer the window has no native title bar and the
 * macOS traffic lights sit inside its chrome: `?titleBar=inset`.
 */
export const TITLE_BAR_QUERY_KEY = "titleBar";
export const TITLE_BAR_INSET = "inset";

/** `extra` adds non-identifying flags (e.g. {@link TITLE_BAR_QUERY_KEY}); params win on clashes. */
export function buildLoadTarget(
  source: LoadSource,
  params: WindowParams,
  extra: Record<string, string> = {},
): LoadTarget {
  const query = { ...extra, ...windowQuery(params) };
  if (source.type === "file") return { type: "file", filePath: source.indexHtmlPath, query };
  const url = new URL(source.devServerUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { type: "url", url: url.toString() };
}

/** Inverse of {@link windowQuery}; `null` when the kind is missing or unknown. */
export function parseWindowQuery(search: string): WindowParams | null {
  const sp = new URLSearchParams(search);
  const kind = sp.get("window");
  if (!isWindowKind(kind)) return null;
  const out: WindowParams = { kind };
  const projectId = sp.get("projectId");
  const displayId = sp.get("displayId");
  if (projectId) out.projectId = projectId;
  if (displayId) out.displayId = displayId;
  return out;
}
