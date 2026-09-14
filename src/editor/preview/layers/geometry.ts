/**
 * Pure drawing helpers shared by the scene layers (ENGINEERING_SPEC §6.4/§9.7).
 * No pixi imports: everything here is plain numbers so it is unit-testable.
 */

export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Rgba {
  /** 0xRRGGBB */
  color: number;
  /** 0..1 */
  alpha: number;
}

export const finiteOr = (n: number, fallback: number): number =>
  Number.isFinite(n) ? n : fallback;

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into a numeric color + alpha.
 * Anything else yields `fallback` at full alpha.
 */
export function parseColor(input: string, fallback = 0x000000): Rgba {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(input.trim());
  const hex = m?.[1];
  if (!hex) return { color: fallback, alpha: 1 };
  if (hex.length === 3) {
    const [r = "0", g = "0", b = "0"] = hex;
    return { color: Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16), alpha: 1 };
  }
  const color = Number.parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { color, alpha };
}

/** Relative luminance (sRGB, 0..1) of a numeric color. */
export function luminance(color: number): number {
  const ch = (shift: number): number => {
    const c = ((color >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
}

export type Segment = readonly [x1: number, y1: number, x2: number, y2: number];

/** Upper bound on generated dashes so a degenerate dash length can't explode. */
export const MAX_DASHES = 512;

/**
 * Split a line into dash segments (`dash` on, `gap` off). A non-positive dash
 * or gap yields the whole line as one segment.
 */
export function dashSegments(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
): Segment[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [];
  if (!(dash > 0) || !(gap > 0)) return [[x1, y1, x2, y2]];
  const period = Math.max(dash + gap, len / MAX_DASHES);
  const on = (dash / (dash + gap)) * period;
  const ux = dx / len;
  const uy = dy / len;
  const out: Segment[] = [];
  for (let s = 0; s < len; s += period) {
    const e = Math.min(len, s + on);
    out.push([x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e]);
  }
  return out;
}

export type ArrowHeadKind = "triangle" | "open" | "circle" | "none";

export interface ArrowGeometry {
  /** Shaft end points; stops at the head base so the stroke doesn't poke through. */
  shaft: Segment;
  head:
    | { kind: "triangle"; points: number[] }
    | { kind: "open"; points: number[] }
    | { kind: "circle"; x: number; y: number; radius: number }
    | { kind: "none" };
}

/**
 * Arrow from (x1,y1) to the tip (x2,y2). Head length is 3.5× stroke width,
 * never more than half the arrow length.
 */
export function arrowGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
  headStyle: ArrowHeadKind,
): ArrowGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const sw = Math.max(0, finiteOr(strokeWidth, 0));
  if (!(len > 0) || headStyle === "none") {
    return { shaft: [x1, y1, x2, y2], head: { kind: "none" } };
  }
  const ux = dx / len;
  const uy = dy / len;
  if (headStyle === "circle") {
    const radius = Math.min(Math.max(sw * 1.5, 1), len / 2);
    return {
      shaft: [x1, y1, x2 - ux * radius, y2 - uy * radius],
      head: { kind: "circle", x: x2, y: y2, radius },
    };
  }
  const headLen = Math.min(Math.max(sw * 3.5, 4), len / 2);
  const halfW = headLen * 0.6;
  const bx = x2 - ux * headLen;
  const by = y2 - uy * headLen;
  // Perpendicular (-uy, ux).
  const points = [bx - uy * halfW, by + ux * halfW, x2, y2, bx + uy * halfW, by - ux * halfW];
  return headStyle === "triangle"
    ? { shaft: [x1, y1, bx, by], head: { kind: "triangle", points } }
    : { shaft: [x1, y1, x2, y2], head: { kind: "open", points } };
}
