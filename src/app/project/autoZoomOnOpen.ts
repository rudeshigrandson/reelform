import type { SuggestedZoom } from "../../editor/autozoom";
import { timelineClips } from "../../editor/inspector/host/timeMap";
import {
  type GenerateInput,
  generateSuggestions,
  mergeZoomSuggestions,
} from "../../editor/inspector/host/zoomSuggestions";
import type { ZoomRegion } from "../../editor/inspector/zoom/types";
import type { ProjectMeta } from "../../editor/persistence";
import type { DocumentUpdate } from "../../editor/state";
import type { ProjectStores } from "./openProject";

/**
 * Boot-time auto-zoom (ENGINEERING_SPEC §6.1 / §8, guide S12 state 1): a fresh
 * recording opens with the engine's suggestions already on the timeline as
 * ghost (`source:'auto'`) regions, added as ONE undo entry, and the
 * "We suggested N zooms · Keep all / Review / Dismiss" toast.
 *
 * "Fresh" = no zoom regions yet AND the project was never auto-zoomed on open.
 * The latter is persisted as `ui.collapsed[AUTO_ZOOM_ON_OPEN_FLAG]` (the only
 * free-form, round-tripped slot in the v1 document) so reopening a project whose
 * suggestions were dismissed or undone does not regenerate them.
 */

export const AUTO_ZOOM_ON_OPEN_FLAG = "autoZoomOnOpen";
export const AUTO_ZOOM_ON_OPEN_LABEL = "Auto-zoom suggestions";

export interface AutoZoomOnOpenPrefs {
  /** Settings `autoZoomOnNewRecording`. */
  enabled: boolean;
  /** Settings `autoZoomSensitivity`, 0..1. */
  sensitivity: number;
}

export const DEFAULT_AUTO_ZOOM_ON_OPEN: AutoZoomOnOpenPrefs = { enabled: true, sensitivity: 0.5 };

/** Read the two settings defensively (missing / malformed → defaults). */
export function autoZoomPrefsFromSettings(settings: unknown): AutoZoomOnOpenPrefs {
  const s = (typeof settings === "object" && settings !== null ? settings : {}) as Record<
    string,
    unknown
  >;
  const enabled =
    typeof s.autoZoomOnNewRecording === "boolean"
      ? s.autoZoomOnNewRecording
      : DEFAULT_AUTO_ZOOM_ON_OPEN.enabled;
  const raw = s.autoZoomSensitivity;
  const sensitivity =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(1, Math.max(0, raw))
      : DEFAULT_AUTO_ZOOM_ON_OPEN.sensitivity;
  return { enabled, sensitivity };
}

export function wasAutoZoomedOnOpen(meta: Pick<ProjectMeta, "ui"> | null): boolean {
  return meta?.ui?.collapsed?.[AUTO_ZOOM_ON_OPEN_FLAG] === true;
}

export function withAutoZoomedFlag(meta: ProjectMeta): ProjectMeta {
  return {
    ...meta,
    ui: { ...meta.ui, collapsed: { ...meta.ui?.collapsed, [AUTO_ZOOM_ON_OPEN_FLAG]: true } },
  };
}

export interface AutoZoomOnOpenDeps {
  stores: ProjectStores;
  documentUpdate: DocumentUpdate;
  prefs: AutoZoomOnOpenPrefs;
  /** Engine glue; injectable for tests. */
  generate?: ((input: GenerateInput) => SuggestedZoom[]) | undefined;
}

export type AutoZoomOnOpenResult =
  | { status: "skipped"; reason: "disabled" | "not-fresh" | "no-telemetry" }
  | { status: "applied"; suggestions: SuggestedZoom[] };

/**
 * Run once after the project is hydrated and the history is fresh. Adds the
 * suggestions as one history entry and marks the project as auto-zoomed (in
 * meta, outside the history: undoing the suggestions must not re-arm it).
 */
export function runAutoZoomOnOpen(deps: AutoZoomOnOpenDeps): AutoZoomOnOpenResult {
  const { stores, prefs } = deps;
  if (!prefs.enabled) return { status: "skipped", reason: "disabled" };
  const session = stores.session.getState();
  const editor = stores.editor.getState();
  if (editor.zoomRegions.length > 0 || wasAutoZoomedOnOpen(session.meta)) {
    return { status: "skipped", reason: "not-fresh" };
  }
  const telemetry = session.telemetry;
  if (!telemetry || telemetry.telemetry.points.length === 0) {
    return { status: "skipped", reason: "no-telemetry" };
  }

  const generate = deps.generate ?? generateSuggestions;
  const generated = generate({
    telemetry: telemetry.telemetry,
    sourceSize: session.sourceSize,
    clips: timelineClips(editor.clips, session.meta),
    settings: { ...editor.zoom.autoZoom, sensitivity: prefs.sensitivity },
  });

  if (session.meta) session.setSession({ meta: withAutoZoomedFlag(session.meta) });
  if (generated.length === 0) return { status: "applied", suggestions: [] };

  const zoomRegions = mergeZoomSuggestions(editor.zoomRegions, generated);
  deps.documentUpdate(AUTO_ZOOM_ON_OPEN_LABEL, { zoomRegions });
  // Ids as committed (merge de-duplicates), in timeline order.
  const byId = new Map(generated.map((s) => [s.id, s]));
  const suggestions = zoomRegions
    .filter((r) => r.source === "auto")
    .map((r) => ({ ...(byId.get(r.id) ?? (r as SuggestedZoom)), id: r.id }));
  return { status: "applied", suggestions };
}

/**
 * Remove the given suggestions that are still untouched (same id, still
 * `source:'auto'`). Edited regions became `manual` and survive (§8).
 */
export function withoutUntouchedSuggestions(
  regions: readonly ZoomRegion[],
  ids: Iterable<string>,
): ZoomRegion[] {
  const drop = new Set(ids);
  return regions.filter((r) => !(r.source === "auto" && drop.has(r.id)));
}
