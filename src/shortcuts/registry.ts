import {
  type Accelerator,
  type ShortcutPlatform,
  acceleratorsEqual,
  formatAccelerator,
  parseAccelerator,
  serializeAccelerator,
} from "./accelerator";

/**
 * Central shortcut registry (ENGINEERING_SPEC §6.9; design guide §5 + S24
 * Shortcuts page). Declarative: the Settings table, the "?" overlay (S25), the
 * renderer {@link ShortcutsProvider} and main's global-shortcut manager all
 * read this one table. Actions are bound at runtime by id.
 */

/**
 * `global` — registered with the OS by main (only while HUD open / recording).
 * `editor` — anywhere in an editor window. `timeline` / `canvas` — only while
 * focus is inside that region; they shadow `editor` for the same keys.
 */
export type ShortcutScope = "global" | "editor" | "timeline" | "canvas";

/** Settings table grouping (S24). */
export type ShortcutGroup = "Global" | "Editor" | "Timeline";

export interface ShortcutDefinition {
  id: string;
  scope: ShortcutScope;
  group: ShortcutGroup;
  label: string;
  /** Default accelerators in display form (any string {@link parseAccelerator} accepts). */
  default: { readonly mac: string; readonly win: string };
  /** Fire on auto-repeat keydowns (held key). */
  repeat?: boolean | undefined;
  /** Still fires when focus is in a text field (modifier combos like save/export). */
  allowInInputs?: boolean | undefined;
  /** Global only: registered only during the countdown instead of HUD/recording. */
  countdownOnly?: boolean | undefined;
}

const both = (s: string) => ({ mac: s, win: s }) as const;

