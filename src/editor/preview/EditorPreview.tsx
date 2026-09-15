import type { ReactElement } from "react";
import { useProjectSession } from "../../app/project/session";
import { usePlaybackStore } from "../playback";
import { useEditorStore } from "../store";
import { PreviewCanvas } from "./PreviewCanvas";
import type { CreatePreviewStage } from "./pixiStage";

const PLACEHOLDER_SOURCE_SIZE = { width: 1920, height: 1080 } as const;

export interface EditorPreviewProps {
  /** Injected preview stage factory (tests); defaults to the Pixi stage. */
  createStage?: CreatePreviewStage | undefined;
  /** "Locate…" on the media-offline overlay. */
  onLocateMedia?: (() => void) | undefined;
}

/**
 * The editor's preview, bound to its stores: document (editor store), transport
 * (playback store) and open project (project session). EditorWindow renders this;
 * the preview module owns everything inside it.
 */
export function EditorPreview({ createStage, onLocateMedia }: EditorPreviewProps): ReactElement {
  const frame = useEditorStore((e) => e.frame);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const cursor = useEditorStore((e) => e.cursor);
  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const videoUrl = useProjectSession((s) => s.videoUrl);
  const sourceSize = useProjectSession((s) => s.sourceSize);
  const cursorTrack = useProjectSession((s) => s.cursorTrack);
  const mediaOffline = useProjectSession((s) => s.mediaOffline);

  return (
    <PreviewCanvas
      frame={frame}
      zoomRegions={zoomRegions}
      cursor={cursor}
      cursorTrack={cursorTrack}
      currentMs={currentMs}
      isPlaying={isPlaying}
      videoUrl={videoUrl}
      sourceSize={sourceSize ?? PLACEHOLDER_SOURCE_SIZE}
      mediaOffline={mediaOffline}
      onLocateMedia={onLocateMedia}
      createStage={createStage}
    />
  );
}
