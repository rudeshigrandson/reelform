import {
  type ReactElement,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useProjectSession } from "../app/project/session";
import { useAppSettings } from "../app/settings/store";
import { useOptionalShortcut, useOptionalShortcutsContext } from "../shortcuts/ShortcutsProvider";
import { type UsePreviewAudioOptions, usePreviewAudio } from "./audio";
import { InspectorPanel } from "./inspector/InspectorPanel";
import { cursorSamplesFromTelemetry } from "./inspector/host/telemetryInputs";
import { timelineClips } from "./inspector/host/timeMap";
import type { InspectorHost } from "./inspector/host/types";
import {
  PlaybackBar,
  rateAtFromRegions,
  usePlaybackLoop,
  usePlaybackShortcuts,
  usePlaybackStore,
} from "./playback";
import type { CreatePreviewStage } from "./preview";
import { EditorPreview } from "./preview/EditorPreview";
import { EditorShell } from "./shell/EditorShell";
import type { InspectorTab, PreviewQuality } from "./shell/types";
import { useTrimShortcuts } from "./shell/useTrimShortcuts";
import {
  EditorHistoryProvider,
  type History,
  createCanvasUpdate,
  createDocumentUpdate,
  createEditorHistory,
  useHistoryShortcuts,
  useHistoryState,
} from "./state";
import { type EditorState, useEditorStore, useEditorUiStore } from "./store";
import {
  HEADER_WIDTH_PX,
  type TimeSpan,
  Timeline,
  type TimelineMedia,
  type TrackKind,
} from "./timeline";
import {
  type FocusResolver,
  type ItemChange,
  addAtPlayhead,
  applyItemChange,
  applyItemsChange,
  buildTracks,
  countSelection,
  deleteSelection,
  duplicateItemAt,
  duplicateSelection,
  focusFromSamples,
  itemChangeLabel,
  nudgeSelection,
  scaleToZoom,
  selectAllOnTrack,
  selectionPatch,
  splitClipAt,
  trackKindOf,
  trimClipToPlayhead,
  zoomToScale,
} from "./timelineBinding";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const ADD_LABELS: Readonly<Record<TrackKind, string>> = {
  video: "Add clip",
  zoom: "Add zoom",
  speed: "Add speed region",
  annotations: "Add annotation",
  captions: "Add caption",
};

