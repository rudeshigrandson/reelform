import type { CursorSettings, CursorStyle } from "../inspector/cursor/types";

/**
 * Cursor style packs (ENGINEERING_SPEC §6.6 / §9.2). A pack lives at
 * `/cursors/<pack>/pack.json`:
 *
 *   { "hotspots": { "arrow": [x, y] | {"x","y"}, … },
 *     "files":    { "arrow": "arrow.svg", … },
 *     "size"?:    32, "viewBox"?: [0, 0, 64, 64] }
 *
 * Hotspots are in the pack's box units (`size`, else the `viewBox` height,
 * default 32). Loading never throws: a missing / malformed pack resolves to
 * null and the stage draws the built-in arrow instead.
 */

export const CURSOR_TYPES = [
  "arrow",
  "ibeam",
  "hand",
  "grab",
  "resize-ew",
  "resize-ns",
  "resize-nesw",
  "resize-nwse",
] as const;

/** Pack box size when `pack.json` omits `size`. */
export const DEFAULT_PACK_SIZE = 32;
export const CURSOR_PACK_BASE_URL = "/cursors";

export interface CursorPack {
  id: string;
  /** Box height the hotspots are expressed in. */
  size: number;
  /** type → absolute URL. */
  files: Readonly<Record<string, string>>;
  /** type → hotspot in box units. */
  hotspots: Readonly<Record<string, { x: number; y: number }>>;
}

/** What the stage draws for the cursor at a moment. */
export interface CursorSpriteRef {
  /** Resolved type actually used (after aliasing / fallback). */
  type: string;
  url: string;
  hotspot: { x: number; y: number };
  /** Box size the hotspot is expressed in. */
  boxSize: number;
}

export type FetchJson = (url: string) => Promise<unknown>;

/** Pack folder for a style; `custom` has no pack. */
export function cursorPackId(style: CursorStyle): string | null {
  switch (style) {
    case "macos":
    case "macos-dark":
    case "windows":
      return style;
    case "minimal-dot":
      return "dot";
    case "custom":
      return null;
  }
}

const TYPE_ALIASES: Readonly<Record<string, string>> = {
  default: "arrow",
  pointer: "hand",
  text: "ibeam",
  "i-beam": "ibeam",
  grabbing: "grab",
  move: "grab",
  "ew-resize": "resize-ew",
  "ns-resize": "resize-ns",
  "nesw-resize": "resize-nesw",
  "nwse-resize": "resize-nwse",
  "col-resize": "resize-ew",
  "row-resize": "resize-ns",
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function parseHotspot(v: unknown): { x: number; y: number } | null {
  if (Array.isArray(v) && finite(v[0]) && finite(v[1])) return { x: v[0], y: v[1] };
  if (v && typeof v === "object") {
    const o = v as { x?: unknown; y?: unknown };
    if (finite(o.x) && finite(o.y)) return { x: o.x, y: o.y };
  }
  return null;
}

function joinUrl(base: string, file: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith("/")) return file;
  return `${base.replace(/\/+$/, "")}/${file.replace(/^\.?\/+/, "")}`;
}

/** Validate a raw `pack.json`. Needs at least an `arrow` file. */
export function parseCursorPack(
  id: string,
  raw: unknown,
  baseUrl = CURSOR_PACK_BASE_URL,
): CursorPack | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { files?: unknown; hotspots?: unknown; size?: unknown };
  if (!o.files || typeof o.files !== "object") return null;
  const dir = `${baseUrl.replace(/\/+$/, "")}/${id}`;
  const files: Record<string, string> = {};
  for (const [type, file] of Object.entries(o.files as Record<string, unknown>)) {
    if (typeof file === "string" && file.length > 0) files[type] = joinUrl(dir, file);
  }
  if (!files.arrow) return null;
  const hotspots: Record<string, { x: number; y: number }> = {};
  if (o.hotspots && typeof o.hotspots === "object") {
    for (const [type, h] of Object.entries(o.hotspots as Record<string, unknown>)) {
      const p = parseHotspot(h);
      if (p) hotspots[type] = p;
    }
  }
  return { id, size: packBoxSize(raw), files, hotspots };
}

