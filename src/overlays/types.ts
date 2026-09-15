/** A capture region rectangle in device pixels. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Webcam bubble outline shape. */
export type BubbleShape = "circle" | "rounded";

export interface RegionSelectorProps {
  /** Rectangle the overlay opens with; seeds local drag/resize state. */
  initialBounds: Bounds;
  /** Confirmed the region — fired by "Record". */
  onConfirm: (bounds: Bounds) => void;
  /** Dismissed the overlay — fired by "Cancel" or Escape. */
  onCancel: () => void;
  /** Minimum rect size in px (both axes). Defaults to 32. */
  minSize?: number;
  /** Guidance above the selection (guide S07). Defaults to the localized drag/Esc hint. */
  hint?: string | undefined;
  /** Window rects (display-local) the selection edges snap to while dragging / resizing. */
  snapTargets?: ReadonlyArray<Bounds> | undefined;
}

export interface SourceOutlineProps {
  /** Display-local rect of the selected window source. */
  bounds: Bounds;
  /** e.g. "Figma — Onboarding.fig". */
  label?: string | undefined;
}

export interface CountdownProps {
  /** Current number to show, e.g. 3 → 2 → 1; 0 draws the "Go" frame. */
  count: number;
  /** Total seconds, for the ring progress; omitted → full ring. */
  total?: number | undefined;
  /** Dismissed the countdown — fired by Escape. */
  onCancel: () => void;
}

export interface WebcamBubbleProps {
  /** Diameter (circle) or side length (rounded) in px. */
  size: number;
  /** Outline shape of the bubble. */
  shape: BubbleShape;
  /** Initial top-left position within the parent. Defaults to {0,0}. */
  initialPosition?: { x: number; y: number };
  /** Live feed / state content; defaults to a camera glyph placeholder. */
  children?: import("react").ReactNode;
}

/** Fixture props for RegionSelector previews/tests. */
export const sampleRegionProps: Pick<RegionSelectorProps, "initialBounds"> = {
  initialBounds: { x: 120, y: 80, width: 640, height: 360 },
};

/** Fixture props for WebcamBubble previews/tests. */
export const sampleWebcamProps: Pick<WebcamBubbleProps, "size" | "shape"> = {
  size: 160,
  shape: "circle",
};
