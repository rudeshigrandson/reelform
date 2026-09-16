import type { AutoZoomOptions, EaseCurve, SuggestedZoom } from "../../autozoom";
import type { InspectorMessageKey } from "../i18n";

/**
 * Zoom inspector model (design guide S15, ENGINEERING_SPEC §6.5 / §8).
 * Region shape mirrors the project `ZoomRegion` and extends the auto-zoom
 * engine's `SuggestedZoom` so suggestions can be edited in place.
 */

/** Easing curves offered in the UI: Ease (ease-out cubic), Spring, Linear. */
export type ZoomCurve = EaseCurve | "spring" | "linear";

/** `auto` = engine suggestion; edited or hand-added regions become `manual`. */
export type ZoomSource = SuggestedZoom["source"] | "manual";

export interface ZoomRegion extends Omit<SuggestedZoom, "curve" | "source" | "reason"> {
  readonly curve: ZoomCurve;
  readonly source: ZoomSource;
  /** Tooltip text from the engine, e.g. "3 clicks". Absent on manual regions. */
  readonly reason?: string | undefined;
}

/** Global auto-zoom generation settings. `sensitivity` is 0..1. */
export interface AutoZoomSettings extends AutoZoomOptions {
  readonly sensitivity: number;
}

/** Project `camera` settings (§6.5). `smoothing` is 0..1; `maxZoomSpeed` in zoom levels / second. */
export interface CameraSettings {
  readonly smoothing: number;
  readonly maxZoomSpeed: number;
}

export interface ZoomSettings {
  readonly autoZoom: AutoZoomSettings;
  readonly camera: CameraSettings;
}

export type ZoomStatus = "idle" | "analyzing";

export const ZOOM_LEVEL_MIN = 1;
export const ZOOM_LEVEL_MAX = 4;
/** Shortest allowed region; keeps `endMs > startMs`. */
export const MIN_ZOOM_REGION_MS = 100;
export const EASE_MS_MAX = 3000;
export const MAX_ZOOM_SPEED_MIN = 0.5;
export const MAX_ZOOM_SPEED_MAX = 10;

export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = {
  autoZoom: { sensitivity: 0.5, followCursor: true, zoomOnClicks: true, zoomOnTyping: true },
  camera: { smoothing: 0.5, maxZoomSpeed: 4 },
};

/** `label` is the English name (non-UI callers); the inspector shows `labelKey`. */
export const ZOOM_CURVES: ReadonlyArray<{
  value: ZoomCurve;
  label: string;
  labelKey: InspectorMessageKey;
}> = [
  { value: "ease-out-cubic", label: "Ease", labelKey: "inspector.zoom.curve.ease" },
  { value: "spring", label: "Spring", labelKey: "inspector.zoom.curve.spring" },
  { value: "linear", label: "Linear", labelKey: "inspector.zoom.curve.linear" },
];
