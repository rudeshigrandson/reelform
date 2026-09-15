/** Local domain types for the Launcher screen. Presentational, props-driven. */

export type SourceMode = "screen" | "window" | "region";

export type Fps = 30 | 60;

export type Countdown = 0 | 3 | 5 | 10;

/** A capturable source — a display or an application window. */
export interface SourceItem {
  id: string;
  kind: "display" | "window";
  name: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
}

/**
 * A source in the S06 picker: a launcher card plus what the picker groups,
 * filters and dims by.
 */
export interface PickerSource extends SourceItem {
  /** Window title (displays: the display name). */
  title: string;
  appName?: string | undefined;
  /** data: URL app icon for the group header. */
  appIcon?: string | undefined;
  /** Minimized windows have no live thumbnail; shown dimmed. */
  minimized: boolean;
}

/** An audio or video input device. */
export interface DeviceInfo {
  id: string;
  label: string;
}

/** The recording configuration emitted when the user hits Record. */
export interface RecordOptions {
  sourceId: string;
  mode: SourceMode;
  mic: boolean;
  micDeviceId?: string;
  systemAudio: boolean;
  webcam: boolean;
  webcamDeviceId?: string;
  fps: Fps;
  countdown: Countdown;
  hideCursor: boolean;
}

/** Banner above the form: permission denied, fallback backend, disk low… */
export interface LauncherNotice {
  id: string;
  tone: "info" | "warning" | "danger";
  message: string;
  action?: { label: string; onClick: () => void } | undefined;
  onDismiss?: (() => void) | undefined;
}

/** Initial choices (e.g. from Settings defaults). */
export type LauncherDefaults = Partial<Omit<RecordOptions, "sourceId">>;

export interface LauncherProps {
  sources: ReadonlyArray<SourceItem>;
  micDevices: ReadonlyArray<DeviceInfo>;
  webcamDevices: ReadonlyArray<DeviceInfo>;
  /** System audio capture is unavailable on the macOS Electron backend. */
  systemAudioSupported: boolean;
  /** Why system audio is unavailable; defaults to "Unavailable on macOS". */
  systemAudioNote?: string | undefined;
  onStart: (options: RecordOptions) => void;
  onOpenSettings?: (() => void) | undefined;
  /** Source list state; `ready` by default. */
  sourcesStatus?: "loading" | "ready" | "error" | undefined;
  sourcesError?: string | undefined;
  onRetrySources?: (() => void) | undefined;
  notices?: ReadonlyArray<LauncherNotice> | undefined;
  /** A start is in progress: Record is disabled and shows `busyLabel`. */
  busy?: boolean | undefined;
  busyLabel?: string | undefined;
  defaults?: LauncherDefaults | undefined;
  /** When set, "Browse…" opens the S06 source picker over these sources. */
  pickerSources?: ReadonlyArray<PickerSource> | undefined;
}
