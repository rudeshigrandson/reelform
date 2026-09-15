import type { ProjectV1 } from "../../editor/model/v1";
import type { MediaSourceV1 } from "../../editor/model/v1";
import { toProjectDocument } from "../../editor/persistence";
import { initialEditorData } from "../../editor/store";
import type { PickerSource, RecordOptions, SourceItem, SourceMode } from "../../launcher/types";
import type { CaptureOptions } from "../../recording/captureSession";
import { type Platform, sourcePixelSize } from "../../recording/constraints";
import type { TrackKind } from "../../recording/port";
import type { RegionRect } from "./bus";
import type {
  CreateProjectRequest,
  FinalizeResult,
  SourcesResult,
  StartRecordingRequest,
} from "./port";

/**
 * Pure mapping for the recording flow: launcher choices → `recording:start`,
 * listed sources → launcher cards / capture constraints / labels, and a
 * finalized recording → the `project:create` request (SPEC §4, §5.6).
 */

/** Launcher options plus the region picked on the overlay (display-local DIP). */
export interface RecordingSetup extends RecordOptions {
  region?: RegionRect | undefined;
}

type Display = SourcesResult["displays"][number];
type Window = SourcesResult["windows"][number];

export function toStartRequest(setup: RecordingSetup): StartRecordingRequest {
  const isWindow = setup.mode === "window";
  const req: StartRecordingRequest = {
    source: isWindow
      ? { kind: "window", id: setup.sourceId }
      : { kind: "display", id: setup.sourceId },
    audio: { system: setup.systemAudio },
    fps: setup.fps,
    countdown: setup.countdown,
    hideCursor: setup.hideCursor,
  };
  // An empty id means "system default" for getUserMedia; main only needs presence.
  if (setup.mic) req.audio.mic = setup.micDeviceId ?? "default";
  if (setup.webcam) req.webcam = setup.webcamDeviceId ?? "default";
  if (setup.mode === "region" && setup.region) req.region = { ...setup.region };
  return req;
}

/** Launcher cards for a mode: displays for screen/region, windows for window. */
export function toSourceItems(sources: SourcesResult | null, mode: SourceMode): SourceItem[] {
  if (!sources) return [];
  if (mode === "window") {
    return sources.windows.map((w) => {
      const px = w.bounds
        ? sourcePixelSize(w.bounds, displayFor(sources, w)?.scaleFactor)
        : { width: 0, height: 0 };
      return withThumb(
        {
          id: w.id,
          kind: "window",
          name: w.appName ? `${w.appName} — ${w.title}` : w.title,
          width: px.width,
          height: px.height,
        },
        w.thumbnail,
      );
    });
  }
  return sources.displays.map((d) => {
    const px = sourcePixelSize(d.bounds, d.scaleFactor);
    return withThumb(
      { id: d.id, kind: "display", name: d.name, width: px.width, height: px.height },
      d.thumbnail,
    );
  });
}

/** An empty data URL: Electron's thumbnail for a minimized window. */
const EMPTY_THUMBNAIL = /^data:image\/[a-z]+;base64,?$/;

/** S06 picker entries: displays then windows, with app grouping and minimized state. */
export function toPickerSources(sources: SourcesResult | null): PickerSource[] {
  if (!sources) return [];
  const displays = toSourceItems(sources, "screen").map(
    (d): PickerSource => ({ ...d, title: d.name, minimized: false }),
  );
  const windows = toSourceItems(sources, "window").map((item, i): PickerSource => {
    const w = sources.windows[i];
    const thumb = w?.thumbnail;
    const minimized = thumb !== undefined && EMPTY_THUMBNAIL.test(thumb);
    const { thumbnailUrl, ...rest } = item;
    const base: PickerSource = { ...rest, title: w?.title ?? item.name, minimized };
    // Minimized windows have no live thumbnail (Electron reports an empty image).
    if (thumbnailUrl && !minimized) base.thumbnailUrl = thumbnailUrl;
    if (w?.appName) base.appName = w.appName;
    if (w?.appIcon) base.appIcon = w.appIcon;
    return base;
  });
  return [...displays, ...windows];
}

