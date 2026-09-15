import type { Annotation } from "../inspector/annotations/types";
import {
  type AudioRegion,
  type AudioSettings,
  SILENT_DB,
  type TrackSettings,
} from "../inspector/audio/types";
import type { Caption } from "../inspector/captions/types";
import type { SpeedRegionEdit } from "../inspector/effects/types";
import type { ZoomRegion } from "../inspector/zoom/types";
import type { Clip } from "../model/schema";
import {
  type AudioRegionDoc,
  type AudioSettingsDoc,
  type CaptionDoc,
  type CaptureInfo,
  type ExportConfigDoc,
  type MediaSourceV1,
  type MigrationResult,
  ProjectLoadError,
  type ProjectV1,
  type RangeDoc,
  SCHEMA_VERSION,
  type SpeedRegionDoc,
  type TelemetryRef,
  type TransitionDoc,
  type UiState,
  type ZoomRegionDoc,
  migrate,
} from "../model/v1";
import type { EditorData } from "../store";

/**
 * Pure mapping between the in-memory editor store (`EditorData`) and the v1
 * `project.json` document (ENGINEERING_SPEC §4).
 *
 * `fromProjectDocument(toProjectDocument(data, meta))` equals `data` for every
 * document field; `captionStatus` is transient (generation progress) and always
 * comes back idle. Everything the store does not hold (sources, clips,
 * transitions, export presets, …) travels in `ProjectMeta`, which
 * `metaFromProjectDocument` recovers so doc → (data, meta) → doc is lossless too.
 */

/** Telemetry reference without the point count (the store owns that). */
export type TelemetryRefBase = Omit<TelemetryRef, "pointCount">;

export const DEFAULT_TELEMETRY_PATH = "media/telemetry.json.gz";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  appVersion: string;
  sources: {
    video: MediaSourceV1;
    mic?: MediaSourceV1 | undefined;
    system?: MediaSourceV1 | undefined;
    webcam?: MediaSourceV1 | undefined;
    /** Used when the store has a cursor point count; defaults to `DEFAULT_TELEMETRY_PATH`. */
    telemetry?: TelemetryRefBase | undefined;
    capture?: CaptureInfo | undefined;
  };
  /**
   * Fallback only: the store's `clips` win when non-empty. Defaults to one clip
   * spanning the whole video source.
   */
  clips?: Clip[] | undefined;
  transitions?: TransitionDoc[] | undefined;
  webcamRegions?: RangeDoc[] | undefined;
  exportPresets?: ExportConfigDoc[] | undefined;
  lastExport?: ExportConfigDoc | undefined;
  /** Non-semantic UI layout; selection + active tool come from the store. */
  ui?: Partial<Omit<UiState, "activeTool" | "selection">> | undefined;
  /** `offsetMs` per audio region id (not edited in the store yet). */
  audioRegionOffsets?: Readonly<Record<string, number>> | undefined;
}

// ── Editor-key classification (used by dirty tracking) ──────────────────────

/** Store fields that never reach the document. */
export const TRANSIENT_EDITOR_KEYS = ["captionStatus"] as const;
/** Store fields persisted under the non-semantic `ui` block (not dirtying). */
export const UI_EDITOR_KEYS = [
  "activeTool",
  "selectedZoomId",
  "selectedAnnotationId",
  "selectedSpeedId",
] as const;
/** Store fields that are document content: changing one makes the project dirty. */
export const DOCUMENT_EDITOR_KEYS = [
  "durationMs",
  "clips",
  "frame",
  "cursor",
  "cursorPointCount",
  "zoom",
  "zoomRegions",
  "webcam",
  "audio",
  "captions",
  "captionStyle",
  "captionModel",
  "captionLanguage",
  "burnInCaptions",
  "annotations",
  "effects",
  "speedRegions",
  "saveRawWithProject",
] as const;

type Classified =
  | (typeof TRANSIENT_EDITOR_KEYS)[number]
  | (typeof UI_EDITOR_KEYS)[number]
  | (typeof DOCUMENT_EDITOR_KEYS)[number];
/** Compile error here means a new `EditorData` field has not been classified. */
export type _EditorKeysExhaustive = [Exclude<keyof EditorData, Classified>] extends [never]
  ? true
  : never;
const _exhaustive: _EditorKeysExhaustive = true;
void _exhaustive;

/** True when any document field changed identity between two store states. */
export function isDocumentChange(prev: EditorData, next: EditorData): boolean {
  return DOCUMENT_EDITOR_KEYS.some((k) => !Object.is(prev[k], next[k]));
}

// ── Encoding helpers ────────────────────────────────────────────────────────

/** `-Infinity` (silence) is not JSON-safe: store it as `null`. */
export function encodeDb(db: number): number | null {
  return Number.isFinite(db) ? db : null;
}

export function decodeDb(db: number | null): number {
  return db === null ? SILENT_DB : db;
}

function encodeTrack<T extends Pick<TrackSettings, "volumeDb">>(
  t: T,
): Omit<T, "volumeDb"> & { volumeDb: number | null } {
  return { ...t, volumeDb: encodeDb(t.volumeDb) };
}

