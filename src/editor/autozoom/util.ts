/** Pure numeric helpers used across the auto-zoom pipeline. */

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function inUnit(v: number): boolean {
  return v >= 0 && v <= 1;
}

/** ease-out cubic: f(t) = 1 - (1-t)^3, t in [0,1]. */
export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
