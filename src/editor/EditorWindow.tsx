import {
  type ReactElement,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { InspectorPanel } from "./inspector/InspectorPanel";
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
import { useEditorStore } from "./store";
import { HEADER_WIDTH_PX, type TimeSpan, Timeline, type TrackKind } from "./timeline";
import {
  addAtPlayhead,
  applyItemChange,
  buildTracks,
  deleteSelection,
  scaleToZoom,
  selectionPatch,
  zoomToScale,
} from "./timelineBinding";
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

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
}

/**
 * Editor window composition (SPEC §6): shell + inspector bound to the document
 * store, transport bound to the playback store, timeline edits routed through
 * the pure `timelineBinding` patches.
 */
export function EditorWindow({
  projectName,
  onExport,
  createStage,
}: EditorWindowProps): ReactElement {
  const durationMs = useEditorStore((e) => e.durationMs);
  const speedRegions = useEditorStore((e) => e.speedRegions);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const annotations = useEditorStore((e) => e.annotations);
  const captions = useEditorStore((e) => e.captions);
  const update = useEditorStore((e) => e.update);

  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const loop = usePlaybackStore((p) => p.loop);
  const fps = usePlaybackStore((p) => p.fps);

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(0);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [timelineRef, timelineWidth] = useElementWidth();

  useEffect(() => {
    usePlaybackStore.getState().setDuration(durationMs);
  }, [durationMs]);

  const rateAt = useMemo(() => rateAtFromRegions(speedRegions), [speedRegions]);
  usePlaybackLoop({ rateAt });

  // Tracks only rebuild when the document changes, never on playhead moves (§6.2).
  const tracks = useMemo(
    () => buildTracks({ durationMs, zoomRegions, speedRegions, annotations, captions }),
    [durationMs, zoomRegions, speedRegions, annotations, captions],
  );

  const select = useCallback(
    (ids: ReadonlySet<string>) => {
      setSelectedIds(ids);
      update(selectionPatch(useEditorStore.getState(), ids));
    },
    [update],
  );

  const onItemChange = useCallback(
    (kind: TrackKind, span: TimeSpan) => {
      const patch = applyItemChange(useEditorStore.getState(), kind, span);
      if (patch) update(patch);
    },
    [update],
  );

  const onAddAtPlayhead = useCallback(
    (kind: TrackKind) => {
      const playheadMs = usePlaybackStore.getState().currentMs;
      const result = addAtPlayhead(useEditorStore.getState(), kind, playheadMs, newId);
      if (!result) return;
      update(result.patch);
      setSelectedIds(new Set([result.id]));
    },
    [update],
  );

  const canDelete = selectedIds.size > 0;
  const onDelete = useCallback(() => {
    const patch = deleteSelection(useEditorStore.getState(), selectedIds);
    if (patch) update(patch);
    setSelectedIds(EMPTY_SELECTION);
  }, [selectedIds, update]);

  usePlaybackShortcuts({ onDelete: canDelete ? onDelete : undefined });

  const viewportPx = Math.max(0, timelineWidth - HEADER_WIDTH_PX);
  const pxPerMs = viewportPx > 0 ? zoomToScale(timelineZoom, durationMs, viewportPx) : undefined;

  const playback = usePlaybackStore.getState();

  return (
    <EditorShell
      projectName={projectName}
      durationMs={durationMs}
      currentMs={currentMs}
      isPlaying={isPlaying}
      previewQuality="auto"
      onExport={onExport}
      onTogglePlay={playback.toggle}
      renderInspector={(tab) => <InspectorPanel tab={tab} />}
      renderPreview={() => <EditorPreview createStage={createStage} />}
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
          // Split needs clips in the document; lands with the project model.
          onSplit={() => {}}
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
  );
}
