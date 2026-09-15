import type { InspectorTab } from "../../shell/types";

/**
 * Inspector auto-switch: the tab that edits the selected item kind. The shell
 * keeps `activeTab` controlled and calls {@link nextInspectorTab} when the
 * selection changes; users can turn it off (`enabled: false`).
 */

export type InspectorSelectionKind =
  | "zoom"
  | "speed"
  | "annotation"
  | "caption"
  | "audio"
  | "webcam"
  | "clip";

export type InspectorSelection = { kind: InspectorSelectionKind; id: string } | null;

const TAB_FOR_KIND: Readonly<Record<InspectorSelectionKind, InspectorTab | null>> = {
  zoom: "Zoom",
  speed: "Effects",
  annotation: "Annotations",
  caption: "Captions",
  audio: "Audio",
  webcam: "Webcam",
  // Clips have no dedicated tab; keep whatever is open.
  clip: null,
};

export function inspectorTabForSelection(selection: InspectorSelection): InspectorTab | null {
  return selection ? TAB_FOR_KIND[selection.kind] : null;
}

/** Selection implied by the editor store's per-kind selection ids (last-set wins by priority). */
export function selectionFromEditor(d: {
  selectedZoomId: string | null;
  selectedSpeedId: string | null;
  selectedAnnotationId: string | null;
}): InspectorSelection {
  if (d.selectedAnnotationId) return { kind: "annotation", id: d.selectedAnnotationId };
  if (d.selectedZoomId) return { kind: "zoom", id: d.selectedZoomId };
  if (d.selectedSpeedId) return { kind: "speed", id: d.selectedSpeedId };
  return null;
}

/** Tab to show after a selection change; unchanged when disabled or no mapping. */
export function nextInspectorTab(
  current: InspectorTab,
  selection: InspectorSelection,
  enabled: boolean,
): InspectorTab {
  if (!enabled) return current;
  return inspectorTabForSelection(selection) ?? current;
}
