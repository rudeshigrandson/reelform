import { type CSSProperties, useState } from "react";
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

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "200px 1fr",
  width: "100%",
  height: "100%",
  background: "var(--bg-app)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  overflow: "hidden",
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  padding: "var(--space-4)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
};

const panelStyle: CSSProperties = {
  padding: "var(--space-6)",
  overflowY: "auto",
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
    background: active ? "var(--bg-active)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-2)",
  };
}

/** S24 Settings window: left nav + one page. Presentational; see `src/app/settings` for wiring. */
export function Settings(props: SettingsProps) {
  const t = useT();
  const [active, setActive] = useState<SectionId>(props.initialSection ?? "general");

  return (
    <div style={shellStyle}>
      <nav style={navStyle} aria-label={t("settings.nav.label")}>
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            style={navItemStyle(s.id === active)}
            aria-current={s.id === active ? "page" : undefined}
            onClick={() => setActive(s.id)}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </nav>

      <section style={panelStyle}>
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