export const SHORTCUTS = [
  // ---- Global (main-process globalShortcut, spec §5.6) -------------------
  {
    id: "record.toggle",
    scope: "global",
    group: "Global",
    label: "Start / stop recording",
    default: { mac: "⇧⌘R", win: "Ctrl+Shift+R" },
  },
  {
    id: "record.pause",
    scope: "global",
    group: "Global",
    label: "Pause / resume recording",
    default: { mac: "⇧⌘P", win: "Ctrl+Shift+P" },
  },
  {
    id: "record.region",
    scope: "global",
    group: "Global",
    label: "Record region",
    default: { mac: "⌥⇧⌘R", win: "Ctrl+Alt+Shift+R" },
  },
  {
    id: "record.cancelCountdown",
    scope: "global",
    group: "Global",
    label: "Cancel countdown",
    default: both("Escape"),
    countdownOnly: true,
  },
  // ---- Editor ------------------------------------------------------------
  {
    id: "editor.playPause",
    scope: "editor",
    group: "Editor",
    label: "Play / pause",
    default: both("Space"),
  },
  {
    id: "editor.frameBack",
    scope: "editor",
    group: "Editor",
    label: "Previous frame",
    default: both("ArrowLeft"),
    repeat: true,
  },
  {
    id: "editor.frameForward",
    scope: "editor",
    group: "Editor",
    label: "Next frame",
    default: both("ArrowRight"),
    repeat: true,
  },
  {
    id: "editor.secondBack",
    scope: "editor",
    group: "Editor",
    label: "Back 1 second",
    default: both("Shift+ArrowLeft"),
    repeat: true,
  },
  {
    id: "editor.secondForward",
    scope: "editor",
    group: "Editor",
    label: "Forward 1 second",
    default: both("Shift+ArrowRight"),
    repeat: true,
  },
  {
    id: "editor.skipStart",
    scope: "editor",
    group: "Editor",
    label: "Go to start",
    default: both("Home"),
  },
  {
    id: "editor.skipEnd",
    scope: "editor",
    group: "Editor",
    label: "Go to end",
    default: both("End"),
  },
  {
    id: "editor.shuttleBack",
    scope: "editor",
    group: "Editor",
    label: "Shuttle back",
    default: both("J"),
  },
  {
    id: "editor.shuttleStop",
    scope: "editor",
    group: "Editor",
    label: "Shuttle stop",
    default: both("K"),
  },
  {
    id: "editor.shuttleForward",
    scope: "editor",
    group: "Editor",
    label: "Shuttle forward",
    default: both("L"),
  },
  {
    id: "editor.undo",
    scope: "editor",
    group: "Editor",
    label: "Undo",
    default: { mac: "⌘Z", win: "Ctrl+Z" },
  },
  {
    id: "editor.redo",
    scope: "editor",
    group: "Editor",
    label: "Redo",
    default: { mac: "⇧⌘Z", win: "Ctrl+Shift+Z" },
  },
  {
    id: "editor.save",
    scope: "editor",
    group: "Editor",
    label: "Save",
    default: { mac: "⌘S", win: "Ctrl+S" },
    allowInInputs: true,
  },
  {
    id: "editor.export",
    scope: "editor",
    group: "Editor",
    label: "Export…",
    default: { mac: "⌘E", win: "Ctrl+E" },
    allowInInputs: true,
  },
  {
    id: "editor.zoomIn",
    scope: "editor",
    group: "Editor",
    label: "Zoom in",
    default: { mac: "⌘=", win: "Ctrl+=" },
  },
  {
    id: "editor.zoomOut",
    scope: "editor",
    group: "Editor",
    label: "Zoom out",
    default: { mac: "⌘-", win: "Ctrl+-" },
  },
  {
    id: "editor.clearSelection",
    scope: "editor",
    group: "Editor",
    label: "Clear selection",
    default: both("Escape"),
  },
  {
    id: "editor.shortcutsHelp",
    scope: "editor",
    group: "Editor",
    label: "Keyboard shortcuts",
    default: { mac: "⇧/", win: "Shift+/" },
  },
  // ---- Timeline (focus inside the timeline) ------------------------------
  {
    id: "timeline.split",
    scope: "timeline",
    group: "Timeline",
    label: "Split at playhead",
    default: both("S"),
  },
  {
    id: "timeline.trimStart",
    scope: "timeline",
    group: "Timeline",
    label: "Trim start to playhead",
    default: both("["),
  },
  {
    id: "timeline.trimEnd",
    scope: "timeline",
    group: "Timeline",
    label: "Trim end to playhead",
    default: both("]"),
  },
  {
    id: "timeline.nudgeBack",
    scope: "timeline",
    group: "Timeline",
    label: "Nudge −1 frame",
    default: both("ArrowLeft"),
    repeat: true,
  },
  {
    id: "timeline.nudgeForward",
    scope: "timeline",
    group: "Timeline",
    label: "Nudge +1 frame",
    default: both("ArrowRight"),
    repeat: true,
  },
  {
    id: "timeline.delete",
    scope: "timeline",
    group: "Timeline",
    label: "Delete",
    default: { mac: "⌫", win: "Delete" },
  },
  {
    id: "timeline.rippleDelete",
    scope: "timeline",
    group: "Timeline",
    label: "Ripple delete",
    default: { mac: "⇧⌫", win: "Shift+Delete" },
  },
  {
    id: "timeline.duplicate",
    scope: "timeline",
    group: "Timeline",
    label: "Duplicate",
    default: { mac: "⌘D", win: "Ctrl+D" },
  },
  {
    id: "timeline.selectAll",
    scope: "timeline",
    group: "Timeline",
    label: "Select all on track",
    default: { mac: "⌘A", win: "Ctrl+A" },
  },
  // ---- Canvas (focus inside the preview canvas) --------------------------
  {
    id: "canvas.delete",
    scope: "canvas",
    group: "Editor",
    label: "Delete selected annotation",
    default: { mac: "⌫", win: "Delete" },
  },
] as const satisfies readonly ShortcutDefinition[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

/** Ids of `global`-scope shortcuts (what main registers with the OS). */
export const GLOBAL_SHORTCUT_IDS = SHORTCUTS.filter((s) => s.scope === "global").map(
  (s) => s.id,
) as readonly ShortcutId[];

/**
 * User overrides as persisted in settings: id → canonical accelerator string
 * ({@link serializeAccelerator}); `""` means "unbound". Missing id = default.
 */
export type ShortcutOverrides = Readonly<Record<string, string>>;

export type ShortcutSource = "default" | "override" | "unbound" | "invalid-override";

export interface ResolvedShortcut {
  def: ShortcutDefinition;
  id: string;
  scope: ShortcutScope;
  /** null when unbound. */
  accelerator: Accelerator | null;
  /** Platform display string ("" when unbound). */
  display: string;
  source: ShortcutSource;
}

export function defaultAccelerator(
  def: ShortcutDefinition,
  platform: ShortcutPlatform,
): Accelerator | null {
  return parseAccelerator(def.default[platform], platform);
}

/**
 * Merge user overrides over the registry defaults. Invalid override strings
 * fall back to the default (source `invalid-override`) rather than silently
 * unbinding; unknown override ids are ignored.
 */
export function resolveShortcuts(
  platform: ShortcutPlatform,
  overrides: ShortcutOverrides = {},
  registry: readonly ShortcutDefinition[] = SHORTCUTS,
): ResolvedShortcut[] {
  return registry.map((def) => {
    const fallback = defaultAccelerator(def, platform);
    const raw = Object.hasOwn(overrides, def.id) ? overrides[def.id] : undefined;
    let accelerator = fallback;
    let source: ShortcutSource = "default";
    if (raw !== undefined) {
      if (raw === "") {
        accelerator = null;
        source = "unbound";
      } else {
        const parsed = parseAccelerator(raw, platform);
        if (parsed) {
          accelerator = parsed;
          source = "override";
        } else {
          source = "invalid-override";
        }
      }
    }
    return {
      def,
      id: def.id,
      scope: def.scope,
      accelerator,
      display: accelerator ? formatAccelerator(accelerator, platform) : "",
      source,
    };
  });
}

/**
 * Set (or with `null`, unbind) one shortcut. Setting it back to the default
 * removes the override so future default changes apply. Returns a new object.
 */
export function setShortcutOverride(
  overrides: ShortcutOverrides,
  def: ShortcutDefinition,
  accelerator: Accelerator | null,
  platform: ShortcutPlatform,
): Record<string, string> {
  const next: Record<string, string> = { ...overrides };
  const fallback = defaultAccelerator(def, platform);
  if (accelerator && fallback && acceleratorsEqual(accelerator, fallback)) {
    delete next[def.id];
  } else {
    next[def.id] = accelerator ? serializeAccelerator(accelerator) : "";
  }
  return next;
}

/** Remove the override for one id (the S24 "Reset" column). */
export function resetShortcutOverride(
  overrides: ShortcutOverrides,
  id: string,
): Record<string, string> {
  const next: Record<string, string> = { ...overrides };
  delete next[id];
  return next;
}

export function findShortcut(
  id: string,
  registry: readonly ShortcutDefinition[] = SHORTCUTS,
): ShortcutDefinition | undefined {
  return registry.find((s) => s.id === id);
}
