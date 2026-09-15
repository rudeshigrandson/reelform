import { Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useEffect, useState } from "react";
import { type MessageKey, type Translate, useT } from "../../i18n";
import {
  ExternalLink,
  Group,
  NumberField,
  PageHeading,
  Row,
  Select,
  type SelectOption,
  StatusText,
  Switch,
} from "../controls";
import { type DeviceOption, PRIVACY_URL } from "../services";
import type { Countdown, DefaultSource, Fps, SettingsProps } from "../types";

const SOURCE_OPTIONS: ReadonlyArray<{ value: DefaultSource; labelKey: MessageKey }> = [
  { value: "display", labelKey: "settings.recording.source.display" },
  { value: "window", labelKey: "settings.recording.source.window" },
  { value: "region", labelKey: "settings.recording.source.region" },
];

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<`${Fps}`>> = [
  { value: "30", label: "30" },
  { value: "60", label: "60" },
];

const COUNTDOWNS: readonly Countdown[] = [0, 3, 5, 10];

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

const DEVICE_COPY = {
  audioinput: {
    numbered: "settings.recording.micNumbered",
    missing: "settings.recording.micMissing",
  },
  videoinput: {
    numbered: "settings.recording.cameraNumbered",
    missing: "settings.recording.cameraMissing",
  },
} as const satisfies Record<DeviceOption["kind"], { numbered: MessageKey; missing: MessageKey }>;

function deviceOptions(
  load: DeviceLoad,
  kind: DeviceOption["kind"],
  current: string | null,
  t: Translate,
): { options: SelectOption<string>[]; hiddenLabels: boolean } {
  const copy = DEVICE_COPY[kind];
  const options: SelectOption<string>[] = [{ value: NONE, label: t("common.none") }];
  let hiddenLabels = false;
  if (load.status === "ready") {
    let n = 0;
    for (const d of load.devices) {
      if (d.kind !== kind) continue;
      n++;
      if (!d.label) hiddenLabels = true;
      options.push({ value: d.deviceId, label: d.label || t(copy.numbered, { n }) });
    }
  }
  if (current !== null && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: t(copy.missing) });
  }
  return { options, hiddenLabels };
}

