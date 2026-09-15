import { z } from "zod";

/**
 * Bundled procedural wallpapers (ENGINEERING_SPEC §9.1, PLAN §4 "wallpapers
 * (bundled 40+)"). The pack is `public/wallpapers/wallpapers.json`: pure data,
 * no images, so it renders at any output size. Discovered at runtime so packs
 * can be added later (§12 assets-only extensions use the same schema).
 *
 * Ids are stable: `abstract-1`… `solid-4` match the Frame tab's placeholder
 * ids (`PLACEHOLDER_WALLPAPERS`) and are persisted in projects as
 * `frame.background.wallpaperId`.
 */

export const WALLPAPER_PACK_CATEGORIES = ["Abstract", "Gradient", "Mesh", "Mac", "Solid"] as const;
export type WallpaperPackCategory = (typeof WALLPAPER_PACK_CATEGORIES)[number];

export const WALLPAPER_KINDS = ["linear", "radial", "mesh"] as const;
export type WallpaperKind = (typeof WALLPAPER_KINDS)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb");
const unit = z.number().min(0).max(1);

export const wallpaperStopSchema = z.object({
  color: hexColor,
  /** 0–100 along the gradient axis (same unit as the Frame tab's gradient stops). */
  position: z.number().min(0).max(100),
});

export const wallpaperPointSchema = z.object({
  /** Normalized 0–1 across the canvas. */
  x: unit,
  y: unit,
  color: hexColor,
  /** Normalized to the canvas diagonal; the blob fades to transparent at this radius. */
  radius: z.number().gt(0).max(2),
});

export const wallpaperDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected kebab-case id"),
    name: z.string().min(1),
    category: z.enum(WALLPAPER_PACK_CATEGORIES),
    kind: z.enum(WALLPAPER_KINDS),
    /** Degrees, CSS convention (0 = to top, 90 = to right). Linear only. */
    angle: z.number().min(0).max(360).optional(),
    /** Base gradient. Mesh wallpapers paint `points` over it. */
    stops: z.array(wallpaperStopSchema).min(1).max(8),
    points: z.array(wallpaperPointSchema).min(1).max(8).optional(),
  })
  .superRefine((w, ctx) => {
    if (w.kind === "mesh" && !w.points) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "mesh wallpaper needs points" });
    }
    if (w.kind !== "mesh" && w.points) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "points are only valid for mesh" });
    }
    if (w.kind === "linear" && w.angle === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "linear wallpaper needs angle" });
    }
    for (let i = 1; i < w.stops.length; i++) {
      const prev = w.stops[i - 1];
      const cur = w.stops[i];
      if (prev && cur && cur.position < prev.position) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "stops must be sorted by position",
          path: ["stops", i],
        });
      }
    }
  });
export type WallpaperDefinition = z.infer<typeof wallpaperDefinitionSchema>;

export const wallpaperPackSchema = z
  .object({
    version: z.literal(1),
    wallpapers: z.array(wallpaperDefinitionSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    const seen = new Set<string>();
    pack.wallpapers.forEach((w, i) => {
      if (seen.has(w.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate wallpaper id ${w.id}`,
          path: ["wallpapers", i, "id"],
        });
      }
      seen.add(w.id);
    });
  });
export type WallpaperPack = z.infer<typeof wallpaperPackSchema>;

/** URL of the bundled pack relative to the renderer origin (Vite `public/`). */
export const WALLPAPER_PACK_URL = "wallpapers/wallpapers.json";

export type WallpaperLoadResult =
  | { ok: true; pack: WallpaperPack }
  | { ok: false; reason: "network" | "invalid"; message: string };

/** Validate an already-parsed pack value. */
export function parseWallpaperPack(value: unknown): WallpaperLoadResult {
  const parsed = wallpaperPackSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") ?? "";
    return {
      ok: false,
      reason: "invalid",
      message: `${where ? `${where}: ` : ""}${issue?.message ?? "invalid wallpaper pack"}`,
    };
  }
  return { ok: true, pack: parsed.data };
}

/** Minimal fetch shape so tests (and non-DOM hosts) can inject a loader. */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Fetch + validate a wallpaper pack. Never throws. */
export async function loadWallpaperPack(
  fetchImpl: FetchLike,
  url: string = WALLPAPER_PACK_URL,
): Promise<WallpaperLoadResult> {
  let body: unknown;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, reason: "network", message: `HTTP ${res.status} for ${url}` };
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return parseWallpaperPack(body);
}

/**
 * CSS `background` for a thumbnail tile. Mesh = radial blobs layered over the
 * base gradient. Output is deterministic for a given definition.
 */
export function wallpaperToCss(w: WallpaperDefinition): string {
  const stopList = (stops: readonly { color: string; position: number }[]) =>
    stops.map((s) => `${s.color} ${s.position}%`).join(", ");
  const first = w.stops[0]?.color ?? "#000000";
  const base =
    w.stops.length === 1
      ? first
      : w.kind === "radial"
        ? `radial-gradient(circle at 50% 50%, ${stopList(w.stops)})`
        : `linear-gradient(${w.angle ?? 180}deg, ${stopList(w.stops)})`;
  if (w.kind !== "mesh" || !w.points) return base;
  const blobs = w.points.map(
    (p) =>
      `radial-gradient(circle at ${round(p.x * 100)}% ${round(p.y * 100)}%, ${p.color} 0%, ${p.color}00 ${round(p.radius * 100)}%)`,
  );
  return [...blobs, base].join(", ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
