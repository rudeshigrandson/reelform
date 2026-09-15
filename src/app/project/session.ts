import type { IpcError } from "@contracts";
import { create } from "zustand";
import type { ParsedTelemetry } from "../../editor/persistence";
import type { ProjectMeta } from "../../editor/persistence";
import type { SmoothedCursorTrack } from "../../editor/preview/cursorSmoothing";

/**
 * The open project in this renderer window: where it lives on disk, how its
 * media is served, and the derived data the preview/export/inspector need.
 * Document content (frame, zooms, captions…) lives in `editor/store.ts`;
 * transport lives in `editor/playback`. One store per editor window (SPEC §6.2).
 *
 * Shared contract between the project, preview, export, inspector and recording
 * flows: extend with new fields only, never rename.
 */

export type ProjectSessionStatus = "idle" | "loading" | "ready" | "error";

export interface Size {
  width: number;
  height: number;
}

export interface ProjectSessionData {
  status: ProjectSessionStatus;
  error: IpcError | null;
  /** Absolute path of the `.reelform` folder. */
  projectPath: string | null;
  /** `ProjectV1.id`; also the editor window's `projectId` route param. */
  projectId: string | null;
  /** Non-editor document fields round-tripped on save (sources, capture, createdAt…). */
  meta: ProjectMeta | null;
  /** `media:registerRoot` id for the project folder; null until registered. */
  mediaRootId: string | null;
  /** `reelform-media://…/` prefix for files inside the project folder (trailing slash). */
  mediaBaseUrl: string | null;
  /** Screen recording URL for the preview `<video>` / export demuxer. */
  videoUrl: string | null;
  webcamUrl: string | null;
  micUrl: string | null;
  systemAudioUrl: string | null;
  /** Source video pixel size (from `meta.sources.video`). */
  sourceSize: Size | null;
  /** Parsed `telemetry.json.gz`, or null when the recording has none. */
  telemetry: ParsedTelemetry | null;
  /** Smoothed cursor built from telemetry with the current cursor smoothing. */
  cursorTrack: SmoothedCursorTrack | null;
  /** Source file missing on disk (guide S12 state 13). */
  mediaOffline: boolean;
  /**
   * Low-res preview proxy (`project:ensureProxy`) as a media URL; null until it
   * exists. The preview uses it for Auto / Half quality; export never does (§6.3).
   */
  proxyUrl: string | null;
  /** Cached filmstrip thumbnails (`project:ensureThumbnails`), sorted by source ms. */
  thumbnails: readonly SessionThumbnail[];
  /** Peak |amplitude| 0..1 per bucket over the whole source (timeline waveform). */
  waveformPeaks: Float32Array | null;
}

export interface SessionThumbnail {
  sourceMs: number;
  url: string;
}

export interface ProjectSessionState extends ProjectSessionData {
  setSession(patch: Partial<ProjectSessionData>): void;
  reset(): void;
}

export function initialProjectSession(): ProjectSessionData {
  return {
    status: "idle",
    error: null,
    projectPath: null,
    projectId: null,
    meta: null,
    mediaRootId: null,
    mediaBaseUrl: null,
    videoUrl: null,
    webcamUrl: null,
    micUrl: null,
    systemAudioUrl: null,
    sourceSize: null,
    telemetry: null,
    cursorTrack: null,
    mediaOffline: false,
    proxyUrl: null,
    thumbnails: [],
    waveformPeaks: null,
  };
}

export const useProjectSession = create<ProjectSessionState>((set) => ({
  ...initialProjectSession(),
  setSession: (patch) => set(patch),
  reset: () => set(initialProjectSession()),
}));
