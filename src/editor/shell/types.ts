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

/** Timeline track lanes shown in the shell (structure-only placeholders). */
export const TIMELINE_LANES: readonly string[] = [
  "Video",
  "Zoom",
  "Cursor",
  "Captions",
  "Audio",
] as const;

export interface EditorShellProps {
  projectName: string;
  durationMs: number;
  currentMs: number;
  isPlaying: boolean;
  previewQuality: PreviewQuality;
  onExport: () => void;
  onTogglePlay?: () => void;
  onQualityChange?: (quality: PreviewQuality) => void;
  onRename?: (name: string) => void;
}

export const sampleEditorShellProps: EditorShellProps = {
  projectName: "Untitled Demo",
  durationMs: 92_000,
  currentMs: 24_500,
  isPlaying: false,
  previewQuality: "auto",
  onExport: () => {},
};
