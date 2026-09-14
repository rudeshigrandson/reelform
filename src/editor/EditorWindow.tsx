import { type ReactElement, useEffect, useMemo, useState } from "react";
import { InspectorPanel } from "./inspector/InspectorPanel";
import {
  PlaybackBar,
  rateAtFromRegions,
  usePlaybackLoop,
  usePlaybackShortcuts,
  usePlaybackStore,
} from "./playback";
import { type CreatePreviewStage, PreviewCanvas } from "./preview";
import { EditorShell } from "./shell/EditorShell";
import { useEditorStore } from "./store";

const PLACEHOLDER_SOURCE_SIZE = { width: 1920, height: 1080 } as const;

export interface EditorWindowProps {
  projectName: string;
  onExport: () => void;
  /** Injected preview stage factory (tests); defaults to the Pixi stage. */
  createStage?: CreatePreviewStage | undefined;
}

/**
 * Editor window composition (SPEC §6): shell + inspector bound to the document
 * store, transport bound to the playback store. Preview and timeline slots are
 * filled here as those modules land.
 */
export function EditorWindow({
  projectName,
  onExport,
  createStage,
}: EditorWindowProps): ReactElement {
  const durationMs = useEditorStore((e) => e.durationMs);
  const speedRegions = useEditorStore((e) => e.speedRegions);
  const frame = useEditorStore((e) => e.frame);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const cursor = useEditorStore((e) => e.cursor);

  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const loop = usePlaybackStore((p) => p.loop);
  const fps = usePlaybackStore((p) => p.fps);

  const [snapEnabled, setSnapEnabled] = useState(true);
  const [timelineZoom, setTimelineZoom] = useState(0);

  useEffect(() => {
    usePlaybackStore.getState().setDuration(durationMs);
  }, [durationMs]);

  const rateAt = useMemo(() => rateAtFromRegions(speedRegions), [speedRegions]);
  usePlaybackLoop({ rateAt });
  usePlaybackShortcuts();

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
      renderPreview={() => (
        <PreviewCanvas
          frame={frame}
          zoomRegions={zoomRegions}
          cursor={cursor}
          currentMs={currentMs}
          isPlaying={isPlaying}
          // No media source until the project open path lands (SPEC §6.1).
          videoUrl={null}
          sourceSize={PLACEHOLDER_SOURCE_SIZE}
          createStage={createStage}
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
          onSplit={() => {}}
          onDelete={() => {}}
          canDelete={false}
          onSnapChange={setSnapEnabled}
          onTimelineZoomChange={setTimelineZoom}
          onFit={() => setTimelineZoom(0)}
        />
      )}
    />
  );
}
