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
    video: "#8a93a6",
    zoom: "#6e7bff",
    speed: "#ffb84d",
    annotations: "#3dd68c",
    captions: "#4dd0ff",
    audio: "#b57bff",
    webcam: "#ff8ab3",
  },
  light: {
    video: "#6b7385",
    zoom: "#4f5be6",
    speed: "#c77a00",
    annotations: "#1f9a5c",
    captions: "#1692c2",
    audio: "#8a4fd9",
    webcam: "#d2517f",
  },
};

/** Invalid-drop outline (spec §6.7 "red outline") — the destructive `--danger` token. */
export const INVALID_COLOR = "var(--danger)";

/** Item fill: the track hue at 8% (guide §2.6). */
export function itemFill(hue: string): string {
  return `color-mix(in srgb, ${hue} 8%, transparent)`;
}