function decodeTrack<T extends { volumeDb: number | null }>(
  t: T,
): Omit<T, "volumeDb"> & { volumeDb: number } {
  return { ...t, volumeDb: decodeDb(t.volumeDb) };
}

function zoomToDoc(z: ZoomRegion): ZoomRegionDoc {
  const out: ZoomRegionDoc = {
    id: z.id,
    startMs: z.startMs,
    endMs: z.endMs,
    level: z.level,
    focus: { mode: z.focus.mode, x: z.focus.x, y: z.focus.y },
    easeInMs: z.easeInMs,
    easeOutMs: z.easeOutMs,
    curve: z.curve,
    source: z.source,
  };
  if (z.reason !== undefined) out.reason = z.reason;
  return out;
}

function zoomFromDoc(z: ZoomRegionDoc): ZoomRegion {
  const out: ZoomRegion = {
    id: z.id,
    startMs: z.startMs,
    endMs: z.endMs,
    level: z.level,
    focus: { mode: z.focus.mode, x: z.focus.x, y: z.focus.y },
    easeInMs: z.easeInMs,
    easeOutMs: z.easeOutMs,
    curve: z.curve,
    source: z.source,
  };
  return z.reason === undefined ? out : { ...out, reason: z.reason };
}

function speedToDoc(s: SpeedRegionEdit): SpeedRegionDoc {
  return {
    id: s.id,
    startMs: s.startMs,
    endMs: s.endMs,
    rate: s.rate,
    keepPitch: s.keepPitch,
    rampInMs: s.rampInMs,
    rampOutMs: s.rampOutMs,
  };
}

function speedFromDoc(s: SpeedRegionDoc): SpeedRegionEdit {
  return { ...speedToDoc(s) };
}

function captionToDoc(c: Caption): CaptionDoc {
  return {
    id: c.id,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
    words: c.words.map((w) => ({ t0: w.t0, t1: w.t1, text: w.text })),
  };
}

function captionFromDoc(c: CaptionDoc): Caption {
  return captionToDoc(c);
}

function regionToDoc(r: AudioRegion, offsetMs: number): AudioRegionDoc {
  return {
    id: r.id,
    fileName: r.fileName,
    path: r.path,
    startMs: r.startMs,
    endMs: r.endMs,
    offsetMs,
    volumeDb: encodeDb(r.volumeDb),
    fadeInMs: r.fadeInMs,
    fadeOutMs: r.fadeOutMs,
    loop: r.loop,
    duck: { enabled: r.duck.enabled, amountDb: r.duck.amountDb },
  };
}

function regionFromDoc(r: AudioRegionDoc): AudioRegion {
  return {
    id: r.id,
    fileName: r.fileName,
    path: r.path,
    startMs: r.startMs,
    endMs: r.endMs,
    volumeDb: decodeDb(r.volumeDb),
    fadeInMs: r.fadeInMs,
    fadeOutMs: r.fadeOutMs,
    loop: r.loop,
    duck: { enabled: r.duck.enabled, amountDb: r.duck.amountDb },
  };
}

function audioToDoc(a: AudioSettings): AudioSettingsDoc {
  return {
    tracks: { mic: encodeTrack(a.tracks.mic), system: encodeTrack(a.tracks.system) },
    master: encodeTrack(a.master),
    clickVolume: a.clickVolume,
  };
}

function defaultClips(video: MediaSourceV1): Clip[] {
  return [{ id: "clip-1", sourceStartMs: 0, sourceEndMs: video.durationMs, timelineStartMs: 0 }];
}

// ── Public mapping ──────────────────────────────────────────────────────────

/** Build a v1 document from editor state plus the metadata the store doesn't hold. */
export function toProjectDocument(editorData: EditorData, meta: ProjectMeta): ProjectV1 {
  const data = structuredClone(editorData);
  const m = structuredClone(meta);
  const offsets = m.audioRegionOffsets ?? {};

  const sources: ProjectV1["sources"] = { video: m.sources.video };
  if (m.sources.mic) sources.mic = m.sources.mic;
  if (m.sources.system) sources.system = m.sources.system;
  if (m.sources.webcam) sources.webcam = m.sources.webcam;
  if (m.sources.capture) sources.capture = m.sources.capture;
  if (data.cursorPointCount !== null) {
    const base = m.sources.telemetry ?? {
      path: DEFAULT_TELEMETRY_PATH,
      hasClicks: false,
      hasKeys: false,
      sampleHz: 0,
    };
    sources.telemetry = { ...base, pointCount: data.cursorPointCount };
  }

  const { intro, outro, ...effects } = data.effects;
  const timeline: ProjectV1["timeline"] = {
    durationMs: data.durationMs,
    clips: data.clips.length > 0 ? data.clips : (m.clips ?? defaultClips(m.sources.video)),
    zooms: data.zoomRegions.map(zoomToDoc),
    speeds: data.speedRegions.map(speedToDoc),
    annotations: data.annotations,
    captions: data.captions.map(captionToDoc),
    webcamRegions: m.webcamRegions ?? [],
    audioRegions: data.audio.regions.map((r) => regionToDoc(r, offsets[r.id] ?? 0)),
    transitions: m.transitions ?? [],
  };
  if (intro !== null) timeline.intro = intro;
  if (outro !== null) timeline.outro = outro;

  const doc: ProjectV1 = {
    schemaVersion: SCHEMA_VERSION,
    id: m.id,
    name: m.name,
    createdAt: m.createdAt,
    modifiedAt: m.modifiedAt,
    appVersion: m.appVersion,
    sources,
    timeline,
    frame: data.frame,
    cursor: data.cursor,
    webcam: data.webcam,
    audio: audioToDoc(data.audio),
    captionsStyle: data.captionStyle,
    captionsOptions: {
      model: data.captionModel,
      language: data.captionLanguage,
      burnIn: data.burnInCaptions,
    },
    effects,
    camera: { ...data.zoom.camera },
    autoZoom: { ...data.zoom.autoZoom },
    prefs: { saveRawWithProject: data.saveRawWithProject },
    exportPresets: m.exportPresets ?? [],
    ui: {
      inspectorTab: m.ui?.inspectorTab ?? "frame",
      timelineZoom: m.ui?.timelineZoom ?? 0,
      timelineHeight: m.ui?.timelineHeight ?? 240,
      collapsed: m.ui?.collapsed ?? {},
      activeTool: data.activeTool,
      selection: {
        zoomId: data.selectedZoomId,
        annotationId: data.selectedAnnotationId,
        speedId: data.selectedSpeedId,
      },
    },
  };
  if (m.lastExport) doc.lastExport = m.lastExport;
  return doc;
}

