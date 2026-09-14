import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type {
  CaptureBackend,
  Countdown,
  Fps,
  SettingsProps,
  Theme,
} from "./types";

export { sampleSettings } from "./types";
export type { SettingsProps, SettingsState, SettingsPatch } from "./types";

type SectionId =
  | "general"
  | "recording"
  | "audio"
  | "captions"
  | "shortcuts"
  | "advanced"
  | "about";

interface SectionDef {
  id: SectionId;
  label: string;
}

const SECTIONS: ReadonlyArray<SectionDef> = [
  { id: "general", label: "General" },
  { id: "recording", label: "Recording" },
  { id: "audio", label: "Audio" },
  { id: "captions", label: "Captions" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
];

const THEME_OPTIONS: ReadonlyArray<SegmentedOption<Theme>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
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

const BACKEND_OPTIONS: ReadonlyArray<SegmentedOption<CaptureBackend>> = [
  { value: "auto", label: "Auto" },
  { value: "native", label: "Native" },
  { value: "electron", label: "Electron" },
];

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "220px 1fr",
  width: "860px",
  height: "620px",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "var(--font-body)",
  overflow: "hidden",
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  padding: "var(--space-4)",
  background: "var(--color-surface)",
  borderRight: "1px solid var(--color-neutral-200)",
};

const panelStyle: CSSProperties = {
  padding: "var(--space-6)",
  overflowY: "auto",
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  marginBottom: "var(--space-5)",
};

const inlineRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-2)",
};

const labelStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "var(--color-neutral-700)",
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.4rem",
  margin: "0 0 var(--space-5)",
};

function navItemStyle(active: boolean): CSSProperties {
  return {
    textAlign: "left",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: "pointer",
    font: "inherit",
    fontWeight: active ? 600 : 400,
    background: active ? "var(--color-accent)" : "transparent",
    color: active ? "#fff" : "var(--color-text)",
  };
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Stub({ title }: { title: string }) {
  return (
    <div>
      <h2 style={headingStyle}>{title}</h2>
      <p style={{ color: "var(--color-neutral-600)" }}>Coming soon.</p>
    </div>
  );
}

function GeneralPanel({ settings, onChange, onChangeRecordingsFolder }: SettingsProps) {
  return (
    <div>
      <h2 style={headingStyle}>General</h2>

      <div style={fieldRowStyle}>
        <span style={labelStyle}>Theme</span>
        <Segmented<Theme>
          name="settings-theme"
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => onChange({ theme })}
        />
      </div>

      <div style={fieldRowStyle}>
        <div style={inlineRowStyle}>
          <div style={{ flex: 1 }}>
            <Input
              label="Recordings folder"
              value={settings.recordingsFolder}
              readOnly
            />
          </div>
          <Button onClick={onChangeRecordingsFolder}>Change…</Button>
        </div>
      </div>

      <div style={fieldRowStyle}>
        <Toggle
          checked={settings.autoPrune}
          onChange={(autoPrune) => onChange({ autoPrune })}
          label="Auto-prune old recordings"
        />
        <div style={{ maxWidth: "160px" }}>
          <Input
            label="Prune after (days)"
            type="number"
            min={1}
            value={settings.autoPruneDays}
            disabled={!settings.autoPrune}
            onChange={(e) =>
              onChange({ autoPruneDays: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div style={fieldRowStyle}>
        <Toggle
          checked={settings.checkUpdates}
          onChange={(checkUpdates) => onChange({ checkUpdates })}
          label="Check for updates on launch"
        />
      </div>
    </div>
  );
}

function RecordingPanel({ settings, onChange }: SettingsProps) {
  return (
    <div>
      <h2 style={headingStyle}>Recording</h2>

      <div style={fieldRowStyle}>
        <span style={labelStyle}>Default frame rate</span>
        <Segmented<`${Fps}`>
          name="settings-fps"
          value={`${settings.defaultFps}`}
          options={FPS_OPTIONS}
          onChange={(v) => onChange({ defaultFps: Number(v) as Fps })}
        />
      </div>

      <div style={fieldRowStyle}>
        <span style={labelStyle}>Default countdown</span>
        <Segmented<`${Countdown}`>
          name="settings-countdown"
          value={`${settings.defaultCountdown}`}
          options={COUNTDOWN_OPTIONS}
          onChange={(v) =>
            onChange({ defaultCountdown: Number(v) as Countdown })
          }
        />
      </div>

      <div style={fieldRowStyle}>
        <span style={labelStyle}>Capture backend</span>
        <Segmented<CaptureBackend>
          name="settings-backend"
          value={settings.captureBackend}
          options={BACKEND_OPTIONS}
          onChange={(captureBackend) => onChange({ captureBackend })}
        />
      </div>

      <div style={fieldRowStyle}>
        <Toggle
          checked={settings.hideCursorByDefault}
          onChange={(hideCursorByDefault) => onChange({ hideCursorByDefault })}
          label="Hide cursor by default"
        />
      </div>

      <div style={{ ...fieldRowStyle, maxWidth: "160px" }}>
        <Input
          label="Max length (hours)"
          type="number"
          min={0}
          step={0.5}
          value={settings.maxLengthHours}
          onChange={(e) => onChange({ maxLengthHours: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

export function Settings(props: SettingsProps) {
  const [active, setActive] = useState<SectionId>("general");

  return (
    <div style={shellStyle}>
      <nav style={navStyle} aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            style={navItemStyle(s.id === active)}
            aria-current={s.id === active ? "page" : undefined}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <section style={panelStyle}>
        {active === "general" && <GeneralPanel {...props} />}
        {active === "recording" && <RecordingPanel {...props} />}
        {active === "audio" && <Stub title="Audio" />}
        {active === "captions" && <Stub title="Captions" />}
        {active === "shortcuts" && <Stub title="Shortcuts" />}
        {active === "advanced" && <Stub title="Advanced" />}
        {active === "about" && <Stub title="About" />}
      </section>
    </div>
  );
}
