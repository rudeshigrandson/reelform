import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FRAME_PRESETS,
  DEFAULT_FRAME_SETTINGS,
  PLACEHOLDER_WALLPAPERS,
} from "../editor/inspector/frame/types";
import {
  type FetchLike,
  WALLPAPER_PACK_CATEGORIES,
  type WallpaperDefinition,
  loadWallpaperPack,
  parseWallpaperPack,
  wallpaperPackSchema,
  wallpaperToCss,
} from "./wallpapers";

const PACK_PATH = join(__dirname, "../../public/wallpapers/wallpapers.json");
const raw: unknown = JSON.parse(readFileSync(PACK_PATH, "utf8"));

const linear = (over: Partial<WallpaperDefinition> = {}): WallpaperDefinition => ({
  id: "x-1",
  name: "X",
  category: "Gradient",
  kind: "linear",
  angle: 90,
  stops: [
    { color: "#000000", position: 0 },
    { color: "#ffffff", position: 100 },
  ],
  ...over,
});

describe("bundled wallpapers.json", () => {
  const result = parseWallpaperPack(raw);
  if (!result.ok) throw new Error(`bundled pack invalid: ${result.message}`);
  const { wallpapers } = result.pack;

  it("has at least 40 wallpapers", () => {
    expect(wallpapers.length).toBeGreaterThanOrEqual(40);
  });

  it("ids are unique", () => {
    expect(new Set(wallpapers.map((w) => w.id)).size).toBe(wallpapers.length);
  });

  it.each(WALLPAPER_PACK_CATEGORIES)("category %s has at least 5 entries", (category) => {
    expect(wallpapers.filter((w) => w.category === category).length).toBeGreaterThanOrEqual(5);
  });

  it("covers every Frame tab placeholder id (persisted in projects)", () => {
    const ids = new Set(wallpapers.map((w) => w.id));
    const missing = PLACEHOLDER_WALLPAPERS.filter((p) => !ids.has(p.id)).map((p) => p.id);
    expect(missing).toEqual([]);
    for (const p of PLACEHOLDER_WALLPAPERS) {
      expect(wallpapers.find((w) => w.id === p.id)?.category).toBe(p.category);
    }
  });

  it("covers the default frame and every built-in preset wallpaper id", () => {
    const ids = new Set(wallpapers.map((w) => w.id));
    const used = [
      DEFAULT_FRAME_SETTINGS.background.wallpaperId,
      ...BUILT_IN_FRAME_PRESETS.map((p) => p.settings.background.wallpaperId),
    ];
    for (const id of used) expect(ids.has(id), id).toBe(true);
  });

  it("uses all three kinds and renders CSS without undefined/NaN", () => {
    expect(new Set(wallpapers.map((w) => w.kind))).toEqual(new Set(["linear", "radial", "mesh"]));
    for (const w of wallpapers) {
      const css = wallpaperToCss(w);
      expect(css, w.id).not.toMatch(/undefined|NaN/);
      expect(css.length, w.id).toBeGreaterThan(0);
    }
  });
});

describe("wallpaperPackSchema", () => {
  it("rejects duplicate ids", () => {
    const r = parseWallpaperPack({ version: 1, wallpapers: [linear(), linear()] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/duplicate wallpaper id x-1/);
  });

  it("rejects mesh without points and points on non-mesh", () => {
    expect(
      wallpaperPackSchema.safeParse({ version: 1, wallpapers: [linear({ kind: "mesh" })] }).success,
    ).toBe(false);
    expect(
      wallpaperPackSchema.safeParse({
        version: 1,
        wallpapers: [linear({ points: [{ x: 0, y: 0, color: "#000000", radius: 0.5 }] })],
      }).success,
    ).toBe(false);
  });

  it("rejects linear without angle, unsorted stops, bad colors and out-of-range points", () => {
    const { angle: _angle, ...noAngle } = linear();
    const bad: unknown[] = [
      noAngle,
      linear({
        stops: [
          { color: "#000000", position: 80 },
          { color: "#ffffff", position: 20 },
        ],
      }),
      linear({ stops: [{ color: "red", position: 0 }] }),
      linear({
        kind: "mesh",
        points: [{ x: 1.5, y: 0, color: "#000000", radius: 0.5 }],
      }),
      linear({ id: "Not Kebab" }),
      linear({ stops: [] }),
    ];
    for (const w of bad) {
      expect(wallpaperPackSchema.safeParse({ version: 1, wallpapers: [w] }).success).toBe(false);
    }
  });

  it("rejects an unknown version or empty pack", () => {
    expect(parseWallpaperPack({ version: 2, wallpapers: [linear()] }).ok).toBe(false);
    expect(parseWallpaperPack({ version: 1, wallpapers: [] }).ok).toBe(false);
    expect(parseWallpaperPack(null).ok).toBe(false);
  });
});

describe("loadWallpaperPack", () => {
  const respond =
    (body: unknown, ok = true, status = 200): FetchLike =>
    async () => ({ ok, status, json: async () => body });

  it("loads and validates the bundled pack from the default URL", async () => {
    let requested = "";
    const r = await loadWallpaperPack(async (url) => {
      requested = url;
      return { ok: true, status: 200, json: async () => raw };
    });
    expect(requested).toBe("wallpapers/wallpapers.json");
    expect(r.ok).toBe(true);
  });

  it("reports HTTP errors as network failures", async () => {
    const r = await loadWallpaperPack(respond(null, false, 404));
    expect(r).toEqual({
      ok: false,
      reason: "network",
      message: "HTTP 404 for wallpapers/wallpapers.json",
    });
  });

  it("reports thrown fetch and JSON errors without throwing", async () => {
    const r1 = await loadWallpaperPack(async () => {
      throw new Error("offline");
    });
    expect(r1).toEqual({ ok: false, reason: "network", message: "offline" });
    const r2 = await loadWallpaperPack(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }));
    expect(r2.ok).toBe(false);
  });

  it("reports schema violations as invalid", async () => {
    const r = await loadWallpaperPack(respond({ version: 1, wallpapers: [{ id: "x" }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
  });
});

describe("wallpaperToCss", () => {
  it("solid = the single color", () => {
    expect(wallpaperToCss(linear({ stops: [{ color: "#123456", position: 0 }] }))).toBe("#123456");
  });

  it("linear and radial", () => {
    expect(wallpaperToCss(linear())).toBe("linear-gradient(90deg, #000000 0%, #ffffff 100%)");
    expect(wallpaperToCss(linear({ kind: "radial", angle: undefined }))).toBe(
      "radial-gradient(circle at 50% 50%, #000000 0%, #ffffff 100%)",
    );
  });

  it("mesh layers blobs over the base and is deterministic", () => {
    const w = linear({
      kind: "mesh",
      points: [{ x: 0.25, y: 0.75, color: "#ff0000", radius: 0.5 }],
    });
    const css = wallpaperToCss(w);
    expect(css).toBe(
      "radial-gradient(circle at 25% 75%, #ff0000 0%, #ff000000 50%), linear-gradient(90deg, #000000 0%, #ffffff 100%)",
    );
    expect(wallpaperToCss(w)).toBe(css);
  });
});
