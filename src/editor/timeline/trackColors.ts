import type { TrackKind } from "./types";

/**
 * Per-track hues from design guide §2.2 ("Track colors"). tokens.css has no
 * track tokens yet — this is the single place these literals live; move them
 * to CSS variables when the dark theme tokens land.
 */
export const TRACK_COLORS: Readonly<Record<TrackKind, string>> = {
  video: "#8A93A6",
  zoom: "#6E7BFF",
  speed: "#FFB84D",
  annotations: "#3DD68C",
  captions: "#4DD0FF",
};

/** Hues for tracks the timeline does not render yet (guide §2.2). */
export const FUTURE_TRACK_COLORS = {
  audio: "#B57BFF",
  webcam: "#FF8AB3",
} as const;

/**
 * Invalid-drop outline (spec §6.7 "red outline"). tokens.css `--color-accent-2`
 * is olive green and does not read as a warning, so this uses the guide's
 * `--record` destructive red (§2.2) until a danger token exists.
 */
export const INVALID_COLOR = "#FF4D5E";

/** Item fill: the track hue at 8% (guide §2.6). */
export function itemFill(hue: string): string {
  return `color-mix(in srgb, ${hue} 8%, transparent)`;
}
