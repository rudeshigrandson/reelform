import { Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useEffect, useState } from "react";
import {
  Group,
  NumberField,
  PageHeading,
  Row,
  Select,
  type SelectOption,
  StatusText,
  Switch,
} from "../controls";
import type { DeviceOption } from "../services";
import type { Countdown, DefaultSource, Fps, SettingsProps } from "../types";

const SOURCE_OPTIONS: ReadonlyArray<SegmentedOption<DefaultSource>> = [
  { value: "display", label: "Display" },
  { value: "window", label: "Window" },
  { value: "region", label: "Region" },
];

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<`${Fps}`>> = [
  { value: "30", label: "30" },
  { value: "60", label: "60" },
];

const COUNTDOWN_OPTIONS: ReadonlyArray<SegmentedOption<`${Countdown}`>> = [
  { value: "0", label: "Off" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
];

const NONE = "__none__";

type DeviceLoad =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; devices: DeviceOption[] };

/** Device list for the default mic/camera selects (S24 loading/error/permission states). */
export function useDeviceList(enumerate: (() => Promise<DeviceOption[]>) | undefined): DeviceLoad {
  const [state, setState] = useState<DeviceLoad>(
    enumerate ? { status: "loading" } : { status: "unavailable" },
  );
  useEffect(() => {
    if (!enumerate) {
      setState({ status: "unavailable" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    enumerate().then(
      (devices) => live && setState({ status: "ready", devices }),
      (err: unknown) =>
        live &&
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [enumerate]);
  return state;
}

function deviceOptions(
  load: DeviceLoad,
  kind: DeviceOption["kind"],
  current: string | null,
  noun: string,
): { options: SelectOption<string>[]; hiddenLabels: boolean } {
  const options: SelectOption<string>[] = [{ value: NONE, label: "None" }];
  let hiddenLabels = false;
  if (load.status === "ready") {
    let n = 0;
    for (const d of load.devices) {
      if (d.kind !== kind) continue;
      n++;
      if (!d.label) hiddenLabels = true;
      options.push({ value: d.deviceId, label: d.label || `${noun} ${n}` });
    }
  }
  if (current !== null && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: `${noun} (not connected)` });
  }
  return { options, hiddenLabels };
}

export function RecordingPage({ settings, onChange, services }: SettingsProps) {
  const devices = useDeviceList(services?.enumerateDevices);
  const mics = deviceOptions(devices, "audioinput", settings.defaultMicId, "Microphone");
  const cams = deviceOptions(devices, "videoinput", settings.defaultCameraId, "Camera");
  const deviceSelectsDisabled = devices.status !== "ready";

  return (
    <div>
      <PageHeading>Recording</PageHeading>

      <Row label="Default source">
        <Segmented<DefaultSource>
          name="settings-source"
          value={settings.defaultSource}
          options={SOURCE_OPTIONS}
          onChange={(defaultSource) => onChange({ defaultSource })}
        />
      </Row>

      <Row label="Default frame rate">
        <Segmented<`${Fps}`>
          name="settings-fps"
          value={`${settings.defaultFps}`}
          options={FPS_OPTIONS}
          onChange={(v) => onChange({ defaultFps: Number(v) as Fps })}
        />
      </Row>

      <Group title="Devices">
        {devices.status === "loading" ? <StatusText>Looking for devices…</StatusText> : null}
        {devices.status === "error" ? (
          <StatusText tone="danger">Couldn't list devices: {devices.message}</StatusText>
        ) : null}
        {devices.status === "unavailable" ? (
          <StatusText>Device selection is available in the desktop app.</StatusText>
        ) : null}
        {mics.hiddenLabels || cams.hiddenLabels ? (
          <StatusText tone="warning">
            Device names are hidden until Reelform has microphone and camera permission.
          </StatusText>
        ) : null}
        <Select
          label="Default microphone"
          value={settings.defaultMicId ?? NONE}
          options={mics.options}
          disabled={deviceSelectsDisabled}
          onChange={(v) => onChange({ defaultMicId: v === NONE ? null : v })}
        />
        <Select
          label="Default camera"
          value={settings.defaultCameraId ?? NONE}
          options={cams.options}
          disabled={deviceSelectsDisabled}
          onChange={(v) => onChange({ defaultCameraId: v === NONE ? null : v })}
        />
        <Switch
          checked={settings.defaultSystemAudio}
          onChange={(defaultSystemAudio) => onChange({ defaultSystemAudio })}
          label="Record system audio by default"
        />
      </Group>

      <Row label="Default countdown">
        <Segmented<`${Countdown}`>
          name="settings-countdown"
          value={`${settings.defaultCountdown}`}
          options={COUNTDOWN_OPTIONS}
          onChange={(v) => onChange({ defaultCountdown: Number(v) as Countdown })}
        />
      </Row>

      <Group title="While recording">
        <Switch
          checked={settings.hideHudWhileRecording}
          onChange={(hideHudWhileRecording) => onChange({ hideHudWhileRecording })}
          label="Hide HUD while recording"
        />
        <Switch
          checked={settings.hideDesktopIcons}
          onChange={(hideDesktopIcons) => onChange({ hideDesktopIcons })}
          label="Hide desktop icons"
        />
        <Switch
          checked={settings.doNotDisturbWhileRecording}
          onChange={(doNotDisturbWhileRecording) => onChange({ doNotDisturbWhileRecording })}
          label="Do Not Disturb while recording"
        />
        <Switch
          checked={settings.showClicksDuringCapture}
          onChange={(showClicksDuringCapture) => onChange({ showClicksDuringCapture })}
          label="Show clicks during capture"
        />
        <Switch
          checked={settings.hideCursorByDefault}
          onChange={(hideCursorByDefault) => onChange({ hideCursorByDefault })}
          label="Hide cursor by default"
        />
      </Group>

      <Group title="Files & limits">
        <Switch
          checked={settings.autoDeleteRawAfterExport}
          onChange={(autoDeleteRawAfterExport) => onChange({ autoDeleteRawAfterExport })}
          label="Auto-delete raw recordings after export (keep project)"
        />
        <NumberField
          label="Max recording length"
          value={settings.maxLengthHours}
          min={0.1}
          max={24}
          step={0.5}
          suffix="hours"
          onChange={(maxLengthHours) => onChange({ maxLengthHours })}
        />
        <NumberField
          label="Warn when free disk space is below"
          value={settings.diskWarningThresholdGb}
          min={0.5}
          max={1000}
          step={0.5}
          suffix="GB"
          onChange={(diskWarningThresholdGb) => onChange({ diskWarningThresholdGb })}
        />
      </Group>
    </div>
  );
}