/** The Electron backend is the fallback everywhere but Linux (guide S04/S05 notice). */
export function usesFallbackCapture(platform: Platform, backend: string | null): boolean {
  return backend === "electron" && platform !== "linux";
}

/** System audio can't be captured by the Electron backend on macOS. */
export function systemAudioSupported(platform: Platform, backend: string | null): boolean {
  return !(platform === "darwin" && backend === "electron");
}

export const FALLBACK_CAPTURE_COPY =
  "Native capture unavailable — using fallback, cursor may be visible.";
export const SYSTEM_AUDIO_UNSUPPORTED_COPY = "Unavailable with fallback capture on macOS";

function withThumb(item: SourceItem, thumbnail: string | undefined): SourceItem {
  return thumbnail ? { ...item, thumbnailUrl: thumbnail } : item;
}

function displayFor(sources: SourcesResult, w: Window): Display | undefined {
  return sources.displays.find((d) => d.id === w.displayId) ?? sources.displays[0];
}

/** Display the recording happens on (HUD / countdown placement). */
export function displayIdFor(
  setup: RecordingSetup,
  sources: SourcesResult | null,
): string | undefined {
  if (setup.mode !== "window") return setup.sourceId;
  const w = sources?.windows.find((x) => x.id === setup.sourceId);
  return w?.displayId;
}

export function sourceLabel(setup: RecordingSetup, sources: SourcesResult | null): string {
  if (setup.mode === "region" && setup.region) {
    return `${Math.round(setup.region.width)}×${Math.round(setup.region.height)} region`;
  }
  if (setup.mode === "window") {
    const w = sources?.windows.find((x) => x.id === setup.sourceId);
    return w ? (w.appName ? `${w.appName} — ${w.title}` : w.title) : "Window";
  }
  return sources?.displays.find((d) => d.id === setup.sourceId)?.name ?? "Display";
}

export type CaptureOptionsResult =
  | { ok: true; options: CaptureOptions }
  | { ok: false; code: "SOURCE_NOT_CAPTURABLE"; message: string };

/**
 * Renderer capture options for the Electron backend (§5.2). Region capture
 * records the whole display (cropped in post), so the region never changes
 * the constraints.
 */
export function captureOptionsFor(
  sessionId: string,
  setup: RecordingSetup,
  sources: SourcesResult | null,
  platform: Platform,
): CaptureOptionsResult {
  let desktop: CaptureOptions["desktop"];
  if (setup.mode === "window") {
    const w = sources?.windows.find((x) => x.id === setup.sourceId);
    const d = w && sources ? displayFor(sources, w) : undefined;
    // desktopCapturer window ids are already chromeMediaSourceIds.
    desktop = { sourceId: setup.sourceId, size: w?.bounds, scaleFactor: d?.scaleFactor };
  } else {
    const d = sources?.displays.find((x) => x.id === setup.sourceId);
    if (!d?.mediaSourceId) {
      return {
        ok: false,
        code: "SOURCE_NOT_CAPTURABLE",
        message: "This display can't be captured right now. Pick it again and retry.",
      };
    }
    desktop = { sourceId: d.mediaSourceId, size: d.bounds, scaleFactor: d.scaleFactor };
  }
  const options: CaptureOptions = {
    sessionId,
    platform,
    desktop,
    fps: setup.fps,
    systemAudio: setup.systemAudio,
  };
  if (setup.mic) options.mic = { deviceId: setup.micDeviceId };
  if (setup.webcam) options.webcam = { deviceId: setup.webcamDeviceId };
  return { ok: true, options };
}

// ---- finalized recording → project -------------------------------------------

