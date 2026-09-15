import { Segmented } from "@design/components";
import { type MessageKey, useT } from "../../i18n";
import { ACCENT_SWATCHES } from "../appearance";
import { PageHeading, Row, Switch } from "../controls";
import type { Density, SettingsProps, Theme } from "../types";

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; labelKey: MessageKey }> = [
  { value: "system", labelKey: "settings.appearance.theme.system" },
  { value: "light", labelKey: "settings.appearance.theme.light" },
  { value: "dark", labelKey: "settings.appearance.theme.dark" },
];

const DENSITY_OPTIONS: ReadonlyArray<{ value: Density; labelKey: MessageKey }> = [
  { value: "comfortable", labelKey: "settings.appearance.density.comfortable" },
  { value: "compact", labelKey: "settings.appearance.density.compact" },
];

export function AppearancePage({ settings, onChange }: SettingsProps) {
  const t = useT();
  return (
    <div>
      <PageHeading>{t("settings.section.appearance")}</PageHeading>

      <Row label={t("settings.appearance.theme")} help={t("settings.appearance.theme.help")}>
        <Segmented<Theme>
          name="settings-theme"
          value={settings.theme}
          options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(theme) => onChange({ theme })}
        />
      </Row>

      <Row label={t("settings.appearance.accent")}>
        <div
          role="radiogroup"
          aria-label={t("settings.appearance.accent")}
          style={{ display: "flex", gap: "var(--space-2)" }}
        >
          {ACCENT_SWATCHES.map((s) => {
            const selected = settings.accentColor === s.id;
            const label = t(s.labelKey);
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
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

      <Row label={t("settings.appearance.density")}>
        <Segmented<Density>
          name="settings-density"
          value={settings.density}
          options={DENSITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(density) => onChange({ density })}
        />
      </Row>

      <Switch
        checked={settings.reduceMotion}
        onChange={(reduceMotion) => onChange({ reduceMotion })}
        label={t("settings.appearance.reduceMotion")}
        help={t("settings.appearance.reduceMotion.help")}
      />
    </div>
  );
}
