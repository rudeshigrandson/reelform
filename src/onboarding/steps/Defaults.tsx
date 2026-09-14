import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { Countdown, Fps, OnboardingDefaults } from "../types";

export interface DefaultsProps {
  defaults: OnboardingDefaults;
  onDefaultsChange: (patch: Partial<OnboardingDefaults>) => void;
  onChangeFolder: () => void;
  onContinue: () => void;
}

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<Fps>> = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];

const COUNTDOWN_OPTIONS: ReadonlyArray<SegmentedOption<Countdown>> = [
  { value: 0, label: "0" },
  { value: 3, label: "3" },
  { value: 5, label: "5" },
  { value: 10, label: "10" },
];

export function Defaults({
  defaults,
  onDefaultsChange,
  onChangeFolder,
  onContinue,
}: DefaultsProps) {
  return (
    <section
      aria-labelledby="onboarding-defaults-title"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <h2
        id="onboarding-defaults-title"
        style={{
          fontFamily: "var(--font-heading)",
          color: "var(--color-text)",
          fontSize: "1.75rem",
          margin: 0,
        }}
      >
        Set your defaults
      </h2>

      <div className="field">
        <span id="onboarding-fps-label">Default frame rate</span>
        <Segmented<Fps>
          name="onboarding-fps"
          value={defaults.fps}
          options={FPS_OPTIONS}
          onChange={(fps) => onDefaultsChange({ fps })}
        />
      </div>

      <div className="field">
        <span id="onboarding-countdown-label">Default countdown</span>
        <Segmented<Countdown>
          name="onboarding-countdown"
          value={defaults.countdown}
          options={COUNTDOWN_OPTIONS}
          onChange={(countdown) => onDefaultsChange({ countdown })}
        />
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)" }}>
        <div style={{ flex: 1 }}>
          <Input label="Recordings folder" value={defaults.recordingsFolder} readOnly />
        </div>
        <Button variant="secondary" onClick={onChangeFolder}>
          Change…
        </Button>
      </div>

      <Button variant="primary" onClick={onContinue}>
        Continue
      </Button>
    </section>
  );
}
