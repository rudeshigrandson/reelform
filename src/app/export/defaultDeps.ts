import type { Clip } from "../../editor/model/schema";
import { buildCursorMotion } from "../../editor/preview/cursorEffects";
import { type FetchJson, fetchJsonViaFetch } from "../../editor/preview/cursorPack";
import { type WallpaperRegistry, loadWallpaperRegistry } from "../../editor/preview/wallpapers";
import type { EditorData } from "../../editor/store";
import { createPixiFrameRenderer } from "../../export/engine/pixiFrameRenderer";
import type { ProjectSessionData } from "../project/session";
import {
  browserAudioDecoder,
  browserOfflineContext,
  createExportAudioRenderer,
} from "./audioSources";
import { type ExportIpc, IpcExportSink, ipcExportTransport, writeFileViaSink } from "./exportSink";
import { createGifRoute, readPixelsOffscreen } from "./gifRoute";
import { createGifWorker } from "./gifWorker";
import type { ExportFlowPhase, ExportRunnerDeps } from "./runner";
import type { SystemPort } from "./systemPort";
import {
  type TimelineSnapshot,
  type WebcamTrack,
  createVideoRoute,
  openUrlFrameSource,
} from "./videoRoute";

/**
 * Real export deps from a snapshot of the editor document + project session,
 * taken when Export is pressed (later edits don't leak into a running export).
 */

export interface ExportStoreSnapshot {
  editor: EditorData;
  session: ProjectSessionData;
}

export interface ExportBaseDeps {
  system: SystemPort;
  onChange(phase: ExportFlowPhase): void;
  now(): number;
}

export function clipsFor(snapshot: ExportStoreSnapshot): Clip[] {
  const { meta } = snapshot.session;
  if (meta?.clips && meta.clips.length > 0) return meta.clips;
  const sourceEndMs = meta?.sources.video.durationMs ?? snapshot.editor.durationMs;
  return sourceEndMs > 0
    ? [{ id: "clip-1", sourceStartMs: 0, sourceEndMs, timelineStartMs: 0 }]
    : [];
}

/**
 * Webcam track to composite, or null when there is none, it is disabled, or the
 * media is offline (the preview hides the bubble in those cases too).
 */
export function webcamTrackFor(snapshot: ExportStoreSnapshot): WebcamTrack | null {
  const { editor, session } = snapshot;
  if (session.webcamUrl === null || session.mediaOffline || !editor.webcam.enabled) return null;
  return { url: session.webcamUrl, syncOffsetMs: editor.webcam.syncOffsetMs };
}

export interface TimelineSnapshotOptions {
  /** Wallpaper manifest loader (tests); defaults to fetch. */
  fetchJson?: FetchJson | undefined;
}

/**
 * Export timeline + the same composition input the preview builds
 * (EditorPreview/PreviewCanvas), so annotations, captions, title cards, cursor
 * effects and color grading reach the exported frames.
 */
export function timelineFromSnapshot(
  snapshot: ExportStoreSnapshot,
  options: TimelineSnapshotOptions = {},
): TimelineSnapshot {
  const { editor, session } = snapshot;
  const clips = clipsFor(snapshot);
  const motion = session.telemetry
    ? buildCursorMotion({
        points: session.telemetry.cursorPoints,
        clicks: session.telemetry.telemetry.clicks,
      })
    : null;
  let wallpapers: WallpaperRegistry | null = null;
  let loading: Promise<void> | null = null;
  const webcam = webcamTrackFor(snapshot);
  const webcamSource = session.meta?.sources.webcam;
  const webcamSourceSize = webcamSource
    ? { width: webcamSource.width, height: webcamSource.height }
    : null;
  return {
    clips,
    speeds: editor.speedRegions,
    sourceFps: session.meta?.sources.video.fps,
    webcam,
    prepare: () => {
      loading ??= loadWallpaperRegistry(options.fetchJson ?? fetchJsonViaFetch).then((reg) => {
        wallpapers = reg.size > 0 ? reg : null;
      });
      return loading;
    },
    sceneInput: (size, scene) => ({
      canvas: size,
      frame: editor.frame,
      sourceSize: session.sourceSize,
      zoomRegions: editor.zoomRegions,
      cursor: editor.cursor,
      cursorTrack: session.cursorTrack,
      hasVideo: session.videoUrl !== null,
      wallpapers,
      clips,
      durationMs: editor.durationMs,
      fps: scene.fps,
      motion,
      effects: editor.effects,
      annotations: editor.annotations,
      captions: {
        captions: editor.captions,
        style: editor.captionStyle,
        enabled: scene.burnInCaptions,
      },
      // The route decodes `webcam` and feeds PixiFrameRenderer.setWebcamFrame;
      // an unreadable webcam file hides the bubble at render time.
      webcam: {
        settings: editor.webcam,
        hasWebcam: webcam !== null,
        regions: session.meta?.webcamRegions,
        sourceSize: webcamSourceSize,
      },
    }),
  };
}

export function createDefaultExportDeps(
  snapshot: ExportStoreSnapshot,
  base: ExportBaseDeps,
  ipc: ExportIpc = ipcExportTransport(),
): ExportRunnerDeps {
  const { editor, session } = snapshot;
  const timeline = timelineFromSnapshot(snapshot);
  const videoUrl = session.videoUrl ?? "";
  const mediaBaseUrl = session.mediaBaseUrl;
  return {
    runVideo: createVideoRoute({
      timeline,
      videoUrl,
      mediaBaseUrl,
      now: base.now,
      renderAudio: createExportAudioRenderer({
        urls: { micUrl: session.micUrl, systemAudioUrl: session.systemAudioUrl },
        settings: editor.audio,
        clips: timeline.clips,
        speeds: editor.speedRegions,
        decoder: browserAudioDecoder(),
        createContext: browserOfflineContext,
      }),
    }),
    runGif: createGifRoute({
      timeline,
      createWorker: createGifWorker,
      openFrameSource: (options) => openUrlFrameSource(videoUrl, options),
      openWebcamSource: (track, options) => openUrlFrameSource(track.url, options),
      createRenderer: (size) => createPixiFrameRenderer({ ...size, mediaBaseUrl }),
      readPixels: readPixelsOffscreen,
      now: base.now,
    }),
    createSink: (target) => new IpcExportSink({ ipc, ...target }),
    writeFile: (target, container, bytes) => writeFileViaSink({ ipc, ...target }, container, bytes),
    system: base.system,
    onChange: base.onChange,
    now: base.now,
    environment: () => ({
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      webCodecs: typeof VideoEncoder !== "undefined",
      projectId: session.projectId,
      source: session.meta?.sources.video ?? null,
    }),
  };
}
