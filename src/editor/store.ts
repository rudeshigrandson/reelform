import { create } from "zustand";
import type { Annotation, AnnotationTool } from "./inspector/annotations";
import { type AudioSettings, DEFAULT_AUDIO_SETTINGS } from "./inspector/audio";
import {
  type Caption,
  type CaptionModel,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
  type GenerationStatus,
  IDLE_STATUS,
} from "./inspector/captions";
import { type CursorSettings, DEFAULT_CURSOR_SETTINGS } from "./inspector/cursor";
import {
  DEFAULT_EFFECTS_SETTINGS,
  type EffectsSettings,
  type SpeedRegionEdit,
} from "./inspector/effects";
import { DEFAULT_FRAME_SETTINGS, type FrameSettings } from "./inspector/frame";
import { DEFAULT_WEBCAM_SETTINGS, type WebcamSettings } from "./inspector/webcam";
import { DEFAULT_ZOOM_SETTINGS, type ZoomRegion, type ZoomSettings } from "./inspector/zoom";

/**
 * Editor document state backing the inspector tabs. Pre-persistence: this lives
 * in memory until the `.reelform` save/load path (SPEC §4) owns the document.
 */

export interface EditorData {
  durationMs: number;
  currentMs: number;
  frame: FrameSettings;
  cursor: CursorSettings;
  cursorPointCount: number | null;
  zoom: ZoomSettings;
  zoomRegions: ZoomRegion[];
  selectedZoomId: string | null;
  webcam: WebcamSettings;
  audio: AudioSettings;
  captions: Caption[];
  captionStyle: CaptionStyle;
  captionModel: CaptionModel;
  captionLanguage: string;
  captionStatus: GenerationStatus;
  burnInCaptions: boolean;
  annotations: Annotation[];
  activeTool: AnnotationTool | null;
  selectedAnnotationId: string | null;
  effects: EffectsSettings;
  speedRegions: SpeedRegionEdit[];
  selectedSpeedId: string | null;
  saveRawWithProject: boolean;
}

export interface EditorState extends EditorData {
  update: (patch: Partial<EditorData>) => void;
  reset: () => void;
}

export function initialEditorData(): EditorData {
  return {
    durationMs: 92_000,
    currentMs: 24_500,
    frame: structuredClone(DEFAULT_FRAME_SETTINGS),
    cursor: structuredClone(DEFAULT_CURSOR_SETTINGS),
    cursorPointCount: 1204,
    zoom: structuredClone(DEFAULT_ZOOM_SETTINGS),
    zoomRegions: [],
    selectedZoomId: null,
    webcam: structuredClone(DEFAULT_WEBCAM_SETTINGS),
    audio: structuredClone(DEFAULT_AUDIO_SETTINGS),
    captions: [],
    captionStyle: structuredClone(DEFAULT_CAPTION_STYLE),
    captionModel: "balanced",
    captionLanguage: "auto",
    captionStatus: IDLE_STATUS,
    burnInCaptions: false,
    annotations: [],
    activeTool: null,
    selectedAnnotationId: null,
    effects: structuredClone(DEFAULT_EFFECTS_SETTINGS),
    speedRegions: [],
    selectedSpeedId: null,
    saveRawWithProject: true,
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  ...initialEditorData(),
  update: (patch) => set(patch),
  reset: () => set(initialEditorData()),
}));
