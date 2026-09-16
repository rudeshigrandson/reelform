import { Segmented } from "@design/components";
import { useId } from "react";
import { type MessageKey, useT } from "../../i18n";
import { ACCENT_SWATCHES } from "../appearance";
import { Line, MiniSelect, Page, Toggle } from "../controls";
import type { Density, SettingsProps, Theme } from "../types";

/** Mockup order: System · Dark · Light. */
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; labelKey: MessageKey }> = [
  { value: "system", labelKey: "settings.appearance.theme.system" },
  { value: "dark", labelKey: "settings.appearance.theme.dark" },
  { value: "light", labelKey: "settings.appearance.theme.light" },
];

const DENSITY_OPTIONS: ReadonlyArray<{ value: Density; labelKey: MessageKey }> = [
  { value: "comfortable", labelKey: "settings.appearance.density.comfortable" },
  { value: "compact", labelKey: "settings.appearance.density.compact" },
];

/** S24/05 — compact panel: theme track, accent dots, density and reduce-motion lines. */
export function AppearancePage({ settings, onChange }: SettingsProps) {
  const t = useT();
  const densityId = useId();
  const motionId = useId();
  const motionHelpId = useId();
  return (
    <Page title={t("settings.section.appearance")}>
      <section aria-label={t("settings.section.appearance")} className="rf-set-panel">
        <p className="rf-sr-only">
          {t("settings.appearance.theme")}: {t("settings.appearance.theme.help")}
        </p>
        <Segmented<Theme>
          name="settings-theme"
          className="rf-seg-fill"
          value={settings.theme}
          options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(theme) => onChange({ theme })}
        />

        <div
          role="radiogroup"
          aria-label={t("settings.appearance.accent")}
          className="rf-set-swatches"
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
                className="rf-set-swatch"
                onClick={() => onChange({ accentColor: s.id })}
                style={{
                  // While another accent is chosen, --accent is overridden; the
                  // theme's own accent is kept in --accent-theme for this swatch.
                  background: s.color ?? "var(--accent-theme, var(--accent))",
                }}
              />
            );
          })}
        </div>

        <Line label={t("settings.appearance.density")} htmlFor={densityId}>
          <MiniSelect<Density>
            id={densityId}
            value={settings.density}
            options={DENSITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(density) => onChange({ density })}
          />
        </Line>

        <Line label={t("settings.appearance.reduceMotion")} htmlFor={motionId}>
          <Toggle
            id={motionId}
            size="sm"
            checked={settings.reduceMotion}
            describedBy={motionHelpId}
            onChange={(reduceMotion) => onChange({ reduceMotion })}
          />
        </Line>
        <p id={motionHelpId} className="rf-sr-only">
          {t("settings.appearance.reduceMotion.help")}
        </p>
      </section>
    </Page>
  );
}
