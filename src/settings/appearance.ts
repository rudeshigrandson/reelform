import type { MessageKey } from "../i18n";
import type { AccentColor } from "./types";

/**
 * The six user-selectable accent colours (S24 Appearance). These are palette
 * *data* the user picks from — applied at runtime as `--accent*` overrides by
 * `src/app/settings/appearance.ts` — not ad-hoc styling. `indigo` is the
 * theme's built-in accent, so it applies no override.
 */
export interface AccentSwatch {
  id: AccentColor;
  /** English name (non-UI callers); the Appearance page shows `labelKey`. */
  label: string;
  labelKey: MessageKey;
  /** null = keep the theme's own `--accent`. */
  color: string | null;
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { id: "indigo", label: "Indigo", labelKey: "settings.appearance.accent.indigo", color: null },
  {
    id: "blue",
    label: "Blue",
    labelKey: "settings.appearance.accent.blue",
    color: "oklch(0.64 0.16 250)",
  },
  {
    id: "violet",
    label: "Violet",
    labelKey: "settings.appearance.accent.violet",
    color: "oklch(0.6 0.19 295)",
  },
  {
    id: "pink",
    label: "Pink",
    labelKey: "settings.appearance.accent.pink",
    color: "oklch(0.66 0.2 355)",
  },
  {
    id: "orange",
    label: "Orange",
    labelKey: "settings.appearance.accent.orange",
    color: "oklch(0.7 0.17 50)",
  },
  {
    id: "green",
    label: "Green",
    labelKey: "settings.appearance.accent.green",
    color: "oklch(0.66 0.15 150)",
  },
];

export function accentSwatch(id: AccentColor): AccentSwatch {
  return ACCENT_SWATCHES.find((s) => s.id === id) ?? (ACCENT_SWATCHES[0] as AccentSwatch);
}
