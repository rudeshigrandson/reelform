import { Button, Segmented, Tag } from "@design/components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { Annotation } from "../inspector/annotations/types";
import type { CursorSettings } from "../inspector/cursor/types";
import type { EffectsSettings } from "../inspector/effects/types";
import { outputSize } from "../inspector/frame/frameLogic";
import type { FrameAspect, FrameSettings, Size } from "../inspector/frame/types";
import type { WebcamSettings } from "../inspector/webcam/types";
import type { CameraSettings, ZoomRegion } from "../inspector/zoom/types";
import type { Clip } from "../model/schema";
import type { CursorPositionSource } from "./camera";
import { type ComposeInput, composeScene } from "./compose";
import type { CursorMotion } from "./cursorEffects";
import type { CaptionLayerInput } from "./layers/captionLayer";
import type { TimeRange } from "./layers/webcamLayer";
import { type AnnotationBox, CanvasOverlays, type WebcamPosition } from "./overlays/CanvasOverlays";
import type { NormRect } from "./overlays/cropMath";
import { type CreatePreviewStage, type PreviewStage, createPixiStage } from "./pixiStage";
import {
  CANVAS_ZOOMS,
  type CanvasZoom,
  type PreviewQuality,
  canvasViewSize,
  canvasZoomLabel,
  previewResolution,
} from "./quality";
import type { SceneAssets } from "./sceneGraph";
import type { SpeedLike } from "./timeMapping";
import { upcomingIncomingSourceMs } from "./transitions";
import {
  SCRUB_SETTLE_MS,
  type VideoElementLike,
  applyVideoSync,
  decideVideoSync,
  isScrubbing,
  watchVideoFrames,
} from "./videoSync";
import type { WallpaperRegistry } from "./wallpapers";

/** Preview canvas host — design guide S12 region B, states 3/8/9/10/13; spec §6.3. */

export interface PreviewCanvasProps {
  frame: FrameSettings;
  zoomRegions: readonly ZoomRegion[];
  /** Project `camera` settings (follow smoothing, max speed); defaults when omitted. */
  camera?: CameraSettings | undefined;
  cursor: CursorSettings;
  /** Smoothed cursor track (e.g. `SmoothedCursorTrack`); null → cursor layer disabled. */
  cursorTrack?: CursorPositionSource | null | undefined;
  /** Playback clock, ms. */
  currentMs: number;
  isPlaying: boolean;
  videoUrl: string | null;
  sourceSize: Size;
  mediaOffline?: boolean | undefined;
  onLocateMedia?: (() => void) | undefined;
  /** Hidden <video> muted flag; audio is expected to come from the audio graph. Default true. */
  muted?: boolean | undefined;
  /** Stage factory; tests inject a fake. Defaults to the Pixi stage. */
  createStage?: CreatePreviewStage | undefined;

  /** Trimmed clip sequence; omitted/empty = identity timeline. */
  clips?: readonly Clip[] | null | undefined;
  speedRegions?: readonly SpeedLike[] | undefined;
  /** J/K/L multiplier while playing. */
  shuttleRate?: number | undefined;
  /** Playhead drag in progress (fastSeek); derived from seek cadence when omitted. */
  scrubbing?: boolean | undefined;
  fps?: number | undefined;
  durationMs?: number | undefined;
  quality?: PreviewQuality | undefined;
  annotations?: readonly Annotation[] | undefined;
  captions?: CaptionLayerInput | undefined;
  effects?: EffectsSettings | undefined;
  webcam?: WebcamSettings | undefined;
  webcamUrl?: string | null | undefined;
  webcamRegions?: readonly TimeRange[] | undefined;
  webcamSourceSize?: Size | null | undefined;
  motion?: CursorMotion | null | undefined;
  wallpapers?: WallpaperRegistry | null | undefined;
  /** Stage asset loading (textures, cursor packs); defaults inside the stage. */
  assets?: SceneAssets | undefined;
  mediaBaseUrl?: string | null | undefined;