/**
 * Units the hotspots are expressed in: top-level `size`, else the `viewBox`
 * height (`[minX, minY, w, h]`, as the bundled packs ship), else the arrow's
 * `cursors.arrow.size` (`[w, h]` or a number), else 32.
 */
export function packBoxSize(raw: unknown): number {
  const o = raw as {
    size?: unknown;
    viewBox?: unknown;
    cursors?: { arrow?: { size?: unknown } };
  };
  if (finite(o.size) && o.size > 0) return o.size;
  if (Array.isArray(o.viewBox) && finite(o.viewBox[3]) && o.viewBox[3] > 0) return o.viewBox[3];
  const arrowSize = o.cursors && typeof o.cursors === "object" ? o.cursors.arrow?.size : undefined;
  if (Array.isArray(arrowSize) && finite(arrowSize[1]) && arrowSize[1] > 0) return arrowSize[1];
  if (finite(arrowSize) && arrowSize > 0) return arrowSize;
  return DEFAULT_PACK_SIZE;
}

/** Normalise a telemetry cursor type to a pack key. */
export function normalizeCursorType(type: string | null | undefined): string {
  if (!type) return "arrow";
  const t = type.trim().toLowerCase();
  return TYPE_ALIASES[t] ?? t;
}

/** Sprite for `type` from a pack, falling back to the pack's arrow. */
export function cursorSpriteFor(
  pack: CursorPack,
  type: string | null | undefined,
): CursorSpriteRef | null {
  const wanted = normalizeCursorType(type);
  const key = pack.files[wanted] ? wanted : "arrow";
  const url = pack.files[key];
  if (!url) return null;
  return { type: key, url, hotspot: pack.hotspots[key] ?? { x: 0, y: 0 }, boxSize: pack.size };
}

/**
 * The sprite for the current settings: custom arrow file, a pack sprite, or
 * null (→ drawn arrow). `pack` is the loaded pack for `settings.style`.
 */
export function resolveCursorSprite(
  settings: Pick<CursorSettings, "style" | "customCursor">,
  pack: CursorPack | null | undefined,
  type: string | null | undefined,
): CursorSpriteRef | null {
  if (settings.style === "custom") {
    const c = settings.customCursor;
    return c ? { type: "arrow", url: c.path, hotspot: { x: 0, y: 0 }, boxSize: 0 } : null;
  }
  return pack ? cursorSpriteFor(pack, type) : null;
}

export interface CursorPackLoader {
  /** Load (once) and cache; resolves null when the pack is missing or invalid. */
  load(style: CursorStyle): Promise<CursorPack | null>;
  /** Cached result: undefined while not yet loaded. */
  peek(style: CursorStyle): CursorPack | null | undefined;
}

export function createCursorPackLoader(
  fetchJson: FetchJson,
  baseUrl = CURSOR_PACK_BASE_URL,
): CursorPackLoader {
  const done = new Map<string, CursorPack | null>();
  const pending = new Map<string, Promise<CursorPack | null>>();
  return {
    load(style) {
      const id = cursorPackId(style);
      if (id === null) return Promise.resolve(null);
      if (done.has(id)) return Promise.resolve(done.get(id) ?? null);
      let p = pending.get(id);
      if (!p) {
        p = fetchJson(`${baseUrl.replace(/\/+$/, "")}/${id}/pack.json`)
          .then(
            (raw) => parseCursorPack(id, raw, baseUrl),
            () => null,
          )
          .then((pack) => {
            done.set(id, pack);
            pending.delete(id);
            return pack;
          });
        pending.set(id, p);
      }
      return p;
    },
    peek(style) {
      const id = cursorPackId(style);
      if (id === null) return null;
      return done.has(id) ? (done.get(id) ?? null) : undefined;
    },
  };
}

/** `fetch`-based JSON loader; rejects on non-2xx. */
export const fetchJsonViaFetch: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as unknown;
};
