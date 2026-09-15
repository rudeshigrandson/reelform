import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import {
  CURSOR_TYPES,
  createCursorPackLoader,
  cursorPackId,
  cursorSpriteFor,
  normalizeCursorType,
  packBoxSize,
  parseCursorPack,
  resolveCursorSprite,
} from "./cursorPack";

const raw = {
  hotspots: { arrow: [4, 2], ibeam: { x: 8, y: 16 }, hand: "bad" },
  files: { arrow: "arrow.svg", ibeam: "ibeam.png", hand: "hand.svg", empty: "" },
};

describe("parseCursorPack", () => {
  it("resolves file URLs under the pack folder and parses both hotspot shapes", () => {
    const pack = parseCursorPack("macos", raw);
    expect(pack?.files.arrow).toBe("/cursors/macos/arrow.svg");
    expect(pack?.files.empty).toBeUndefined();
    expect(pack?.hotspots.arrow).toEqual({ x: 4, y: 2 });
    expect(pack?.hotspots.ibeam).toEqual({ x: 8, y: 16 });
    expect(pack?.hotspots.hand).toBeUndefined();
    expect(pack?.size).toBe(32);
  });

  it("rejects packs without an arrow or with junk", () => {
    expect(parseCursorPack("x", { files: { hand: "h.svg" } })).toBeNull();
    expect(parseCursorPack("x", null)).toBeNull();
    expect(parseCursorPack("x", "nope")).toBeNull();
    expect(parseCursorPack("x", { files: 3 })).toBeNull();
  });
});

describe("pack box size", () => {
  it("uses size, then viewBox height, then cursors.arrow.size, then 32", () => {
    expect(packBoxSize({ size: 48, viewBox: [0, 0, 64, 64] })).toBe(48);
    expect(packBoxSize({ viewBox: [0, 0, 64, 64] })).toBe(64);
    expect(packBoxSize({ cursors: { arrow: { size: [40, 56] } } })).toBe(56);
    expect(packBoxSize({ cursors: { arrow: { size: 24 } } })).toBe(24);
    expect(packBoxSize({ size: -1, viewBox: [0, 0, 64, 0] })).toBe(32);
    expect(packBoxSize({})).toBe(32);
  });

  it("parses every bundled pack in public/cursors with hotspots inside the box", () => {
    for (const id of ["macos", "macos-dark", "windows", "dot"]) {
      const raw: unknown = JSON.parse(
        readFileSync(resolve(process.cwd(), "public/cursors", id, "pack.json"), "utf8"),
      );
      const pack = parseCursorPack(id, raw);
      if (!pack) throw new Error(`pack ${id} failed to parse`);
      expect(pack.files.arrow).toBe(`/cursors/${id}/arrow.svg`);
      for (const type of CURSOR_TYPES) {
        const ref = cursorSpriteFor(pack, type);
        expect(ref?.type).toBe(type);
        expect(existsSync(resolve(process.cwd(), "public", `.${ref?.url}`))).toBe(true);
        const h = pack.hotspots[type];
        if (!h) throw new Error(`${id}/${type} has no hotspot`);
        expect(h.x).toBeGreaterThanOrEqual(0);
        expect(h.y).toBeGreaterThanOrEqual(0);
        expect(h.x).toBeLessThanOrEqual(pack.size);
        expect(h.y).toBeLessThanOrEqual(pack.size);
      }
    }
  });
});

describe("cursor sprite resolution", () => {
  const pack = parseCursorPack("windows", { ...raw, size: 48 });
  it("maps styles to pack ids", () => {
    expect(cursorPackId("minimal-dot")).toBe("dot");
    expect(cursorPackId("macos-dark")).toBe("macos-dark");
    expect(cursorPackId("custom")).toBeNull();
  });

  it("aliases CSS-style types and falls back to arrow", () => {
    expect(normalizeCursorType("text")).toBe("ibeam");
    expect(normalizeCursorType(undefined)).toBe("arrow");
    if (!pack) throw new Error("pack");
    expect(cursorSpriteFor(pack, "text")).toMatchObject({
      type: "ibeam",
      hotspot: { x: 8, y: 16 },
      boxSize: 48,
    });
    expect(cursorSpriteFor(pack, "resize-ew")).toMatchObject({
      type: "arrow",
      url: "/cursors/windows/arrow.svg",
    });
    // A type with a file but no hotspot defaults to (0,0).
    expect(cursorSpriteFor(pack, "hand")?.hotspot).toEqual({ x: 0, y: 0 });
  });

  it("custom style uses the uploaded arrow; missing pack → drawn arrow (null)", () => {
    const custom = {
      ...DEFAULT_CURSOR_SETTINGS,
      style: "custom" as const,
      customCursor: { fileName: "c.png", path: "reelform-media://r/c.png", kind: "png" as const },
    };
    expect(resolveCursorSprite(custom, null, "hand")?.url).toBe("reelform-media://r/c.png");
    expect(resolveCursorSprite({ ...custom, customCursor: null }, null, "arrow")).toBeNull();
    expect(resolveCursorSprite(DEFAULT_CURSOR_SETTINGS, null, "arrow")).toBeNull();
  });
});

describe("createCursorPackLoader", () => {
  it("fetches once per pack and caches", async () => {
    const fetchJson = vi.fn(async () => raw);
    const loader = createCursorPackLoader(fetchJson);
    expect(loader.peek("macos")).toBeUndefined();
    const [a, b] = await Promise.all([loader.load("macos"), loader.load("macos")]);
    expect(a).toBe(b);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith("/cursors/macos/pack.json");
    expect(loader.peek("macos")).toBe(a);
  });

  it("resolves null (fallback) when the fetch fails or the JSON is invalid", async () => {
    const loader = createCursorPackLoader(async (url) => {
      if (url.includes("windows")) throw new Error("404");
      return { files: {} };
    });
    expect(await loader.load("windows")).toBeNull();
    expect(await loader.load("minimal-dot")).toBeNull();
    expect(loader.peek("windows")).toBeNull();
    expect(await loader.load("custom")).toBeNull();
  });
});
