import type { TrackKind } from "./types";

/**
 * Per-track hues from design guide §2.2 ("Track colors"). DOM consumers use the
 * theme-aware CSS variables (tokens.css `--track-*`); the hex tables below
 * mirror those values for contexts that can't read CSS (PixiJS).
 */
export const TRACK_COLORS: Readonly<Record<TrackKind, string>> = {
  video: "var(--track-video)",
  zoom: "var(--track-zoom)",
  speed: "var(--track-speed)",
  annotations: "var(--track-annotations)",
  captions: "var(--track-captions)",
};

/** Hues for tracks the timeline does not render yet (guide §2.2). */
export const FUTURE_TRACK_COLORS = {
  audio: "var(--track-audio)",
  webcam: "var(--track-webcam)",
} as const;

type TrackHue = TrackKind | keyof typeof FUTURE_TRACK_COLORS;

/** Concrete hex per theme — keep in sync with tokens.css. Light = same hues, darker. */
export const TRACK_HEX: Readonly<Record<"dark" | "light", Readonly<Record<TrackHue, string>>>> = {
  dark: {
    video: "#82796a",
    zoom: "#f6a06b",
    speed: "#d67f48",
    annotations: "#aebf92",
    captions: "#8fb0a0",
    audio: "#c0b6a5",
    webcam: "#e0a0a8",
  },
  light: {
    video: "#82796a",
    zoom: "#b2622d",
    speed: "#8c491a",
    annotations: "#728157",
    captions: "#5b8575",
    audio: "#82796a",
    webcam: "#b8697a",
  },
};

/** Invalid-drop outline (spec §6.7 "red outline") — the destructive `--danger` token. */
export const INVALID_COLOR = "var(--danger)";

/** Item fill: the track hue at 16% (design S12 segments); ghosts use 10%. */
export function itemFill(hue: string, percent = 16): string {
  return `color-mix(in srgb, ${hue} ${percent}%, transparent)`;
}
