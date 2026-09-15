import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useProjectSession } from "../../app/project/session";
import type { Clip } from "../model/schema";
import { usePlaybackStore } from "../playback";
import type { CanvasEdit } from "../state/canvasGesture";
import { type EditorData, type EditorState, useEditorStore } from "../store";
import { PreviewCanvas } from "./PreviewCanvas";
import { buildCursorMotion } from "./cursorEffects";
import { type FetchJson, fetchJsonViaFetch } from "./cursorPack";
import type { AnnotationBox, WebcamPosition } from "./overlays/CanvasOverlays";
import type { NormRect } from "./overlays/cropMath";
import type { CreatePreviewStage } from "./pixiStage";
import type { PreviewQuality } from "./quality";
import type { SceneAssets } from "./sceneGraph";
import { type WallpaperRegistry, loadWallpaperRegistry } from "./wallpapers";

const PLACEHOLDER_SOURCE_SIZE = { width: 1920, height: 1080 } as const;

export interface EditorPreviewProps {
  /** Injected preview stage factory (tests); defaults to the Pixi stage. */
  createStage?: CreatePreviewStage | undefined;
  /** "Locate…" on the media-offline overlay. */
  onLocateMedia?: (() => void) | undefined;
  /**
   * Writer for canvas edits; defaults to `useEditorStore`'s `update`. `edit`
   * names the gesture (label + coalesce key) and marks the pointer release, so a
   * history-backed writer records one undo entry per gesture.
   */
  update?: ((patch: Partial<EditorData>, edit: CanvasEdit) => void) | undefined;
  /** Top-bar preview quality (Auto / Full / Half). */
  quality?: PreviewQuality | undefined;
  /** Timeline playhead drag in progress (fastSeek). */
  scrubbing?: boolean | undefined;
  /** Controlled crop mode; uncontrolled (canvas "Crop" button) when omitted. */
  cropMode?: boolean | undefined;
  onCropModeChange?: ((on: boolean) => void) | undefined;
  /** Notified after the store write (e.g. to record a history entry on commit). */
  onZoomFocusChange?:
    | ((id: string, focus: { x: number; y: number }, commit: boolean) => void)
    | undefined;
  onAnnotationBoxChange?: ((id: string, box: AnnotationBox, commit: boolean) => void) | undefined;
  onCropCommit?: ((crop: NormRect | null) => void) | undefined;
  onWebcamMove?: ((pos: WebcamPosition, commit: boolean) => void) | undefined;
  /** JSON loader for `/wallpapers/wallpapers.json` (tests). */
  fetchJson?: FetchJson | undefined;
  /** Stage asset loading (textures, cursor packs). */
  assets?: SceneAssets | undefined;
}

/** Clips if the editor store ever holds them (the document keeps them in project meta today). */
const selectStoreClips = (e: EditorState): readonly Clip[] | undefined =>
  (e as EditorState & { clips?: readonly Clip[] | undefined }).clips;

/** Undo labels + per-gesture coalesce keys for canvas edits (SPEC §7). */
export const CANVAS_EDITS = {
  zoomFocus: (id: string) => ({ label: "Move zoom focus", coalesceKey: `canvas:zoomFocus:${id}` }),
  annotation: (id: string) => ({
    label: "Move annotation",
    coalesceKey: `canvas:annotation:${id}`,
  }),
  crop: { label: "Crop", coalesceKey: "canvas:crop" },
  webcam: { label: "Move webcam", coalesceKey: "canvas:webcam" },
} as const;

/**
 * The editor's preview, bound to its stores: document (editor store), transport
 * (playback store) and open project (project session). EditorWindow renders this;
 * the preview module owns everything inside it. Canvas edits (zoom focus,
 * annotation transform, crop, webcam position) are written through `update`.
 */
