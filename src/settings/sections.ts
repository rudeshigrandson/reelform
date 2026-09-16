import type { MessageKey } from "../i18n";

/** Settings window pages, in S24 nav order. */
export const SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.section.general" },
  { id: "recording", labelKey: "settings.section.recording" },
  { id: "editor", labelKey: "settings.section.editor" },
  { id: "shortcuts", labelKey: "settings.section.shortcuts" },
  { id: "appearance", labelKey: "settings.section.appearance" },
  { id: "updates", labelKey: "settings.section.updates" },
  { id: "extensions", labelKey: "settings.section.extensions" },
  { id: "advanced", labelKey: "settings.section.advanced" },
  { id: "about", labelKey: "settings.section.about" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