export const TELEMETRY_FILE_NAME = "telemetry.json.gz";
const AUDIO_TRACKS = ["mic", "system"] as const;

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

export interface MediaPlan {
  imports: NonNullable<CreateProjectRequest["media"]>;
  /** Requested `media/` file name per track (and telemetry). */
  fileNames: Partial<Record<TrackKind | "telemetry", string>>;
}

/** Move every finalized file into the new project's `media/` folder. */
export function planMedia(fin: FinalizeResult): MediaPlan {
  const imports: MediaPlan["imports"] = [];
  const fileNames: MediaPlan["fileNames"] = {};
  const add = (key: TrackKind | "telemetry", sourcePath: string, fileName: string) => {
    imports.push({ sourcePath, fileName, move: true });
    fileNames[key] = fileName;
  };
  add("screen", fin.video.path, `screen${extOf(fin.video.path) || ".webm"}`);
  for (const t of AUDIO_TRACKS) {
    const ref = fin[t];
    if (ref) add(t, ref.path, `${t}${extOf(ref.path) || ".webm"}`);
  }
  if (fin.webcam) add("webcam", fin.webcam.path, `webcam${extOf(fin.webcam.path) || ".webm"}`);
  add("telemetry", fin.telemetry.path, TELEMETRY_FILE_NAME);
  return { imports, fileNames };
}

/** Map `project:create`'s actual (possibly uniquified) names back onto the plan. */
export function resolvedFileNames(
  plan: MediaPlan,
  mediaFiles: readonly string[],
): MediaPlan["fileNames"] {
  const out: MediaPlan["fileNames"] = { ...plan.fileNames };
  const keys = Object.keys(plan.fileNames) as (TrackKind | "telemetry")[];
  for (const key of keys) {
    const idx = plan.imports.findIndex((m) => m.fileName === plan.fileNames[key]);
    const actual = idx >= 0 ? mediaFiles[idx] : undefined;
    if (actual) out[key] = actual;
  }
  return out;
}

export function codecFromMime(mime: string | undefined, fallback: string): string {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("avc1") || m.includes("h264")) return "h264";
  if (m.includes("vp09") || m.includes("vp9")) return "vp9";
  if (m.includes("vp8")) return "vp8";
  if (m.includes("opus")) return "opus";
  if (m.includes("aac") || m.includes("mp4a")) return "aac";
  return fallback;
}

/** Recorded pixel size: region × scale, else the source bounds × scale (even, ≥2). */
export function recordedPixelSize(
  fin: FinalizeResult,
  sources: SourcesResult | null,
): { width: number; height: number } {
  const meta = fin.meta;
  // Native helpers crop the region at capture; the Electron backend records the
  // whole display and crops in post (§5.2), so its video is display-sized.
  if (
    meta.backend !== "electron" &&
    meta.region &&
    meta.region.width > 0 &&
    meta.region.height > 0
  ) {
    return sourcePixelSize(meta.region, meta.scaleFactor);
  }
  if (meta.source.kind === "display") {
    const id = meta.source.id;
    const d = sources?.displays.find((x) => x.id === id);
    if (d) return sourcePixelSize(d.bounds, d.scaleFactor);
  } else {
    const id = meta.source.id;
    const w = sources?.windows.find((x) => x.id === id);
    if (w?.bounds) return sourcePixelSize(w.bounds, meta.scaleFactor);
  }
  return { width: 1920, height: 1080 };
}

/** "Recording 2026-09-15 at 14.32.05" from an ISO timestamp (local wall clock not needed). */
export function recordingProjectName(nowIso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(nowIso);
  return m ? `Recording ${m[1]} at ${m[2]}.${m[3]}.${m[4]}` : "Recording";
}

export interface BuildDocumentInput {
  fin: FinalizeResult;
  sources: SourcesResult | null;
  /** MediaRecorder mime per track, from the renderer capture stop result. */
  mimeTypes?: Partial<Record<TrackKind, string>> | undefined;
  fileNames: MediaPlan["fileNames"];
  id: string;
  name: string;
  nowIso: string;
  appVersion: string;
}

