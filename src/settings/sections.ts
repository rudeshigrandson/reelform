/** Settings window pages, in S24 nav order. */
export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "recording", label: "Recording" },
  { id: "editor", label: "Editor" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "appearance", label: "Appearance" },
  { id: "updates", label: "Updates" },
  { id: "extensions", label: "Extensions" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
] as const;

export type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
