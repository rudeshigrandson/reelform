import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_FRAME_SETTINGS } from "../inspector/frame/types";
import { resolveBackgroundPaint, wallpaperFallbackPaint } from "./scene";
import {
  MESH_DEFAULT_RADIUS,
  loadWallpaperRegistry,
  parseWallpaperDef,
  parseWallpaperManifest,
  wallpaperPaint,
  wallpaperRegistry,
} from "./wallpapers";

const manifest = {
  wallpapers: [
    {
      id: "gradient-1",
      name: "Dusk",
      category: "Gradient",
      kind: "linear",
      angle: 45,
      stops: ["#112233", "#445566", "#778899"],
    },
    {
      id: "radial-1",
      kind: "radial",
      stops: [
        { color: "#000000", position: 100 },
        { color: "#ffffff", offset: 0 },
      ],
    },
    {
      id: "mesh-1",
      kind: "mesh",
      stops: ["#101010"],
      points: [
        { x: 0.2, y: 1.4, color: "#ff0000" },
        { x: "bad", y: 0, color: "#00ff00" },
      ],
    },
    { id: "gradient-1", kind: "linear", stops: ["#000000", "#ffffff"] },
    { id: "solid", kind: "linear", stops: ["#000000"] },
    { id: "broken", kind: "linear", stops: ["nope"] },
    { id: "weird", kind: "conic", stops: ["#000000", "#ffffff"] },
    "junk",
  ],
};

describe("parseWallpaperManifest", () => {
  it("keeps valid entries once, sorted stops, clamped mesh points", () => {
    const defs = parseWallpaperManifest(manifest);
    expect(defs.map((d) => d.id)).toEqual(["gradient-1", "radial-1", "mesh-1", "solid"]);
    expect(defs[0]?.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(defs[1]?.stops).toEqual([
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#000000" },
    ]);
    expect(defs[2]?.points).toEqual([
      { x: 0.2, y: 1, color: "#ff0000", radius: MESH_DEFAULT_RADIUS },
    ]);
    expect(parseWallpaperManifest([manifest.wallpapers[0]])).toHaveLength(1);
    expect(parseWallpaperManifest(42)).toEqual([]);
    expect(parseWallpaperDef({ id: "", kind: "linear" })).toBeNull();
  });
});

describe("bundled manifest (public/wallpapers/wallpapers.json)", () => {
  it("every entry parses into a paint with sane stops", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/wallpapers/wallpapers.json"), "utf8"),
    );
    const listed = (raw as { wallpapers: Array<{ id: string }> }).wallpapers;
    const defs = parseWallpaperManifest(raw);
    expect(defs.map((d) => d.id)).toEqual(listed.map((w) => w.id));
    for (const def of defs) {
      for (const s of def.stops) {
        expect(s.offset).toBeGreaterThanOrEqual(0);
        expect(s.offset).toBeLessThanOrEqual(1);
      }
      const paint = wallpaperPaint(def);
      if (paint.kind === "mesh") expect(paint.points.length).toBeGreaterThan(0);
      else if (paint.kind === "linear-gradient" || paint.kind === "radial-gradient")
        expect(paint.stops.length).toBeGreaterThanOrEqual(2);
      else if (paint.kind === "solid") expect(def.stops).toHaveLength(1);
      else throw new Error(`unexpected paint ${paint.kind} for ${def.id}`);
    }
  });
});

describe("wallpaper paint", () => {
  const reg = wallpaperRegistry(parseWallpaperManifest(manifest));

  it("maps kinds to background paints", () => {
    expect(wallpaperPaint(reg.get("gradient-1") as never)).toMatchObject({
      kind: "linear-gradient",
      angle: 45,
    });
    expect(wallpaperPaint(reg.get("radial-1") as never).kind).toBe("radial-gradient");
    expect(wallpaperPaint(reg.get("mesh-1") as never)).toMatchObject({
      kind: "mesh",
      base: "#101010",
    });
    expect(wallpaperPaint(reg.get("solid") as never)).toEqual({ kind: "solid", color: "#000000" });
  });

  it("mesh without points derives blobs from stops", () => {
    const def = parseWallpaperDef({
      id: "m",
      kind: "mesh",
      stops: ["#000000", "#ff0000", "#00ff00"],
    });
    const paint = def ? wallpaperPaint(def) : null;
    expect(paint?.kind === "mesh" ? paint.points.length : -1).toBe(2);
  });

  it("resolveBackgroundPaint uses the registry and falls back deterministically", () => {
    const bg = {
      ...structuredClone(DEFAULT_FRAME_SETTINGS.background),
      kind: "wallpaper" as const,
      wallpaperId: "gradient-1",
    };
    expect(resolveBackgroundPaint(bg, reg)).toMatchObject({ kind: "linear-gradient", angle: 45 });
    const unknown = { ...bg, wallpaperId: "nope" };
    expect(resolveBackgroundPaint(unknown, reg)).toEqual(wallpaperFallbackPaint("nope"));
    expect(resolveBackgroundPaint(bg)).toEqual(wallpaperFallbackPaint("gradient-1"));
  });

  it("loadWallpaperRegistry yields an empty registry on failure", async () => {
    expect((await loadWallpaperRegistry(async () => manifest)).size).toBe(4);
    expect((await loadWallpaperRegistry(async () => Promise.reject(new Error("404")))).size).toBe(
      0,
    );
  });
});