const WEBCAM_SIZE = { width: 1280, height: 720 };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Electron backend region capture records the whole display; the region becomes
 * the initial `frame.crop`, normalized to the display (§5.2). `null` otherwise.
 */
export function initialRegionCrop(
  fin: FinalizeResult,
  sources: SourcesResult | null,
): { x: number; y: number; width: number; height: number } | null {
  const { backend, region, source } = fin.meta;
  if (backend !== "electron" || !region || source.kind !== "display") return null;
  const d = sources?.displays.find((x) => x.id === source.id);
  if (!d || !(d.bounds.width > 0) || !(d.bounds.height > 0)) return null;
  const x = clamp01(region.x / d.bounds.width);
  const y = clamp01(region.y / d.bounds.height);
  const width = Math.min(1 - x, clamp01(region.width / d.bounds.width));
  const height = Math.min(1 - y, clamp01(region.height / d.bounds.height));
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function buildRecordingDocument(input: BuildDocumentInput): ProjectV1 {
  const { fin, fileNames } = input;
  const meta = fin.meta;
  // A zero-length recording still needs a non-empty clip to validate.
  const durationMs = Math.max(1, Math.round(meta.durationMs));
  const fps = meta.recordedFps > 0 ? meta.recordedFps : 30;
  const rel = (name: string | undefined, fallback: string) => `media/${name ?? fallback}`;
  const px = recordedPixelSize(fin, input.sources);

  const video: MediaSourceV1 = {
    path: rel(fileNames.screen, "screen.webm"),
    durationMs,
    width: px.width,
    height: px.height,
    fps,
    codec: codecFromMime(input.mimeTypes?.screen, meta.backend === "electron" ? "vp9" : "h264"),
    hasAudio: false,
  };
  const audio = (track: "mic" | "system"): MediaSourceV1 => ({
    path: rel(fileNames[track], `${track}.webm`),
    durationMs,
    width: 1,
    height: 1,
    fps: 1,
    codec: codecFromMime(input.mimeTypes?.[track], meta.backend === "electron" ? "opus" : "aac"),
    hasAudio: true,
  });

  const sources: Parameters<typeof toProjectDocument>[1]["sources"] = {
    video,
    telemetry: {
      path: rel(fileNames.telemetry, TELEMETRY_FILE_NAME),
      hasClicks: fin.telemetry.hasClicks,
      hasKeys: fin.telemetry.hasKeys,
      sampleHz: fin.telemetry.sampleHz,
    },
    capture: {
      backend: meta.backend,
      os: meta.os,
      scaleFactor: meta.scaleFactor,
      recordedFps: fps,
      ...(meta.source.kind === "display"
        ? { display: meta.source.id }
        : { window: meta.source.id }),
      ...(meta.region && meta.region.width > 0 && meta.region.height > 0
        ? { region: { ...meta.region } }
        : {}),
    },
  };
  if (fin.mic) sources.mic = audio("mic");
  if (fin.system) sources.system = audio("system");
  if (fin.webcam) {
    sources.webcam = {
      path: rel(fileNames.webcam, "webcam.webm"),
      durationMs,
      ...WEBCAM_SIZE,
      fps: 30,
      codec: codecFromMime(input.mimeTypes?.webcam, "vp9"),
      hasAudio: false,
    };
  }

  const data = initialEditorData();
  data.durationMs = durationMs;
  data.cursorPointCount = fin.telemetry.pointCount;
  data.frame.crop = initialRegionCrop(fin, input.sources);

  return toProjectDocument(data, {
    id: input.id,
    name: input.name,
    createdAt: input.nowIso,
    modifiedAt: input.nowIso,
    appVersion: input.appVersion,
    sources,
  });
}