/** ⌘= / ⌘- step on the playback-bar zoom slider (0 = fit, 1 = 5s visible). */
export const TIMELINE_ZOOM_STEP = 0.1;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Width of an element, tracked with ResizeObserver (0 where unavailable, e.g. jsdom). */
function useElementWidth(): [RefCallback<HTMLElement>, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

export interface EditorWindowProps {
  projectName: string;
  onExport: () => void;
  /** Injected preview stage factory (tests); defaults to the Pixi stage. */
  createStage?: CreatePreviewStage | undefined;
  /**
   * Document history (the project container owns it so save points line up).
   * Omitted → the window creates one capped at `undoHistorySize`.
   */
  history?: History<EditorState> | undefined;
  /** Settings `undoHistorySize`; used only when `history` is omitted. */
  undoHistorySize?: number | undefined;
  /** Unsaved changes indicator in the top bar. */
  dirty?: boolean | undefined;
  onBack?: (() => void) | undefined;
  /** Top-bar project name committed (blur / Enter); omitted → the name is read-only. */
  /** May return a `Promise<boolean>`; resolving `false` reverts the field. */
  onRename?: ((name: string) => unknown) | undefined;
  onLocateMedia?: (() => void) | undefined;
  /** Source video length: lets clip edges grow back out after a trim. */
  sourceDurationMs?: number | undefined;
  /** Force the narrow layout; omitted → follows the window width. */
  narrow?: boolean | undefined;
  /**
   * Builds the inspector host (dialogs, project folder, captions runtime,
   * history) from this window's document history. Called once per history;
   * omitted → the inspector's store-only fallback host.
   */
  createInspectorHost?: ((history: History<EditorState>) => InspectorHost) | undefined;
  /** Preview audio player options (noise reduction worklet; a fake player in tests). */
  audioOptions?: UsePreviewAudioOptions | undefined;
}

/** Inspector tab for the first selected item kind (§6.8 auto-switch). */
function tabForSelection(
  patch: ReturnType<typeof selectionPatch>,
  captions: readonly { id: string }[],
  ids: ReadonlySet<string>,
): InspectorTab | null {
  if (patch.selectedZoomId) return "Zoom";
  if (patch.selectedAnnotationId) return "Annotations";
  if (patch.selectedSpeedId) return "Effects";
  if (captions.some((c) => ids.has(c.id))) return "Captions";
  return null;
}

/**
 * Editor window composition (SPEC §6): shell + inspector bound to the document
 * store, transport bound to the playback store, preview audio, and every
 * timeline / canvas edit routed through the pure `timelineBinding` patches into
 * the undo history (§7). Keyboard actions bind by registry id (§6.9) inside a
 * shortcuts provider; undo/redo and trim keep fixed listeners standalone.
 */
export function EditorWindow({
  projectName,
  onExport,
  createStage,
  history: providedHistory,
  undoHistorySize,
  dirty,
  onBack,
  onRename,
  onLocateMedia,
  sourceDurationMs,
  narrow,
  createInspectorHost,
  audioOptions,
}: EditorWindowProps): ReactElement {
  const durationMs = useEditorStore((e) => e.durationMs);
  const clips = useEditorStore((e) => e.clips);
  const speedRegions = useEditorStore((e) => e.speedRegions);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const annotations = useEditorStore((e) => e.annotations);
  const captions = useEditorStore((e) => e.captions);
  const audio = useEditorStore((e) => e.audio);
  const clickSound = useEditorStore((e) => e.cursor.clickSound);
  const update = useEditorStore((e) => e.update);
  const pendingSuggestionIds = useEditorUiStore((u) => u.pendingSuggestionIds);
  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const loop = usePlaybackStore((p) => p.loop);
  const fps = usePlaybackStore((p) => p.fps);

  const micUrl = useProjectSession((s) => s.micUrl);
  const systemAudioUrl = useProjectSession((s) => s.systemAudioUrl);
  const mediaBaseUrl = useProjectSession((s) => s.mediaBaseUrl);
  const telemetry = useProjectSession((s) => s.telemetry);
  const thumbnails = useProjectSession((s) => s.thumbnails);
  const waveformPeaks = useProjectSession((s) => s.waveformPeaks);
  const sourceSize = useProjectSession((s) => s.sourceSize);
  const sessionSourceMs = useProjectSession((s) => s.meta?.sources.video.durationMs);

  const inspectorAutoSwitch = useAppSettings((s) => s.settings.inspectorAutoSwitch);

  const [ownHistory] = useState(() =>
    providedHistory ? null : createEditorHistory({ cap: undoHistorySize }),
  );
  const history = (providedHistory ?? ownHistory) as History<EditorState>;
  const historyState = useHistoryState(history);
  const commit = useMemo(() => createDocumentUpdate(history), [history]);
  const canvasUpdate = useMemo(() => createCanvasUpdate(commit), [commit]);

  // Settings are read once when the window opens; the toggles are per window after that.
  const [snapEnabled, setSnapEnabled] = useState(
    () => useAppSettings.getState().settings.snapByDefault,
  );
  const [quality, setQuality] = useState<PreviewQuality>(
    () => useAppSettings.getState().settings.previewQuality,
  );
  const [timelineZoom, setTimelineZoom] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [activeTab, setActiveTab] = useState<InspectorTab>("Frame");
  const [timelineRef, timelineWidth] = useElementWidth();

  useEffect(() => {
    usePlaybackStore.getState().setDuration(durationMs);
  }, [durationMs]);

  const rateAt = useMemo(() => rateAtFromRegions(speedRegions), [speedRegions]);
  usePlaybackLoop({ rateAt });

  usePreviewAudio(
    {
      micUrl,
      systemAudioUrl,
      mediaBaseUrl,
      audio,
      clickSound,
      telemetry: telemetry?.telemetry ?? null,
      clips,
      speeds: speedRegions,
      durationMs,
    },
    audioOptions,
  );

  const videoMedia = useMemo<TimelineMedia | undefined>(
    () =>
      thumbnails.length > 0 || waveformPeaks
        ? {
            thumbs: thumbnails,
            peaks: waveformPeaks ?? undefined,
            // Without source metadata the furthest clip end is the best known source length.
            sourceDurationMs:
              sessionSourceMs ??
              sourceDurationMs ??
              clips.reduce((end, c) => Math.max(end, c.sourceEndMs), 0),
            aspect:
              sourceSize && sourceSize.height > 0
                ? sourceSize.width / sourceSize.height
                : undefined,
          }
        : undefined,
    [thumbnails, waveformPeaks, sessionSourceMs, sourceDurationMs, sourceSize, clips],
  );

  // Tracks only rebuild when the document changes, never on playhead moves (§6.2).
  const tracks = useMemo(
    () =>
      buildTracks(
        { durationMs, clips, zoomRegions, speedRegions, annotations, captions, audio },
        { pendingSuggestionIds, videoMedia },
      ),
    [
      durationMs,
      clips,
      zoomRegions,
      speedRegions,
      annotations,
      captions,
      audio,
      pendingSuggestionIds,
      videoMedia,
    ],
  );

  // Undo can remove selected items; drop ids that no longer exist.
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const live = new Set(tracks.flatMap((t) => t.items.map((i) => i.id)));
    const kept = [...selectedIds].filter((id) => live.has(id));
    if (kept.length !== selectedIds.size) setSelectedIds(new Set(kept));
  }, [tracks, selectedIds]);

  const select = useCallback(
    (ids: ReadonlySet<string>) => {
      setSelectedIds(ids);
      const doc = useEditorStore.getState();
      const patch = selectionPatch(doc, ids);
      // Selection is UI state (§4 `ui`), not an undoable edit.
      update(patch);
      const tab = tabForSelection(patch, doc.captions, ids);
      if (tab && inspectorAutoSwitch) setActiveTab(tab);
    },
    [update, inspectorAutoSwitch],
  );

  const onItemChange = useCallback(
    (kind: TrackKind, span: TimeSpan) => {
      const doc = useEditorStore.getState();
      const patch = applyItemChange(doc, kind, span, { sourceDurationMs, makeId: newId });
      if (patch) commit(itemChangeLabel(doc, kind, span), patch, `drag:${kind}:${span.id}`);
    },
    [commit, sourceDurationMs],
  );

  const onItemsChange = useCallback(
    (changes: readonly ItemChange[]) => {
      const first = changes[0];
      if (!first) return;
      const doc = useEditorStore.getState();
      const patch = applyItemsChange(doc, changes, { sourceDurationMs, makeId: newId });
      if (!patch) return;
      const group = changes.length > 1 && changes.every((c) => selectedIds.has(c.span.id));
      // Shift-drop: the dragged item names the edit; its neighbour trims ride along.
      commit(group ? "Move items" : itemChangeLabel(doc, first.kind, first.span), patch);
    },
    [commit, sourceDurationMs, selectedIds],
  );

  const onItemDuplicate = useCallback(
    (kind: TrackKind, span: TimeSpan) => {
      const result = duplicateItemAt(useEditorStore.getState(), kind, span, newId);
      if (!result) return;
      commit("Duplicate", result.patch);
      select(new Set([result.id]));
    },
    [commit, select],
  );

  /** Cursor position at a timeline time, from telemetry (§9.3); built lazily per add. */
  const focusAt = useCallback((): FocusResolver | undefined => {
    const { telemetry: t, meta } = useProjectSession.getState();
    const samples = cursorSamplesFromTelemetry(
      t?.telemetry ?? null,
      timelineClips(useEditorStore.getState().clips, meta),
    );
    return samples && samples.length > 0 ? (tMs) => focusFromSamples(samples, tMs) : undefined;
  }, []);

  const onAddAtPlayhead = useCallback(
    (kind: TrackKind) => {
      const playheadMs = usePlaybackStore.getState().currentMs;
      const resolver = kind === "zoom" ? focusAt() : undefined;
      const result = addAtPlayhead(useEditorStore.getState(), kind, playheadMs, newId, resolver);
      if (!result) return;
      commit(ADD_LABELS[kind], result.patch);
      setSelectedIds(new Set([result.id]));
    },
    [commit, focusAt],
  );

  const canDelete = selectedIds.size > 0;
  const onDelete = useCallback(() => {
    const doc = useEditorStore.getState();
    const patch = deleteSelection(doc, selectedIds);
    if (patch) {
      const ripple = doc.clips.some((c) => selectedIds.has(c.id));
      commit(ripple ? "Ripple delete" : "Delete", patch);
    }
    setSelectedIds(EMPTY_SELECTION);
  }, [selectedIds, commit]);

  const onSplit = useCallback(() => {
    const patch = splitClipAt(
      useEditorStore.getState(),
      usePlaybackStore.getState().currentMs,
      newId,
    );
    if (patch) commit("Split clip", patch);
  }, [commit]);

  const trim = useCallback(
    (edge: "start" | "end") => {
      const playheadMs = usePlaybackStore.getState().currentMs;
      const doc = useEditorStore.getState();
      const patch = trimClipToPlayhead(doc, playheadMs, edge);
      if (!patch) return;
      // `[` removes the time before the playhead: its frame now sits at the clip's old start.
      const clipStart = doc.clips
        .filter((c) => c.timelineStartMs < playheadMs)
        .reduce((at, c) => Math.max(at, c.timelineStartMs), 0);
      commit(edge === "start" ? "Trim clip start" : "Trim clip end", patch);
      if (edge === "start") usePlaybackStore.getState().seek(clipStart);
    },
    [commit],
  );

  /** ←/→ with a selection nudges it one frame; declines (→ frame step) without one. */
  const nudge = (direction: -1 | 1): boolean => {
    const doc = useEditorStore.getState();
    const counts = countSelection(doc, selectedIds);
    if (counts.zoom + counts.speed + counts.annotations + counts.captions === 0) return false;
    const frameMs = fps > 0 ? 1000 / fps : 1000 / 30;
    const patch = nudgeSelection(doc, selectedIds, direction * frameMs);
    if (patch) commit("Nudge", patch, "timeline:nudge");
    return true;
  };

  const duplicateSelected = (): boolean => {
    const result = duplicateSelection(useEditorStore.getState(), selectedIds, newId);
    if (!result) return false;
    commit("Duplicate", result.patch);
    select(new Set(result.ids));
    return true;
  };

  const selectAll = (event: KeyboardEvent): boolean => {
    const lane = event.target instanceof Element ? event.target.closest("[data-track-kind]") : null;
    const fromFocus = lane?.getAttribute("data-track-kind") as TrackKind | null | undefined;
    const first = [...selectedIds][0];
    const kind = fromFocus ?? (first !== undefined ? trackKindOf(tracks, first) : null);
    if (!kind) return false;
    select(selectAllOnTrack(tracks, kind));
    return true;
  };

  usePlaybackShortcuts({ onDelete: canDelete ? onDelete : undefined, onSplit });

  // Registry-bound actions (§6.9): user overrides and focus scopes apply.
  const hasShortcuts = useOptionalShortcutsContext() !== null;
  useHistoryShortcuts(history, { enabled: !hasShortcuts });
  useTrimShortcuts({
    onTrimStart: () => trim("start"),
    onTrimEnd: () => trim("end"),
    enabled: !hasShortcuts,
  });
  useOptionalShortcut("editor.undo", () => void history.undo());
  useOptionalShortcut("editor.redo", () => void history.redo());
  useOptionalShortcut("timeline.trimStart", () => void trim("start"));
  useOptionalShortcut("timeline.trimEnd", () => void trim("end"));
  useOptionalShortcut("timeline.nudgeBack", () => nudge(-1));
  useOptionalShortcut("timeline.nudgeForward", () => nudge(1));
  useOptionalShortcut("timeline.duplicate", () => duplicateSelected());
  useOptionalShortcut("timeline.selectAll", (e) => selectAll(e));
  useOptionalShortcut("timeline.rippleDelete", () => {
    if (!canDelete) return false;
    onDelete();
    return true;
  });
  useOptionalShortcut(
    "editor.zoomIn",
    () => void setTimelineZoom((z) => clamp01(z + TIMELINE_ZOOM_STEP)),
  );
  useOptionalShortcut(
    "editor.zoomOut",
    () => void setTimelineZoom((z) => clamp01(z - TIMELINE_ZOOM_STEP)),
  );
  useOptionalShortcut("editor.clearSelection", () => {
    if (selectedIds.size === 0) return false;
    select(EMPTY_SELECTION);
    return true;
  });
  useOptionalShortcut("editor.export", () => void onExport());

  const viewportPx = Math.max(0, timelineWidth - HEADER_WIDTH_PX);
  const pxPerMs = viewportPx > 0 ? zoomToScale(timelineZoom, durationMs, viewportPx) : undefined;
  const playback = usePlaybackStore.getState();
  // One host per history: re-creating it re-decodes audio (pass a stable factory).
  const inspectorHost = useMemo(
    () => createInspectorHost?.(history),
    [createInspectorHost, history],
  );

  return (
    <EditorHistoryProvider history={history}>
      <EditorShell
        projectName={projectName}
        durationMs={durationMs}
        currentMs={currentMs}
        isPlaying={isPlaying}
        previewQuality={quality}
        onQualityChange={setQuality}
        onRename={onRename}
        onExport={onExport}
        onTogglePlay={playback.toggle}
        onBack={onBack}
        dirty={dirty}
        narrow={narrow}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        history={{
          canUndo: historyState.canUndo,
          canRedo: historyState.canRedo,
          undoLabel: historyState.undoLabel,
          redoLabel: historyState.redoLabel,
          onUndo: () => void history.undo(),
          onRedo: () => void history.redo(),
        }}
        renderInspector={(tab) => (
          <InspectorPanel
            tab={tab}
            host={inspectorHost}
            selectedIds={selectedIds}
            onSelect={select}
            makeId={newId}
          />
        )}
        renderPreview={() => (
          <EditorPreview
            createStage={createStage}
            onLocateMedia={onLocateMedia}
            update={canvasUpdate}
            quality={quality}
          />
        )}
        renderPlaybackBar={() => (
          <PlaybackBar
            currentMs={currentMs}
            durationMs={durationMs}
            fps={fps}
            isPlaying={isPlaying}
            loop={loop}
            snapEnabled={snapEnabled}
            timelineZoom={timelineZoom}
            onTogglePlay={playback.toggle}
            onStepFrame={playback.stepFrame}
            onSkipStart={playback.skipToStart}
            onSkipEnd={playback.skipToEnd}
            onLoopChange={playback.setLoop}
            onSplit={onSplit}
            onDelete={onDelete}
            canDelete={canDelete}
            onSnapChange={setSnapEnabled}
            onTimelineZoomChange={setTimelineZoom}
            onFit={() => setTimelineZoom(0)}
          />
        )}
        renderTimeline={() => (
          <div ref={timelineRef} style={{ flex: "1 1 auto", minHeight: 0 }}>
            <Timeline
              durationMs={durationMs}
              currentMs={currentMs}
              fps={fps}
              tracks={tracks}
              selectedIds={selectedIds}
              snapEnabled={snapEnabled}
              pxPerMs={pxPerMs}
              onScaleChange={(next) => {
                if (viewportPx > 0) setTimelineZoom(scaleToZoom(next, durationMs, viewportPx));
              }}
              isPlaying={isPlaying}
              onSeek={playback.seek}
              onSelect={select}
              onItemChange={onItemChange}
              onItemsChange={onItemsChange}
              onItemDuplicate={onItemDuplicate}
              onAddAtPlayhead={onAddAtPlayhead}
            />
          </div>
        )}
      />
    </EditorHistoryProvider>
  );
}
