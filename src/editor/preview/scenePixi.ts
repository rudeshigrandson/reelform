import type * as Pixi from "pixi.js";
import type { CursorStyle } from "../inspector/cursor/types";
import {
  type CursorPackLoader,
  type FetchJson,
  createCursorPackLoader,
  fetchJsonViaFetch,
} from "./cursorPack";
import type {
  ColorMatrixFilterLike,
  PixelateFilterLike,
  SceneAssets,
  SceneGraphPixi,
  TextureLike,
} from "./sceneGraph";

/**
 * Adapts the real `pixi.js` module to the scene-graph port. Shared by the
 * preview stage and the export renderer so both construct identical objects.
 * The module is passed in (never imported here at runtime) so tests and node
 * code never load pixi.js.
 */

export function scenePixiFromModule(PIXI: typeof Pixi): SceneGraphPixi {
  return {
    Container: PIXI.Container,
    // Graphics.fill's overloads (FillInput) don't structurally match the port's
    // `FillStyleLike | GradientLike`; every value the graph passes is a valid FillInput.
    Graphics: PIXI.Graphics as unknown as SceneGraphPixi["Graphics"],
    Text: PIXI.Text,
    Sprite: PIXI.Sprite,
    createBlurFilter: (strength) => new PIXI.BlurFilter({ strength, quality: 4 }),
    createPixelateFilter: (size) => {
      // Core pixi has no PixelateFilter (it lives in pixi-filters, not a
      // dependency): render the region through a pass-through filter at
      // 1/size resolution so it is sampled back up in blocks.
      const f = new PIXI.AlphaFilter({ alpha: 1, antialias: "off" });
      let current = size;
      f.resolution = 1 / Math.max(1, size);
      return Object.assign(f, {
        get size() {
          return current;
        },
        set size(v: number) {
          current = v;
          f.resolution = 1 / Math.max(1, v);
        },
      }) as unknown as PixelateFilterLike;
    },
    // `matrix` is a fixed-length tuple type on real pixi; any 20-number array works at runtime.
    createColorMatrixFilter: () => new PIXI.ColorMatrixFilter() as unknown as ColorMatrixFilterLike,
    createNoiseFilter: () => new PIXI.NoiseFilter({ noise: 0, seed: 0 }),
    createLinearGradient: (o) =>
      new PIXI.FillGradient({
        type: "linear",
        start: o.start,
        end: o.end,
        colorStops: o.stops.map((s) => ({ offset: s.offset, color: s.color })),
        textureSpace: "local",
      }),
    createRadialGradient: (o) =>
      new PIXI.FillGradient({
        type: "radial",
        center: { x: 0.5, y: 0.5 },
        innerRadius: 0,
        outerCenter: { x: 0.5, y: 0.5 },
        outerRadius: 0.5,
        colorStops: o.stops.map((s) => ({ offset: s.offset, color: s.color })),
        textureSpace: "local",
      }),
    createRectangle: (x, y, w, h) => new PIXI.Rectangle(x, y, w, h),
  };
}

export interface PixiSceneAssetsOptions {
  /** Base URL for project media (`session.mediaBaseUrl`, trailing slash). */
  mediaBaseUrl?: string | null | undefined;
  fetchJson?: FetchJson | undefined;
  cursorPacks?: CursorPackLoader | undefined;
}

/** Media path → URL: absolute URLs pass through; relative paths join the media base. */
export function resolveMediaPath(
  path: string,
  mediaBaseUrl: string | null | undefined,
): string | null {
  if (path.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/")) return path;
  if (!mediaBaseUrl) return null;
  return `${mediaBaseUrl.endsWith("/") ? mediaBaseUrl : `${mediaBaseUrl}/`}${path.replace(/^\.?\/+/, "")}`;
}

export function createPixiSceneAssets(
  PIXI: typeof Pixi,
  opts: PixiSceneAssetsOptions = {},
): SceneAssets {
  const packs = opts.cursorPacks ?? createCursorPackLoader(opts.fetchJson ?? fetchJsonViaFetch);
  return {
    async loadTexture(url) {
      try {
        const tex = await PIXI.Assets.load<Pixi.Texture>(url);
        return (tex ?? null) as TextureLike | null;
      } catch {
        return null;
      }
    },
    loadCursorPack: (style: CursorStyle) => packs.load(style),
    resolveMediaUrl: (path) => resolveMediaPath(path, opts.mediaBaseUrl),
  };
}