/** Hydrate editor state from a validated v1 document. */
export function fromProjectDocument(document: ProjectV1): EditorData {
  const doc = structuredClone(document);
  const t = doc.timeline;
  return {
    durationMs: t.durationMs,
    clips: t.clips,
    frame: doc.frame,
    cursor: doc.cursor,
    cursorPointCount: doc.sources.telemetry?.pointCount ?? null,
    zoom: { autoZoom: doc.autoZoom, camera: doc.camera },
    zoomRegions: t.zooms.map(zoomFromDoc),
    selectedZoomId: doc.ui.selection.zoomId,
    webcam: doc.webcam,
    audio: {
      tracks: {
        mic: decodeTrack(doc.audio.tracks.mic),
        system: decodeTrack(doc.audio.tracks.system),
      },
      regions: t.audioRegions.map(regionFromDoc),
      master: decodeTrack(doc.audio.master),
      clickVolume: doc.audio.clickVolume,
    },
    captions: t.captions.map(captionFromDoc),
    captionStyle: doc.captionsStyle,
    captionModel: doc.captionsOptions.model,
    captionLanguage: doc.captionsOptions.language,
    captionStatus: { kind: "idle" },
    burnInCaptions: doc.captionsOptions.burnIn,
    annotations: t.annotations satisfies Annotation[],
    activeTool: doc.ui.activeTool,
    selectedAnnotationId: doc.ui.selection.annotationId,
    effects: { ...doc.effects, intro: t.intro ?? null, outro: t.outro ?? null },
    speedRegions: t.speeds.map(speedFromDoc),
    selectedSpeedId: doc.ui.selection.speedId,
    saveRawWithProject: doc.prefs.saveRawWithProject,
  };
}

/** Everything in a document that `EditorData` does not hold. */
export function metaFromProjectDocument(document: ProjectV1): ProjectMeta {
  const doc = structuredClone(document);
  const sources: ProjectMeta["sources"] = { video: doc.sources.video };
  if (doc.sources.mic) sources.mic = doc.sources.mic;
  if (doc.sources.system) sources.system = doc.sources.system;
  if (doc.sources.webcam) sources.webcam = doc.sources.webcam;
  if (doc.sources.capture) sources.capture = doc.sources.capture;
  if (doc.sources.telemetry) {
    const { pointCount: _count, ...base } = doc.sources.telemetry;
    sources.telemetry = base;
  }
  const { activeTool: _tool, selection: _sel, ...ui } = doc.ui;
  const meta: ProjectMeta = {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
    appVersion: doc.appVersion,
    sources,
    clips: doc.timeline.clips,
    transitions: doc.timeline.transitions,
    webcamRegions: doc.timeline.webcamRegions,
    exportPresets: doc.exportPresets,
    ui,
    audioRegionOffsets: Object.fromEntries(
      doc.timeline.audioRegions.map((r) => [r.id, r.offsetMs]),
    ),
  };
  if (doc.lastExport) meta.lastExport = doc.lastExport;
  return meta;
}

/** Return a copy with `modifiedAt` bumped (SPEC §4: every write bumps it). */
export function touchModified(doc: ProjectV1, nowIso: string): ProjectV1 {
  return { ...doc, modifiedAt: nowIso };
}

/** `project.json` text (pretty-printed, stable key order from the mapping). */
export function serializeProjectDocument(doc: ProjectV1): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Parse `project.json` text, migrating and validating it. Never throws. */
export function parseProjectDocumentText(text: string): MigrationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: new ProjectLoadError("invalid-json", `project.json is not valid JSON: ${message}`),
    };
  }
  return migrate(raw);
}