export function EditorPreview({
  createStage,
  onLocateMedia,
  update: updateProp,
  quality,
  scrubbing,
  cropMode: cropModeProp,
  onCropModeChange,
  onZoomFocusChange,
  onAnnotationBoxChange,
  onCropCommit,
  onWebcamMove,
  fetchJson = fetchJsonViaFetch,
  assets,
}: EditorPreviewProps): ReactElement {
  const frame = useEditorStore((e) => e.frame);
  const zoomRegions = useEditorStore((e) => e.zoomRegions);
  const cursor = useEditorStore((e) => e.cursor);
  const annotations = useEditorStore((e) => e.annotations);
  const selectedZoomId = useEditorStore((e) => e.selectedZoomId);
  const selectedAnnotationId = useEditorStore((e) => e.selectedAnnotationId);
  const captionList = useEditorStore((e) => e.captions);
  const captionStyle = useEditorStore((e) => e.captionStyle);
  const burnInCaptions = useEditorStore((e) => e.burnInCaptions);
  const webcam = useEditorStore((e) => e.webcam);
  const effects = useEditorStore((e) => e.effects);
  const speedRegions = useEditorStore((e) => e.speedRegions);
  const durationMs = useEditorStore((e) => e.durationMs);
  const storeClips = useEditorStore(selectStoreClips);
  const storeUpdate = useEditorStore((e) => e.update);
  const update = updateProp ?? storeUpdate;

  const currentMs = usePlaybackStore((p) => p.currentMs);
  const isPlaying = usePlaybackStore((p) => p.isPlaying);
  const shuttleRate = usePlaybackStore((p) => p.shuttleRate);
  const fps = usePlaybackStore((p) => p.fps);

  const originalUrl = useProjectSession((s) => s.videoUrl);
  const proxyUrl = useProjectSession((s) => s.proxyUrl);
  // Auto / Half play the low-res proxy once it exists; Full (and export) use the original.
  const videoUrl = proxyUrl !== null && quality !== "full" ? proxyUrl : originalUrl;
  const webcamUrl = useProjectSession((s) => s.webcamUrl);
  const sourceSize = useProjectSession((s) => s.sourceSize);
  const cursorTrack = useProjectSession((s) => s.cursorTrack);
  const mediaOffline = useProjectSession((s) => s.mediaOffline);
  const telemetry = useProjectSession((s) => s.telemetry);
  const meta = useProjectSession((s) => s.meta);
  const mediaBaseUrl = useProjectSession((s) => s.mediaBaseUrl);

  const clips = storeClips ?? meta?.clips ?? null;
  const motion = useMemo(
    () =>
      telemetry
        ? buildCursorMotion({ points: telemetry.cursorPoints, clicks: telemetry.telemetry.clicks })
        : null,
    [telemetry],
  );
  const webcamSource = meta?.sources.webcam;
  const webcamSourceSize = useMemo(
    () => (webcamSource ? { width: webcamSource.width, height: webcamSource.height } : null),
    [webcamSource],
  );
  const captions = useMemo(
    () => ({ captions: captionList, style: captionStyle, enabled: burnInCaptions }),
    [captionList, captionStyle, burnInCaptions],
  );

  const [wallpapers, setWallpapers] = useState<WallpaperRegistry | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadWallpaperRegistry(fetchJson).then((reg) => {
      if (!cancelled && reg.size > 0) setWallpapers(reg);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchJson]);

  const [cropLocal, setCropLocal] = useState(false);
  const cropMode = cropModeProp ?? cropLocal;
  const setCropMode = (on: boolean): void => {
    setCropLocal(on);
    onCropModeChange?.(on);
  };

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
      clips={clips}
      speedRegions={speedRegions}
      shuttleRate={shuttleRate}
      scrubbing={scrubbing}
      fps={fps}
      durationMs={durationMs}
      quality={quality}
      annotations={annotations}
      captions={captions}
      effects={effects}
      webcam={webcam}
      webcamUrl={webcamUrl}
      webcamRegions={meta?.webcamRegions}
      webcamSourceSize={webcamSourceSize}
      motion={motion}
      wallpapers={wallpapers}
      assets={assets}
      mediaBaseUrl={mediaBaseUrl}
      selectedZoomId={selectedZoomId}
      selectedAnnotationId={selectedAnnotationId}
      cropMode={cropMode}
      onCropModeChange={setCropMode}
      onCropCommit={(crop) => {
        update({ frame: { ...frame, crop } }, { ...CANVAS_EDITS.crop, commit: true });
        onCropCommit?.(crop);
      }}
      onZoomFocusChange={(id, focus, commit) => {
        update(
          {
            zoomRegions: zoomRegions.map((r) =>
              r.id === id ? { ...r, focus: { mode: "fixed", x: focus.x, y: focus.y } } : r,
            ),
          },
          { ...CANVAS_EDITS.zoomFocus(id), commit },
        );
        onZoomFocusChange?.(id, focus, commit);
      }}
      onAnnotationBoxChange={(id, box, commit) => {
        update(
          { annotations: annotations.map((a) => (a.id === id ? { ...a, ...box } : a)) },
          { ...CANVAS_EDITS.annotation(id), commit },
        );
        onAnnotationBoxChange?.(id, box, commit);
      }}
      onWebcamMove={(pos, commit) => {
        update(
          {
            webcam: { ...webcam, anchor: pos.anchor, customX: pos.customX, customY: pos.customY },
          },
          { ...CANVAS_EDITS.webcam, commit },
        );
        onWebcamMove?.(pos, commit);
      }}
    />
  );
}
