/**
 * Playback-bar timecode (design guide S12 region D): `00:12.340`, or
 * `1:02:03.450` once the time reaches an hour. Rounded to the nearest ms;
 * negative / non-finite input shows as zero.
 */
export function formatPlaybackTime(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const milli = safe % 1000;
  const totalS = Math.floor(safe / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const core = `${pad2(m)}:${pad2(s)}.${String(milli).padStart(3, "0")}`;
  return h > 0 ? `${h}:${core}` : core;
}
