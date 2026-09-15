import {
  type ReactElement,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { InspectorPanel } from "./inspector/InspectorPanel";
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
import type { InspectorTab } from "./shell/types";
import { useTrimShortcuts } from "./shell/useTrimShortcuts";
import {
  EditorHistoryProvider,
  type History,
  createDocumentUpdate,
  createEditorHistory,
  useHistoryShortcuts,
  useHistoryState,
} from "./state";
import { type EditorState, useEditorStore } from "./store";
import { HEADER_WIDTH_PX, type TimeSpan, Timeline, type TrackKind } from "./timeline";
import {
  addAtPlayhead,
  applyItemChange,
  buildTracks,
  deleteSelection,
  itemChangeLabel,
  scaleToZoom,
  selectionPatch,
  splitClipAt,
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
}

/** Inspector tab for the first selected item kind (§6.8 auto-switch). */
function tabForSelection(patch: ReturnType<typeof selectionPatch>): InspectorTab | null {
  if (patch.selectedZoomId) return "Zoom";
  if (patch.selectedAnnotationId) return "Annotations";
  if (patch.selectedSpeedId) return "Effects";
  return null;
}

/**
 * Editor window composition (SPEC §6): shell + inspector bound to the document
 * store, transport bound to the playback store, and every timeline edit routed
 * through the pure `timelineBinding` patches into the undo history (§7).
 */
export function EditorWindow({
  projectName,
  onExport,
  createStage,
  history: providedHistory,
  undoHistorySize,
  dirty,
  onBack,
  onLocateMedia,
  sourceDurationMs,
  narrow,
  createInspectorHost,
}: EditorWindowProps): ReactElement {
  const durationMs = useEditorStore((e) => e.durationMs);
  const clips = useEditorStore((e) => e.clips);
  const speedRegions = useEditorStore((e) => e.speedRegions);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const annotations = useEditorStore((e) => e.annotations);
  const captions = useEditorStore((e) => e.captions);
  const audio = useEditorStore((e) => e.audio);
  const update = useEditorStore((e) => e.update);
  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const loop = usePlaybackStore((p) => p.loop);
  const fps = usePlaybackStore((p) => p.fps);

  const [ownHistory] = useState(() =>
    providedHistory ? null : createEditorHistory({ cap: undoHistorySize }),
  );
  const history = (providedHistory ?? ownHistory) as History<EditorState>;
  const historyState = useHistoryState(history);
  useHistoryShortcuts(history);
  const commit = useMemo(() => createDocumentUpdate(history), [history]);

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [activeTab, setActiveTab] = useState<InspectorTab>("Frame");
  const [timelineRef, timelineWidth] = useElementWidth();

  useEffect(() => {
    usePlaybackStore.getState().setDuration(durationMs);
  }, [durationMs]);

  const rateAt = useMemo(() => rateAtFromRegions(speedRegions), [speedRegions]);
  usePlaybackLoop({ rateAt });

  // Tracks only rebuild when the document changes, never on playhead moves (§6.2).
  const tracks = useMemo(
    () =>
      buildTracks({ durationMs, clips, zoomRegions, speedRegions, annotations, captions, audio }),
    [durationMs, clips, zoomRegions, speedRegions, annotations, captions, audio],
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
      const patch = selectionPatch(useEditorStore.getState(), ids);
      // Selection is UI state (§4 `ui`), not an undoable edit.
      update(patch);
      const tab = tabForSelection(patch);
      if (tab) setActiveTab(tab);
    },
    [update],
  );

  const onItemChange = useCallback(
    (kind: TrackKind, span: TimeSpan) => {
      const doc = useEditorStore.getState();
      const patch = applyItemChange(doc, kind, span, { sourceDurationMs, makeId: newId });
      if (patch) commit(itemChangeLabel(doc, kind, span), patch, `drag:${kind}:${span.id}`);
    },
    [commit, sourceDurationMs],
  );

  const onAddAtPlayhead = useCallback(
    (kind: TrackKind) => {
      const playheadMs = usePlaybackStore.getState().currentMs;
      const result = addAtPlayhead(useEditorStore.getState(), kind, playheadMs, newId);
      if (!result) return;
      commit(ADD_LABELS[kind], result.patch);
      setSelectedIds(new Set([result.id]));
    },
    [commit],
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

  usePlaybackShortcuts({ onDelete: canDelete ? onDelete : undefined, onSplit });
  useTrimShortcuts({ onTrimStart: () => trim("start"), onTrimEnd: () => trim("end") });

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
        previewQuality="auto"
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
        renderInspector={(tab) => <InspectorPanel tab={tab} host={inspectorHost} />}
        renderPreview={() => (
          <EditorPreview createStage={createStage} onLocateMedia={onLocateMedia} />
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
              onAddAtPlayhead={onAddAtPlayhead}
            />
          </div>
        )}
      />
    </EditorHistoryProvider>
  );
}
