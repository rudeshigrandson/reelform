import { Button, Tag } from "@design/components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { CursorSettings } from "../inspector/cursor/types";
import type { FrameAspect, FrameSettings, Size } from "../inspector/frame/types";
import type { ZoomRegion } from "../inspector/zoom/types";
import type { CursorPositionSource } from "./camera";
import { type CreatePreviewStage, type PreviewStage, createPixiStage } from "./pixiStage";
import { evaluateScene } from "./scene";

/** Preview canvas host — design guide S12 region B, state 13 (Media offline); spec §6.3. */

export interface PreviewCanvasProps {
  frame: FrameSettings;
  zoomRegions: readonly ZoomRegion[];
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
}

type StageStatus = "loading" | "ready" | "error";

/** One frame at 60fps, in seconds. */
const FRAME_S = 1 / 60;
/** While playing, the video leads; resync only on gross drift (e.g. a seek). */
const PLAYING_RESYNC_S = 0.25;

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

const hostStyle: CSSProperties = { position: "absolute", inset: 0 };

const videoStyle: CSSProperties = {
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

const titleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--text-1)",
};

const detailStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--text-2)",
  maxWidth: 420,
};

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

export function PreviewCanvas({
  frame,
  zoomRegions,
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
}: PreviewCanvasProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [stage, setStage] = useState<PreviewStage | null>(null);
  const [status, setStatus] = useState<StageStatus>("loading");
  const [errorDetail, setErrorDetail] = useState("");

  const activeUrl = mediaOffline ? null : videoUrl;
  const hasVideo = activeUrl !== null;

  // Measure the well.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (w: number, h: number) =>
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
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
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let mounted: PreviewStage | null = null;
    setStatus("loading");
    createStage(host, {
      width: Math.max(1, sizeRef.current.width),
      height: Math.max(1, sizeRef.current.height),
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
    if (stage) stage.resize(Math.max(1, size.width), Math.max(1, size.height));
  }, [stage, size]);

  useEffect(() => {
    if (!stage) return;
    stage.setVideo(hasVideo ? videoRef.current : null);
  }, [stage, hasVideo]);

  const sceneInput = useMemo(
    () => ({ canvas: size, frame, sourceSize, zoomRegions, cursor, cursorTrack, hasVideo }),
    [size, frame, sourceSize, zoomRegions, cursor, cursorTrack, hasVideo],
  );

  useEffect(() => {
    if (stage) stage.render(evaluateScene(sceneInput, currentMs));
  }, [stage, sceneInput, currentMs]);

  // Keep the hidden <video> on the playback clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the source URL changes (new media loads paused).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasVideo) return;
    if (isPlaying) {
      if (v.paused) {
        const p = v.play() as Promise<void> | undefined;
        p?.catch(() => {});
      }
    } else if (!v.paused) {
      v.pause();
    }
  }, [isPlaying, hasVideo, activeUrl]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seek when the source URL changes (new media starts at 0).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasVideo || !Number.isFinite(currentMs)) return;
    const target = Math.max(0, currentMs / 1000);
    const drift = Math.abs(v.currentTime - target);
    if (drift > (isPlaying ? PLAYING_RESYNC_S : FRAME_S)) v.currentTime = target;
  }, [currentMs, isPlaying, hasVideo, activeUrl]);

  const state: string =
    status !== "ready" ? status : mediaOffline ? "offline" : hasVideo ? "ready" : "empty";

  return (
    <div ref={rootRef} style={rootStyle} data-testid="preview-canvas" data-state={state}>
      <div ref={hostRef} style={hostStyle} />
      <video
        ref={videoRef}
        style={videoStyle}
        src={activeUrl ?? undefined}
        muted={muted}
        playsInline
        preload="auto"
        tabIndex={-1}
        data-testid="preview-video"
      />

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
    </div>
  );
}
