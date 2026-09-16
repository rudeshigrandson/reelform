import type { ReactNode } from "react";

export type InspectorTab =
  | "Frame"
  | "Cursor"
  | "Zoom"
  | "Webcam"
  | "Audio"
  | "Captions"
  | "Annotations"
  | "Effects"
  | "Project";

export const INSPECTOR_TABS: readonly InspectorTab[] = [
  "Frame",
  "Cursor",
  "Zoom",
  "Webcam",
  "Audio",
  "Captions",
  "Annotations",
  "Effects",
  "Project",
] as const;

export type PreviewQuality = "auto" | "full" | "half";

/**
 * Editor chrome geometry in px (design S12: "Top bar 48, inspector 320, playback
 * bar 44, timeline 260"; S12/14 narrow: 44 / 48px rail / 40 / 180). Floating
 * editor-level toasts position against the canvas well with these.
 */
export const SHELL_LAYOUT = {
  wide: { topBar: 48, inspector: 320, playback: 44, timeline: 260 },
  narrow: { topBar: 44, inspector: 48, playback: 40, timeline: 180 },
} as const;

/** Inspector icon rail width and the narrow popover panel width. */
export const INSPECTOR_RAIL_PX = 48;

/** Timeline track lanes shown in the shell (structure-only placeholders). */
export const TIMELINE_LANES: readonly string[] = [
  "Video",
  "Zoom",
  "Cursor",
  "Captions",
  "Audio",
] as const;

/** Undo/redo state for the top bar (from `useHistoryState`). */
export interface HistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  /** "Undo: Move zoom" — shown as the button tooltip. */
  undoLabel: string | null;
  redoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
}

export interface EditorShellProps {
  projectName: string;
  /** Controlled inspector tab (auto-switch on selection, §6.8); uncontrolled when omitted. */
  activeTab?: InspectorTab | undefined;
  onTabChange?: ((tab: InspectorTab) => void) | undefined;
  /** "‹ Projects" in the top bar. */
  onBack?: (() => void) | undefined;
  /** Unsaved changes: "•" after the project name (guide S12 state 12). */
  dirty?: boolean | undefined;
  history?: HistoryControls | undefined;
  /**
   * Narrow layout (guide S12 state 14): inspector collapses to its icon rail
   * with popover panels, timeline 180px. Omitted → follows the window width.
   */
  narrow?: boolean | undefined;
  durationMs: number;
  currentMs: number;
  isPlaying: boolean;
  previewQuality: PreviewQuality;
  onExport: () => void;
  onTogglePlay?: (() => void) | undefined;
  onQualityChange?: ((quality: PreviewQuality) => void) | undefined;
  /**
   * Name committed on blur / Enter (Escape reverts); omitted → read-only. May
   * resolve `false` (or reject) when the rename failed, reverting the field.
   */
  onRename?: ((name: string) => unknown) | undefined;
  /** Renders the body of the active inspector tab; placeholder text when omitted. */
  renderInspector?: ((tab: InspectorTab) => ReactNode) | undefined;
  /** Renders the preview canvas; placeholder box when omitted. */
  renderPreview?: (() => ReactNode) | undefined;
  /** Renders the 44px playback bar above the timeline; row omitted when absent. */
  renderPlaybackBar?: (() => ReactNode) | undefined;
  /** Renders the timeline; placeholder lanes + playhead when omitted. */
  renderTimeline?: (() => ReactNode) | undefined;
}

export const sampleEditorShellProps: EditorShellProps = {
  projectName: "Untitled Demo",
  durationMs: 92_000,
  currentMs: 24_500,
  isPlaying: false,
  previewQuality: "auto",
  onExport: () => {},
};