  selectedZoomId?: string | null | undefined;
  selectedAnnotationId?: string | null | undefined;
  cropMode?: boolean | undefined;
  onCropModeChange?: ((on: boolean) => void) | undefined;
  onCropCommit?: ((crop: NormRect | null) => void) | undefined;
  onZoomFocusChange?:
    | ((id: string, focus: { x: number; y: number }, commit: boolean) => void)
    | undefined;
  onAnnotationBoxChange?: ((id: string, box: AnnotationBox, commit: boolean) => void) | undefined;
  onWebcamMove?: ((pos: WebcamPosition, commit: boolean) => void) | undefined;
  /** Clock for the scrub heuristic (tests). */
  now?: (() => number) | undefined;
}

type StageStatus = "loading" | "ready" | "error";

export function aspectLabel(aspect: FrameAspect): string {
  if (aspect.preset === "source") return "Source";
  if (aspect.preset === "custom") return `${aspect.customWidth}×${aspect.customHeight}`;
  return aspect.preset;
}

const rootStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  background: "var(--bg-sunken)",
  fontFamily: "var(--font-body)",
};

const scrollerStyle = (fit: boolean): CSSProperties => ({
  position: "absolute",
  inset: 0,
  overflow: fit ? "hidden" : "auto",
  display: "flex",
});

const hiddenVideoStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  padding: "var(--space-6)",
  textAlign: "center",
  pointerEvents: "none",
};

const labelStyle: CSSProperties = { fontSize: "13px", color: "var(--text-2)" };
const titleStyle: CSSProperties = { fontSize: "14px", fontWeight: 600, color: "var(--text-1)" };
const detailStyle: CSSProperties = { fontSize: "12px", color: "var(--text-2)", maxWidth: 420 };

const offlineCardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-4) var(--space-6)",
  borderRadius: "var(--radius-lg)",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border)",
  boxShadow: "var(--shadow-md)",
  pointerEvents: "auto",
};

const chipStyle: CSSProperties = {
  position: "absolute",
  top: "var(--space-3)",
  left: "var(--space-3)",
};

