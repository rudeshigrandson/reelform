import { useState } from "react";
import { useT } from "../i18n";
import { AboutPage } from "./pages/AboutPage";
import { AdvancedPage } from "./pages/AdvancedPage";
import { AppearancePage } from "./pages/AppearancePage";
import { EditorPage } from "./pages/EditorPage";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { GeneralPage } from "./pages/GeneralPage";
import { RecordingPage } from "./pages/RecordingPage";
import { ShortcutsPage } from "./pages/ShortcutsPage";
import { UpdatesPage } from "./pages/UpdatesPage";
import { SETTINGS_SECTIONS, type SectionId } from "./sections";
import { SETTINGS_CSS } from "./styles";
import type { SettingsProps } from "./types";

export { sampleSettings } from "./types";
export type { SettingsProps, SettingsState, SettingsPatch } from "./types";
export { SETTINGS_SECTIONS } from "./sections";
export type { SectionId } from "./sections";
export type {
  SettingsServices,
  SystemPort,
  DeviceOption,
  UpdaterControls,
  GlobalShortcutStatus,
} from "./services";

/** S24 Settings window: 200px pill nav + one page. Presentational; see `src/app/settings` for wiring. */
export function Settings(props: SettingsProps) {
  const t = useT();
  const [active, setActive] = useState<SectionId>(props.initialSection ?? "general");

  return (
    <div className="rf-set">
      <style>{SETTINGS_CSS}</style>
      <nav className="rf-set-nav" aria-label={t("settings.nav.label")}>
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="rf-set-nav-item"
            aria-current={s.id === active ? "page" : undefined}
            onClick={() => setActive(s.id)}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </nav>

      <section className="rf-set-page">
        {active === "general" && <GeneralPage {...props} />}
        {active === "recording" && <RecordingPage {...props} />}
        {active === "editor" && <EditorPage {...props} />}
        {active === "shortcuts" && <ShortcutsPage {...props} />}
        {active === "appearance" && <AppearancePage {...props} />}
        {active === "updates" && <UpdatesPage {...props} />}
        {active === "extensions" && <ExtensionsPage />}
        {active === "advanced" && <AdvancedPage {...props} />}
        {active === "about" && <AboutPage {...props} />}
      </section>
    </div>
  );
}
