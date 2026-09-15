/**
 * Squircle mask geometry (ENGINEERING_SPEC §9.1: superellipse mask n=4). A
 * rounded rect whose corners are superellipse quarter arcs
 * `|dx/r|^n + |dy/r|^n = 1` instead of circles. Pure; returns a flat polygon
 * `[x0, y0, x1, y1, …]` clockwise in screen space (y down).
 */

export const SQUIRCLE_EXPONENT = 4;
export const SQUIRCLE_SEGMENTS = 12;

const sgnPow = (v: number, p: number): number => Math.sign(v) * Math.abs(v) ** p;

export function squirclePoints(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  segments = SQUIRCLE_SEGMENTS,
  n = SQUIRCLE_EXPONENT,
): number[] {
  const W = Number.isFinite(w) && w > 0 ? w : 0;
  const H = Number.isFinite(h) && h > 0 ? h : 0;
  const r = Math.min(Number.isFinite(radius) && radius > 0 ? radius : 0, W / 2, H / 2);
  if (r <= 0) return [x, y, x + W, y, x + W, y + H, x, y + H];
  const seg = Math.max(1, Math.floor(segments));
  const e = 2 / (Number.isFinite(n) && n > 0 ? n : SQUIRCLE_EXPONENT);
  const corners: Array<[cx: number, cy: number, from: number]> = [
    [x + r, y + r, Math.PI], // top-left: left → top
    [x + W - r, y + r, 1.5 * Math.PI], // top-right: top → right
    [x + W - r, y + H - r, 0], // bottom-right: right → bottom
    [x + r, y + H - r, 0.5 * Math.PI], // bottom-left: bottom → left
  ];
  const pts: number[] = [];
  for (const [cx, cy, from] of corners) {
    for (let i = 0; i <= seg; i++) {
      const theta = from + (i / seg) * (Math.PI / 2);
      // Snap exact axis values so arcs meet the straight edges cleanly.
      const c = Math.abs(Math.cos(theta)) < 1e-12 ? 0 : Math.cos(theta);
      const s = Math.abs(Math.sin(theta)) < 1e-12 ? 0 : Math.sin(theta);
      pts.push(cx + r * sgnPow(c, e), cy + r * sgnPow(s, e));
    }
  }
  return pts;
}