export function RecordingPage({ settings, onChange, services }: SettingsProps) {
  const t = useT();
  const devices = useDeviceList(services?.enumerateDevices);
  const mics = deviceOptions(devices, "audioinput", settings.defaultMicId, t);
  const cams = deviceOptions(devices, "videoinput", settings.defaultCameraId, t);
  const deviceSelectsDisabled = devices.status !== "ready";
  const sourceOptions = SOURCE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const countdownOptions: SegmentedOption<`${Countdown}`>[] = COUNTDOWNS.map((n) => ({
    value: `${n}`,
    label:
      n === 0
        ? t("settings.recording.countdown.off")
        : t("settings.recording.countdown.seconds", { n }),
  }));
  // No platform helper implements these yet (S24): shown, but disabled.
  const notYet = t("common.notAvailableYet");

  return (
    <div>
      <PageHeading>{t("settings.section.recording")}</PageHeading>

      <Row label={t("settings.recording.defaultSource")}>
        <Segmented<DefaultSource>
          name="settings-source"
          value={settings.defaultSource}
          options={sourceOptions}
          onChange={(defaultSource) => onChange({ defaultSource })}
        />
      </Row>

      <Row label={t("settings.recording.defaultFps")}>
        <Segmented<`${Fps}`>
          name="settings-fps"
          value={`${settings.defaultFps}`}
          options={FPS_OPTIONS}
          onChange={(v) => onChange({ defaultFps: Number(v) as Fps })}
        />
      </Row>

      <Group title={t("settings.recording.devices")}>
        {devices.status === "loading" ? (
          <StatusText>{t("settings.recording.devices.loading")}</StatusText>
        ) : null}
        {devices.status === "error" ? (
          <StatusText tone="danger">
            {t("settings.recording.devices.error", { message: devices.message })}
          </StatusText>
        ) : null}
        {devices.status === "unavailable" ? (
          <StatusText>{t("settings.recording.devices.unavailable")}</StatusText>
        ) : null}
        {mics.hiddenLabels || cams.hiddenLabels ? (
          <StatusText tone="warning">{t("settings.recording.devices.hiddenLabels")}</StatusText>
        ) : null}
        <Select
          label={t("settings.recording.defaultMic")}
          value={settings.defaultMicId ?? NONE}
          options={mics.options}
          disabled={deviceSelectsDisabled}
          onChange={(v) => onChange({ defaultMicId: v === NONE ? null : v })}
        />
        <Select
          label={t("settings.recording.defaultCamera")}
          value={settings.defaultCameraId ?? NONE}
          options={cams.options}
          disabled={deviceSelectsDisabled}
          onChange={(v) => onChange({ defaultCameraId: v === NONE ? null : v })}
        />
        <Switch
          checked={settings.defaultSystemAudio}
          onChange={(defaultSystemAudio) => onChange({ defaultSystemAudio })}
          label={t("settings.recording.systemAudio")}
        />
      </Group>

      <Row label={t("settings.recording.defaultCountdown")}>
        <Segmented<`${Countdown}`>
          name="settings-countdown"
          value={`${settings.defaultCountdown}`}
          options={countdownOptions}
          onChange={(v) => onChange({ defaultCountdown: Number(v) as Countdown })}
        />
      </Row>

      <Group title={t("settings.recording.whileRecording")}>
        <Switch
          checked={settings.hideHudWhileRecording}
          onChange={(hideHudWhileRecording) => onChange({ hideHudWhileRecording })}
          label={t("settings.recording.hideHud")}
        />
        <Switch
          checked={settings.hideDesktopIcons}
          onChange={(hideDesktopIcons) => onChange({ hideDesktopIcons })}
          label={t("settings.recording.hideDesktopIcons")}
          disabled
          help={notYet}
        />
        <Switch
          checked={settings.doNotDisturbWhileRecording}
          onChange={(doNotDisturbWhileRecording) => onChange({ doNotDisturbWhileRecording })}
          label={t("settings.recording.doNotDisturb")}
          disabled
          help={notYet}
        />
        <Switch
          checked={settings.showClicksDuringCapture}
          onChange={(showClicksDuringCapture) => onChange({ showClicksDuringCapture })}
          label={t("settings.recording.showClicks")}
          disabled
          help={notYet}
        />
        <Switch
          checked={settings.hideCursorByDefault}
          onChange={(hideCursorByDefault) => onChange({ hideCursorByDefault })}
          label={t("settings.recording.hideCursor")}
        />
        <Switch
          checked={settings.recordTypedTextBadges}
          onChange={(recordTypedTextBadges) => onChange({ recordTypedTextBadges })}
          label={t("settings.recording.typedText")}
          help={
            <>
              {t("settings.recording.typedText.help")}{" "}
              <ExternalLink url={PRIVACY_URL} system={services?.system}>
                {t("common.privacyPolicy")}
              </ExternalLink>
            </>
          }
        />
      </Group>

      <Group title={t("settings.recording.files")}>
        <Switch
          checked={settings.autoDeleteRawAfterExport}
          onChange={(autoDeleteRawAfterExport) => onChange({ autoDeleteRawAfterExport })}
          label="Auto-delete raw recordings after export (keep project)"
        />
        <NumberField
          label={t("settings.recording.maxLength")}
          value={settings.maxLengthHours}
          min={0.1}
          max={24}
          step={0.5}
          suffix={t("settings.recording.hours")}
          onChange={(maxLengthHours) => onChange({ maxLengthHours })}
        />
        <NumberField
          label={t("settings.recording.diskWarning")}
          value={settings.diskWarningThresholdGb}
          min={0.5}
          max={1000}
          step={0.5}
          suffix={t("settings.recording.gigabytes")}
          onChange={(diskWarningThresholdGb) => onChange({ diskWarningThresholdGb })}
        />
      </Group>
    </div>
  );
}
