import type { FetchJson } from "./cursorPack";
import type { BackgroundPaint, PaintStop } from "./scene";

/**
 * Procedural wallpapers (ENGINEERING_SPEC §9.1). `/wallpapers/wallpapers.json`
 * lists `{ id, name, category, kind: "linear"|"radial"|"mesh", stops, angle,
 * points? }`. Parsing is tolerant (stops may be color strings or
 * `{color, offset 0..1 | position 0..100}`); an unknown id keeps the
 * deterministic hash fallback in `scene.ts`.
 */

export const WALLPAPER_MANIFEST_URL = "/wallpapers/wallpapers.json";
/** Mesh blob radius (fraction of the frame diagonal) when a point omits it. */
export const MESH_DEFAULT_RADIUS = 0.6;

export interface MeshPoint {
  /** Normalized 0..1 position in the frame. */
  x: number;
  y: number;
  color: string;
  /** Fraction of the frame's long edge. */
  radius: number;
}

export interface WallpaperDef {
  id: string;
  name: string;
  category: string;
  kind: "linear" | "radial" | "mesh";
  stops: PaintStop[];
  angle: number;
  points: MeshPoint[];
}

export type WallpaperRegistry = ReadonlyMap<string, WallpaperDef>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function parseStops(raw: unknown): PaintStop[] {
  if (!Array.isArray(raw)) return [];
  const n = raw.length;
  const stops: PaintStop[] = [];
  raw.forEach((s, i) => {
    const even = n > 1 ? i / (n - 1) : 0;
    if (typeof s === "string") {
      if (HEX.test(s)) stops.push({ offset: even, color: s });
      return;
    }
    if (!s || typeof s !== "object") return;
    const o = s as { color?: unknown; offset?: unknown; position?: unknown };
    if (typeof o.color !== "string" || !HEX.test(o.color)) return;
    const offset = num(o.offset) ? o.offset : num(o.position) ? o.position / 100 : even;
    stops.push({ offset: clamp01(offset), color: o.color });
  });
  return stops.sort((a, b) => a.offset - b.offset);
}

function parsePoints(raw: unknown): MeshPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: MeshPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as { x?: unknown; y?: unknown; color?: unknown; radius?: unknown };
    if (!num(o.x) || !num(o.y) || typeof o.color !== "string" || !HEX.test(o.color)) continue;
    out.push({
      x: clamp01(o.x),
      y: clamp01(o.y),
      color: o.color,
      radius: num(o.radius) && o.radius > 0 ? o.radius : MESH_DEFAULT_RADIUS,
    });
  }
  return out;
}

export function parseWallpaperDef(raw: unknown): WallpaperDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  const kind =
    o.kind === "radial" || o.kind === "mesh" ? o.kind : o.kind === "linear" ? "linear" : null;
  if (kind === null) return null;
  const stops = parseStops(o.stops);
  const points = parsePoints(o.points);
  // A single-stop linear/radial entry is a solid color (the bundled "Solid" category).
  if (kind === "mesh" ? stops.length === 0 && points.length === 0 : stops.length === 0) return null;
  return {
    id: o.id,
    name: typeof o.name === "string" ? o.name : o.id,
    category: typeof o.category === "string" ? o.category : "Custom",
    kind,
    stops,
    angle: num(o.angle) ? o.angle : 135,
    points,
  };
}

/** Accepts an array or `{ wallpapers: [...] }`; invalid entries are skipped. */
export function parseWallpaperManifest(raw: unknown): WallpaperDef[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { wallpapers?: unknown }).wallpapers)
      ? (raw as { wallpapers: unknown[] }).wallpapers
      : [];
  const seen = new Set<string>();
  const out: WallpaperDef[] = [];
  for (const item of list) {
    const def = parseWallpaperDef(item);
    if (def && !seen.has(def.id)) {
      seen.add(def.id);
      out.push(def);
    }
  }
  return out;
}

export function wallpaperRegistry(defs: readonly WallpaperDef[]): WallpaperRegistry {
  return new Map(defs.map((d) => [d.id, d]));
}

/** Background paint for a procedural wallpaper. */
export function wallpaperPaint(def: WallpaperDef): BackgroundPaint {
  const only = def.stops.length === 1 ? def.stops[0] : undefined;
  if (only && def.kind !== "mesh") return { kind: "solid", color: only.color };
  switch (def.kind) {
    case "linear":
      return { kind: "linear-gradient", angle: def.angle, stops: def.stops.map((s) => ({ ...s })) };
    case "radial":
      return { kind: "radial-gradient", stops: def.stops.map((s) => ({ ...s })) };
    case "mesh": {
      const base = def.stops[0]?.color ?? def.points[0]?.color ?? "#000000";
      const points =
        def.points.length > 0
          ? def.points.map((p) => ({ ...p }))
          : def.stops.slice(1).map((s, i, arr) => ({
              x: arr.length > 0 ? (i + 1) / (arr.length + 1) : 0.5,
              y: i % 2 === 0 ? 0.25 : 0.75,
              color: s.color,
              radius: MESH_DEFAULT_RADIUS,
            }));
      return { kind: "mesh", base, points };
    }
  }
}

/** Fetch and parse the manifest; any failure yields an empty registry. */
export async function loadWallpaperRegistry(
  fetchJson: FetchJson,
  url = WALLPAPER_MANIFEST_URL,
): Promise<WallpaperRegistry> {
  try {
    return wallpaperRegistry(parseWallpaperManifest(await fetchJson(url)));
  } catch {
    return new Map();
  }
}