const bottomBarStyle: CSSProperties = {
  position: "absolute",
  bottom: "var(--space-3)",
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

const EMPTY_ANNOTATIONS: readonly Annotation[] = [];

export function PreviewCanvas(props: PreviewCanvasProps): ReactElement {
  const {
    frame,
    zoomRegions,
    camera,
    cursor,
    cursorTrack,
    currentMs,
    isPlaying,
    videoUrl,
    sourceSize,
    mediaOffline = false,
    onLocateMedia,
    muted = true,
    createStage = createPixiStage,
    clips,
    speedRegions,
    shuttleRate,
    scrubbing,
    fps,
    durationMs,
    quality = "auto",
    annotations = EMPTY_ANNOTATIONS,
    captions,
    effects,
    webcam,
    webcamUrl = null,
    webcamRegions,
    webcamSourceSize,
    motion,
    wallpapers,
    assets,
    mediaBaseUrl,
    selectedZoomId,
    selectedAnnotationId,
    cropMode = false,
    onCropModeChange,
    onCropCommit,
    onZoomFocusChange,
    onAnnotationBoxChange,
    onWebcamMove,
    now = () => performance.now(),
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamRef = useRef<HTMLVideoElement>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null);
  const [well, setWell] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<CanvasZoom>("fit");
  const [stage, setStage] = useState<PreviewStage | null>(null);
  const [status, setStatus] = useState<StageStatus>("loading");
  const [errorDetail, setErrorDetail] = useState("");
  const [inClip, setInClip] = useState(true);
  const inClipRef = useRef(true);

  const activeUrl = mediaOffline ? null : videoUrl;
  const hasVideo = activeUrl !== null;
  const activeWebcamUrl = mediaOffline ? null : webcamUrl;
  // Cross-dissolve draws the incoming clip's first frame from a second element.
  const wantsNextVideo =
    hasVideo && effects?.transition.kind === "cross-dissolve" && (clips?.length ?? 0) > 1;

  const output = useMemo(() => outputSize(frame.aspect, sourceSize), [frame.aspect, sourceSize]);
  const view = useMemo(() => canvasViewSize(zoom, well, output), [zoom, well, output]);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Measure the well.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setWell((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    measure(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) measure(Math.round(rect.width), Math.round(rect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mount the stage once per factory.
  const mountOpts = useRef({ assets, mediaBaseUrl });
  mountOpts.current = { assets, mediaBaseUrl };
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let mounted: PreviewStage | null = null;
    setStatus("loading");
    createStage(host, {
      width: Math.max(1, viewRef.current.width),
      height: Math.max(1, viewRef.current.height),
      assets: mountOpts.current.assets,
      mediaBaseUrl: mountOpts.current.mediaBaseUrl,
    }).then(
      (s) => {
        if (cancelled) {
          s.destroy();
          return;
        }
        mounted = s;
        setStage(s);
        setStatus("ready");
      },
      (err: unknown) => {
        if (cancelled) return;
        setErrorDetail(err instanceof Error ? err.message : String(err));
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
      mounted?.destroy();
      setStage(null);
    };
  }, [createStage]);

  useEffect(() => {
    if (stage) stage.resize(Math.max(1, view.width), Math.max(1, view.height));
  }, [stage, view]);

  useEffect(() => {
    if (!stage?.setResolution) return;
    const dpr = typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1;
    stage.setResolution(previewResolution(quality, dpr, view, sourceSize));
  }, [stage, quality, view, sourceSize]);

  useEffect(() => {
    if (!stage) return;
    stage.setVideo(hasVideo ? videoRef.current : null);
  }, [stage, hasVideo]);

  useEffect(() => {
    if (!stage?.setWebcam) return;
    stage.setWebcam(activeWebcamUrl !== null ? webcamRef.current : null);
  }, [stage, activeWebcamUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the media URL changes.
  useEffect(() => {
    if (!stage?.setNextVideo) return;
    stage.setNextVideo(wantsNextVideo ? nextVideoRef.current : null);
  }, [stage, wantsNextVideo, activeUrl]);

  // New video frames (after seeks / while playing) → re-upload + redraw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe when the media URL changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!stage?.refreshVideo || !v || !hasVideo) return;
    const refresh = stage.refreshVideo;
    return watchVideoFrames(v as unknown as VideoElementLike, () => refresh());
  }, [stage, hasVideo, activeUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe when the media URL changes.
  useEffect(() => {
    const v = nextVideoRef.current;
    if (!stage?.refreshVideo || !v || !wantsNextVideo) return;
    const refresh = stage.refreshVideo;
    return watchVideoFrames(v as unknown as VideoElementLike, () => refresh());
  }, [stage, wantsNextVideo, activeUrl]);

  // ── video sync ──
  const sync = useRef<{
    prevClip: string | null | undefined;
    lastSeekAt: number | null;
    settle: ReturnType<typeof setTimeout> | null;
  }>({
    prevClip: undefined,
    lastSeekAt: null,
    settle: null,
  });
  const webcamSync = useRef<{ prevClip: string | null | undefined }>({ prevClip: undefined });
  useEffect(
    () => () => {
      if (sync.current.settle) clearTimeout(sync.current.settle);
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync when the source URL changes (new media loads paused at 0).
  useEffect(() => {
    const v = videoRef.current as unknown as VideoElementLike | null;
    if (!v || !hasVideo || !Number.isFinite(currentMs)) return;
    const s = sync.current;
    const t = now();
    // A pending scrub settle must never run once playback starts (it would pause).
    if (isPlaying && s.settle) {
      clearTimeout(s.settle);
      s.settle = null;
    }
    const scrub = scrubbing ?? (!isPlaying && isScrubbing(s.lastSeekAt, t));
    const decision = decideVideoSync({
      timelineMs: currentMs,
      isPlaying,
      scrubbing: scrub,
      clips,
      speeds: speedRegions,
      shuttleRate,
      prevClipId: s.prevClip,
      video: { currentTime: v.currentTime, paused: v.paused },
    });
    s.prevClip = decision.clipId;
    applyVideoSync(v, decision);
    if (inClipRef.current !== decision.visible) {
      inClipRef.current = decision.visible;
      setInClip(decision.visible);
    }
    if (decision.seek && !isPlaying) {
      s.lastSeekAt = t;
      if (s.settle) clearTimeout(s.settle);
      s.settle = null;
      if (decision.seek.mode === "fast") {
        // Land on the exact frame once the scrub pauses.
        const target = currentMs;
        const webcamOffset = webcam?.syncOffsetMs ?? 0;
        s.settle = setTimeout(() => {
          s.settle = null;
          const settle = (el: VideoElementLike | null, offsetMs: number): void => {
            if (!el) return;
            applyVideoSync(
              el,
              decideVideoSync({
                timelineMs: target,
                isPlaying: false,
                scrubbing: false,
                clips,
                speeds: speedRegions,
                offsetMs,
                video: { currentTime: el.currentTime, paused: el.paused },
              }),
            );
          };
          settle(videoRef.current as unknown as VideoElementLike | null, 0);
          settle(webcamRef.current as unknown as VideoElementLike | null, webcamOffset);
        }, SCRUB_SETTLE_MS);
      }
    }

    const w = webcamRef.current as unknown as VideoElementLike | null;
    if (w && activeWebcamUrl !== null) {
      const wd = decideVideoSync({
        timelineMs: currentMs,
        isPlaying,
        scrubbing: scrub,
        clips,
        speeds: speedRegions,
        shuttleRate,
        offsetMs: webcam?.syncOffsetMs ?? 0,
        prevClipId: webcamSync.current.prevClip,
        video: { currentTime: w.currentTime, paused: w.paused },
      });
      webcamSync.current.prevClip = wd.clipId;
      applyVideoSync(w, wd);
    }
  }, [
    currentMs,
    isPlaying,
    hasVideo,
    activeUrl,
    activeWebcamUrl,
    clips,
    speedRegions,
    shuttleRate,
    scrubbing,
    webcam?.syncOffsetMs,
  ]);

  // ── scene ──
  const selectedZoom = useMemo(
    () => (selectedZoomId ? (zoomRegions.find((z) => z.id === selectedZoomId) ?? null) : null),
    [zoomRegions, selectedZoomId],
  );
  // While a zoom is selected (paused) or crop mode is on, show the un-zoomed frame so overlays line up.
  const suppressCamera = cropMode || (selectedZoom !== null && !isPlaying);
  const composeInput = useMemo<ComposeInput>(
    () => ({
      canvas: view,
      frame: cropMode ? { ...frame, crop: null } : frame,
      sourceSize,
      zoomRegions: suppressCamera ? [] : zoomRegions,
      camera,
      cursor,
      cursorTrack,
      hasVideo: hasVideo && inClip,
      wallpapers,
      clips,
      durationMs,
      fps,
      motion,
      effects,
      annotations,
      captions,
      webcam: webcam
        ? {
            settings: webcam,
            hasWebcam: activeWebcamUrl !== null,
            regions: webcamRegions,
            sourceSize: webcamSourceSize,
          }
        : undefined,
    }),
    [
      view,
      frame,
      cropMode,
      sourceSize,
      suppressCamera,
      zoomRegions,
      camera,
      cursor,
      cursorTrack,
      hasVideo,
      inClip,
      wallpapers,
      clips,
      durationMs,
      fps,
      motion,
      effects,
      annotations,
      captions,
      webcam,
      activeWebcamUrl,
      webcamRegions,
      webcamSourceSize,
    ],
  );
  const scene = useMemo(() => composeScene(composeInput, currentMs), [composeInput, currentMs]);

  useEffect(() => {
    if (stage) stage.render(scene);
  }, [stage, scene]);

  // Park the second element on the incoming clip's first frame: during a dissolve, and
  // ahead of the next boundary so the frame is already decoded when the window opens.
  const incomingSourceMs = wantsNextVideo
    ? scene.transition?.kind === "cross-dissolve"
      ? scene.transition.incomingSourceMs
      : upcomingIncomingSourceMs(clips, currentMs)
    : null;
  useEffect(() => {
    const v = nextVideoRef.current;
    if (!v || !wantsNextVideo || incomingSourceMs === null) return;
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime * 1000 - incomingSourceMs) > 1) {
      v.currentTime = incomingSourceMs / 1000;
    }
  }, [wantsNextVideo, incomingSourceMs]);

  const state: string =
    status !== "ready" ? status : mediaOffline ? "offline" : hasVideo ? "ready" : "empty";
  // Overlays need a measured, non-empty frame to map pointer deltas.
  const interactive =
    status === "ready" &&
    !mediaOffline &&
    !isPlaying &&
    scene.layout.frame.width > 0 &&
    scene.layout.frame.height > 0;

  const selectedAnnotation = useMemo(() => {
    if (!selectedAnnotationId) return null;
    const a = annotations.find((x) => x.id === selectedAnnotationId);
    return a && currentMs >= a.startMs && currentMs <= a.endMs ? a : null;
  }, [annotations, selectedAnnotationId, currentMs]);
  const webcamState = scene.composition?.webcam;

  return (
    <div
      ref={rootRef}
      style={rootStyle}
      data-testid="preview-canvas"
      data-state={state}
      data-zoom={zoom}
    >
      <div style={scrollerStyle(zoom === "fit")}>
        <div
          style={{
            position: "relative",
            flex: "none",
            margin: "auto",
            width: view.width || "100%",
            height: view.height || "100%",
          }}
          data-testid="preview-view"
        >
          <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
          {interactive && (
            <CanvasOverlays
              layout={scene.layout}
              camera={scene.camera}
              zoomRegion={selectedZoom}
              onZoomFocusChange={
                selectedZoom && onZoomFocusChange
                  ? (f, commit) => onZoomFocusChange(selectedZoom.id, f, commit)
                  : undefined
              }
              annotation={selectedAnnotation}
              onAnnotationBoxChange={
                selectedAnnotation && onAnnotationBoxChange
                  ? (b, commit) => onAnnotationBoxChange(selectedAnnotation.id, b, commit)
                  : undefined
              }
              webcam={
                webcam && webcamState?.visible ? { settings: webcam, rect: webcamState.rect } : null
              }
              onWebcamMove={onWebcamMove}
              crop={
                cropMode
                  ? {
                      value: frame.crop,
                      onDone: (c) => {
                        onCropCommit?.(c);
                        onCropModeChange?.(false);
                      },
                      onCancel: onCropModeChange ? () => onCropModeChange(false) : undefined,
                    }
                  : null
              }
            />
          )}
        </div>
      </div>

      <video
        ref={videoRef}
        style={hiddenVideoStyle}
        src={activeUrl ?? undefined}
        muted={muted}
        playsInline
        preload="auto"
        tabIndex={-1}
        data-testid="preview-video"
      />
      {wantsNextVideo && (
        <video
          ref={nextVideoRef}
          style={hiddenVideoStyle}
          src={activeUrl ?? undefined}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          data-testid="preview-next-video"
        />
      )}
      {activeWebcamUrl !== null && (
        <video
          ref={webcamRef}
          style={hiddenVideoStyle}
          src={activeWebcamUrl}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          data-testid="preview-webcam-video"
        />
      )}

      {status === "loading" && (
        <div style={overlayStyle}>
          <span style={labelStyle}>Starting preview…</span>
        </div>
      )}

      {status === "error" && (
        <div style={overlayStyle} role="alert">
          <span style={titleStyle}>Preview unavailable — GPU renderer failed to start</span>
          {errorDetail && <span style={detailStyle}>{errorDetail}</span>}
        </div>
      )}

      {status === "ready" && mediaOffline && (
        <div style={overlayStyle}>
          <div style={offlineCardStyle} role="alert">
            <span style={titleStyle}>Media offline</span>
            <span style={detailStyle}>The source recording was moved or deleted.</span>
            <Button variant="primary" onClick={onLocateMedia} disabled={!onLocateMedia}>
              Locate…
            </Button>
          </div>
        </div>
      )}

      {status === "ready" && !mediaOffline && !hasVideo && (
        <div style={overlayStyle}>
          <span style={labelStyle}>No media</span>
        </div>
      )}

      {status !== "error" && (
        <div style={chipStyle}>
          <Tag variant="neutral" data-testid="aspect-chip">
            {aspectLabel(frame.aspect)}
          </Tag>
        </div>
      )}

      {status === "ready" && !cropMode && (
        <div style={bottomBarStyle} data-testid="canvas-zoom">
          <Segmented<CanvasZoom>
            name="preview-canvas-zoom"
            size="sm"
            value={zoom}
            options={CANVAS_ZOOMS.map((z) => ({ value: z, label: canvasZoomLabel(z) }))}
            onChange={setZoom}
          />
          {onCropModeChange && hasVideo && !mediaOffline && (
            <Button variant="ghost" onClick={() => onCropModeChange(true)} disabled={isPlaying}>
              Crop
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
