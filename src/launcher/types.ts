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

export interface LauncherProps {
  sources: ReadonlyArray<SourceItem>;
  micDevices: ReadonlyArray<DeviceInfo>;
  webcamDevices: ReadonlyArray<DeviceInfo>;
  /** System audio capture is unavailable on the macOS Electron backend. */
  systemAudioSupported: boolean;
  onStart: (options: RecordOptions) => void;
  onOpenSettings?: () => void;
}
