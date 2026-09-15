import { Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { ACCENT_SWATCHES } from "../appearance";
import { PageHeading, Row, Switch } from "../controls";
import type { Density, SettingsProps, Theme } from "../types";

const THEME_OPTIONS: ReadonlyArray<SegmentedOption<Theme>> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS: ReadonlyArray<SegmentedOption<Density>> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

export function AppearancePage({ settings, onChange }: SettingsProps) {
  return (
    <div>
      <PageHeading>Appearance</PageHeading>

      <Row label="Theme" help="System follows your OS light/dark setting.">
        <Segmented<Theme>
          name="settings-theme"
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => onChange({ theme })}
        />
      </Row>

      <Row label="Accent color">
        <div
          role="radiogroup"
          aria-label="Accent color"
          style={{ display: "flex", gap: "var(--space-2)" }}
        >
          {ACCENT_SWATCHES.map((s) => {
            const selected = settings.accentColor === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={s.label}
                title={s.label}
                onClick={() => onChange({ accentColor: s.id })}
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "var(--radius-full)",
                  cursor: "pointer",
                  // While another accent is chosen, --accent is overridden; the
                  // theme's own accent is kept in --accent-theme for this swatch.
                  background: s.color ?? "var(--accent-theme, var(--accent))",
                  border: "2px solid var(--bg-app)",
                  boxShadow: selected
                    ? "0 0 0 2px var(--text-1)"
                    : "0 0 0 1px var(--border-strong)",
                }}
              />
            );
          })}
        </div>
      </Row>

      <Row label="UI density">
        <Segmented<Density>
          name="settings-density"
          value={settings.density}
          options={DENSITY_OPTIONS}
          onChange={(density) => onChange({ density })}
        />
      </Row>

      <Switch
        checked={settings.reduceMotion}
        onChange={(reduceMotion) => onChange({ reduceMotion })}
        label="Reduce motion"
        help="Replaces animated transitions with fades. Exported videos are unaffected."
      />
    </div>
  );
}
