import shortcutsEn from "../i18n/locales/en.shortcuts.json";
import {
  type Accelerator,
  type ShortcutPlatform,
  acceleratorsEqual,
  formatAccelerator,
  parseAccelerator,
  serializeAccelerator,
} from "./accelerator";

/** Keys of the `shortcuts.*` catalog namespace (`src/i18n/locales/en.shortcuts.json`). */
export type ShortcutMessageKey = keyof typeof shortcutsEn;

/** English `shortcuts.*` messages. */
export const SHORTCUT_MESSAGES: Readonly<Record<ShortcutMessageKey, string>> = shortcutsEn;

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
  /** English label (from the catalog); main-process and fallback use. */
  label: string;
  /** Catalog key of the label (`shortcuts.label.<id>`). */
  labelKey: ShortcutMessageKey;
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

const DEFINITIONS = [
  // ---- Global (main-process globalShortcut, spec §5.6) -------------------
  {
    id: "record.toggle",
    scope: "global",
    group: "Global",
    labelKey: "shortcuts.label.record.toggle",
    default: { mac: "⇧⌘R", win: "Ctrl+Shift+R" },
  },
  {
    id: "record.pause",
    scope: "global",
    group: "Global",
    labelKey: "shortcuts.label.record.pause",
    default: { mac: "⇧⌘P", win: "Ctrl+Shift+P" },
  },
  {
    id: "record.region",
    scope: "global",
    group: "Global",
    labelKey: "shortcuts.label.record.region",
    default: { mac: "⌥⇧⌘R", win: "Ctrl+Alt+Shift+R" },
  },
  {
    id: "record.cancelCountdown",
    scope: "global",
    group: "Global",
    labelKey: "shortcuts.label.record.cancelCountdown",
    default: both("Escape"),
    countdownOnly: true,
  },
  // ---- Editor ------------------------------------------------------------
  {
    id: "editor.playPause",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.playPause",
    default: both("Space"),
  },
  {
    id: "editor.frameBack",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.frameBack",
    default: both("ArrowLeft"),
    repeat: true,
  },
  {
    id: "editor.frameForward",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.frameForward",
    default: both("ArrowRight"),
    repeat: true,
  },
  {
    id: "editor.secondBack",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.secondBack",
    default: both("Shift+ArrowLeft"),
    repeat: true,
  },
  {
    id: "editor.secondForward",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.secondForward",
    default: both("Shift+ArrowRight"),
    repeat: true,
  },
  {
    id: "editor.skipStart",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.skipStart",
    default: both("Home"),
  },
  {
    id: "editor.skipEnd",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.skipEnd",
    default: both("End"),
  },
  {
    id: "editor.shuttleBack",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.shuttleBack",
    default: both("J"),
  },
  {
    id: "editor.shuttleStop",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.shuttleStop",
    default: both("K"),
  },
  {
    id: "editor.shuttleForward",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.shuttleForward",
    default: both("L"),
  },
  {
    id: "editor.undo",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.undo",
    default: { mac: "⌘Z", win: "Ctrl+Z" },
  },
  {
    id: "editor.redo",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.redo",
    default: { mac: "⇧⌘Z", win: "Ctrl+Shift+Z" },
  },
  {
    id: "editor.save",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.save",
    default: { mac: "⌘S", win: "Ctrl+S" },
    allowInInputs: true,
  },
  {
    id: "editor.export",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.export",
    default: { mac: "⌘E", win: "Ctrl+E" },
    allowInInputs: true,
  },
  {
    id: "editor.zoomIn",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.zoomIn",
    default: { mac: "⌘=", win: "Ctrl+=" },
  },
  {
    id: "editor.zoomOut",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.zoomOut",
    default: { mac: "⌘-", win: "Ctrl+-" },
  },
  {
    id: "editor.clearSelection",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.clearSelection",
    default: both("Escape"),
  },
  {
    id: "editor.shortcutsHelp",
    scope: "editor",
    group: "Editor",
    labelKey: "shortcuts.label.editor.shortcutsHelp",
    default: { mac: "⇧/", win: "Shift+/" },
  },
  // ---- Timeline (focus inside the timeline) ------------------------------
  {
    id: "timeline.split",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.split",
    default: both("S"),
  },
  {
    id: "timeline.trimStart",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.trimStart",
    default: both("["),
  },
  {
    id: "timeline.trimEnd",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.trimEnd",
    default: both("]"),
  },
  {
    id: "timeline.nudgeBack",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.nudgeBack",
    default: both("ArrowLeft"),
    repeat: true,
  },
  {
    id: "timeline.nudgeForward",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.nudgeForward",
    default: both("ArrowRight"),
    repeat: true,
  },
  {
    id: "timeline.delete",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.delete",
    default: { mac: "⌫", win: "Delete" },
  },
  {
    id: "timeline.rippleDelete",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.rippleDelete",
    default: { mac: "⇧⌫", win: "Shift+Delete" },
  },
  {
    id: "timeline.duplicate",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.duplicate",
    default: { mac: "⌘D", win: "Ctrl+D" },
  },
  {
    id: "timeline.selectAll",
    scope: "timeline",
    group: "Timeline",
    labelKey: "shortcuts.label.timeline.selectAll",
    default: { mac: "⌘A", win: "Ctrl+A" },
  },
  // ---- Canvas (focus inside the preview canvas) --------------------------
  {
    id: "canvas.delete",
    scope: "canvas",
    group: "Editor",
    labelKey: "shortcuts.label.canvas.delete",
    default: { mac: "⌫", win: "Delete" },
  },
] as const satisfies readonly Omit<ShortcutDefinition, "label">[];

export type ShortcutId = (typeof DEFINITIONS)[number]["id"];

/**
 * The registry, with `label` filled from the English catalog. UI that follows
 * the language setting renders `labelKey` instead (`shortcutLabel` in `./i18n`).
 */
export const SHORTCUTS: readonly (ShortcutDefinition & { id: ShortcutId })[] = DEFINITIONS.map(
  (def) => ({ ...def, label: SHORTCUT_MESSAGES[def.labelKey] }),
);

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
