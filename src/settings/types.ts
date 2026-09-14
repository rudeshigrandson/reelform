export type Theme = "system" | "light" | "dark";
export type Fps = 30 | 60;
export type Countdown = 0 | 3 | 5 | 10;
export type CaptureBackend = "auto" | "native" | "electron";

export interface SettingsState {
  // General
  theme: Theme;
  recordingsFolder: string;
  autoPrune: boolean;
  autoPruneDays: number;
  checkUpdates: boolean;
  // Recording
  defaultFps: Fps;
  defaultCountdown: Countdown;
  captureBackend: CaptureBackend;
  hideCursorByDefault: boolean;
  maxLengthHours: number;
}

export type SettingsPatch = Partial<SettingsState>;

export interface SettingsProps {
  settings: SettingsState;
  onChange: (patch: SettingsPatch) => void;
  /** Invoked when the user asks to change the recordings folder (native picker lives upstream). */
  onChangeRecordingsFolder?: () => void;
}

export const sampleSettings: SettingsState = {
  theme: "system",
  recordingsFolder: "~/Movies/Reelform",
  autoPrune: false,
  autoPruneDays: 30,
  checkUpdates: true,
  defaultFps: 60,
  defaultCountdown: 3,
  captureBackend: "auto",
  hideCursorByDefault: false,
  maxLengthHours: 2,
};
