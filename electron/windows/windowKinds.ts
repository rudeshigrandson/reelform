/**
 * Window kinds of the multi-window model (ENGINEERING_SPEC §2).
 *
 * The renderer router (`src/router/`) keeps its own copy of this list (the
 * renderer may not import from `electron/`); a test asserts both stay equal.
 */
export const WINDOW_KINDS = [
  "launcher",
  "editor",
  "settings",
  "hud",
  "region-overlay",
  "countdown",
  "webcam-bubble",
  "source-outline",
] as const;

export type WindowKind = (typeof WINDOW_KINDS)[number];

/** How many live windows of a kind may exist and what identifies each one. */
export type InstancePolicy = "single" | "per-project" | "per-display";

export const INSTANCE_POLICY: Record<WindowKind, InstancePolicy> = {
  launcher: "single",
  editor: "per-project",
  settings: "single",
  hud: "single",
  "region-overlay": "per-display",
  countdown: "single",
  "webcam-bubble": "single",
  "source-outline": "per-display",
};

/**
 * Kinds excluded from screen capture via `setContentProtection(true)`.
 * Spec names HUD and webcam bubble; the overlays (region selector, source
 * outline, countdown) are protected too so they never bleed into a recording.
 */
export const CONTENT_PROTECTED: Record<WindowKind, boolean> = {
  launcher: false,
  editor: false,
  settings: false,
  hud: true,
  "region-overlay": true,
  countdown: true,
  "webcam-bubble": true,
  "source-outline": true,
};

/** Query parameters that identify one window instance. */
export interface WindowParams {
  kind: WindowKind;
  projectId?: string | undefined;
  displayId?: string | undefined;
}

export function isWindowKind(v: unknown): v is WindowKind {
  return typeof v === "string" && (WINDOW_KINDS as readonly string[]).includes(v);
}

/**
 * Registry key for a window instance: one per kind for singletons, one per
 * project for editors, one per display for region / source-outline overlays.
 */
export function windowKey(params: WindowParams): string {
  switch (INSTANCE_POLICY[params.kind]) {
    case "per-project":
      return `${params.kind}:${params.projectId ?? ""}`;
    case "per-display":
      return `${params.kind}:${params.displayId ?? ""}`;
    default:
      return params.kind;
  }
}
