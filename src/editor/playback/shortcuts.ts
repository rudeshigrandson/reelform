import {
  type Accelerator,
  type KeyEventLike,
  type ShortcutPlatform,
  acceleratorFromEvent,
  acceleratorsEqual,
} from "../../shortcuts/accelerator";
import { type ShortcutOverrides, resolveShortcuts } from "../../shortcuts/registry";

/**
 * Playback shortcut table (design guide §5, ENGINEERING_SPEC §6.9). Each entry
 * names its central registry id (`src/shortcuts/registry.ts`); the literal
 * `key` is the registry default, used for tooltips and the standalone matcher.
 * Inside a `ShortcutsProvider` the provider dispatches these ids instead, so a
 * key never fires twice and user overrides apply.
 */

export interface PlaybackShortcutActions {
  toggle: () => void;
  stepFrame: (n: number) => void;
  stepSecond: (n: number) => void;
  skipToStart: () => void;
  skipToEnd: () => void;
  shuttleBack: () => void;
  shuttleStop: () => void;
  shuttleForward: () => void;
  onSplit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

export interface PlaybackShortcut {
  id: string;
  /** Compared against `KeyboardEvent.key` (letters case-insensitively). */
  key: string;
  /** Shift must be held (true) — otherwise shift must be up. */
  shift?: boolean | undefined;
  /** Fire on auto-repeat keydowns (held key). */
  repeat?: boolean | undefined;
  label: string;
  /** Central registry ids this entry is bound to (user overrides replace `key`). */
  registryIds?: readonly string[] | undefined;
  /** Returns false when the shortcut is unavailable (event left untouched). */
  action: (a: PlaybackShortcutActions) => boolean | undefined;
}

const run = (fn: (() => void) | undefined): boolean => {
  if (!fn) return false;
  fn();
  return true;
};

export const PLAYBACK_SHORTCUTS: readonly PlaybackShortcut[] = [
  {
    id: "play-pause",
    key: " ",
    label: "Space",
    registryIds: ["editor.playPause"],
    action: (a) => void a.toggle(),
  },
  {
    id: "frame-back",
    key: "ArrowLeft",
    repeat: true,
    label: "←",
    registryIds: ["editor.frameBack"],
    action: (a) => void a.stepFrame(-1),
  },
  {
    id: "frame-forward",
    key: "ArrowRight",
    repeat: true,
    label: "→",
    registryIds: ["editor.frameForward"],
    action: (a) => void a.stepFrame(1),
  },
  {
    id: "second-back",
    key: "ArrowLeft",
    shift: true,
    repeat: true,
    label: "Shift+←",
    registryIds: ["editor.secondBack"],
    action: (a) => void a.stepSecond(-1),
  },
  {
    id: "second-forward",
    key: "ArrowRight",
    shift: true,
    repeat: true,
    label: "Shift+→",
    registryIds: ["editor.secondForward"],
    action: (a) => void a.stepSecond(1),
  },
  {
    id: "skip-start",
    key: "Home",
    label: "Home",
    registryIds: ["editor.skipStart"],
    action: (a) => void a.skipToStart(),
  },
  {
    id: "skip-end",
    key: "End",
    label: "End",
    registryIds: ["editor.skipEnd"],
    action: (a) => void a.skipToEnd(),
  },
  {
    id: "shuttle-back",
    key: "j",
    label: "J",
    registryIds: ["editor.shuttleBack"],
    action: (a) => void a.shuttleBack(),
  },
  {
    id: "shuttle-stop",
    key: "k",
    label: "K",
    registryIds: ["editor.shuttleStop"],
    action: (a) => void a.shuttleStop(),
  },
  {
    id: "shuttle-forward",
    key: "l",
    label: "L",
    registryIds: ["editor.shuttleForward"],
    action: (a) => void a.shuttleForward(),
  },
  {
    id: "split",
    key: "s",
    label: "S",
    registryIds: ["timeline.split"],
    action: (a) => run(a.onSplit),
  },
  {
    id: "delete",
    key: "Delete",
    label: "Delete",
    registryIds: ["timeline.delete", "canvas.delete"],
    action: (a) => run(a.onDelete),
  },
  {
    id: "delete-backspace",
    key: "Backspace",
    label: "Backspace",
    registryIds: ["timeline.delete", "canvas.delete"],
    action: (a) => run(a.onDelete),
  },
];

/** Shortcut label by id, for tooltips ("Play (Space)"). */
export function shortcutLabel(id: string): string {
  return PLAYBACK_SHORTCUTS.find((s) => s.id === id)?.label ?? "";
}

const normalizeKey = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

export function matchShortcut(
  e: Pick<KeyboardEvent, "key" | "shiftKey">,
  shortcuts: readonly PlaybackShortcut[] = PLAYBACK_SHORTCUTS,
): PlaybackShortcut | undefined {
  const key = normalizeKey(e.key);
  return shortcuts.find((s) => normalizeKey(s.key) === key && (s.shift ?? false) === e.shiftKey);
}

/** Accelerator for a keydown; tolerates synthetic events without `code`. */
export function eventAccelerator(e: KeyEventLike): Accelerator | null {
  // Copy explicitly: KeyboardEvent fields are prototype getters a spread would drop.
  const acc = acceleratorFromEvent({
    key: e.key,
    code: e.code ?? "",
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
  });
  if (acc) return acc;
  if (e.key === " ") {
    return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: "Space" };
  }
  return null;
}

const literalAccelerator = (s: PlaybackShortcut): Accelerator | null =>
  eventAccelerator({
    key: s.key,
    code: s.key === " " ? "Space" : "",
    shiftKey: s.shift ?? false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });

export interface BoundPlaybackShortcut {
  shortcut: PlaybackShortcut;
  accelerators: readonly Accelerator[];
}

/**
 * Keys for each playback shortcut after user overrides: an entry bound to a
 * registry id that the user rebound/unbound follows the registry; otherwise its
 * literal default key is kept (so Delete *and* Backspace both delete).
 */
export function bindPlaybackShortcuts(
  shortcuts: readonly PlaybackShortcut[],
  platform: ShortcutPlatform,
  overrides: ShortcutOverrides = {},
): BoundPlaybackShortcut[] {
  const resolved = resolveShortcuts(platform, overrides);
  const seen = new Set<string>();
  const out: BoundPlaybackShortcut[] = [];
  for (const shortcut of shortcuts) {
    const primary = shortcut.registryIds?.[0];
    const r = primary ? resolved.find((x) => x.id === primary) : undefined;
    if (r && (r.source === "override" || r.source === "unbound")) {
      // Aliases of one registry id collapse onto the single user binding.
      if (seen.has(primary as string)) continue;
      seen.add(primary as string);
      out.push({ shortcut, accelerators: r.accelerator ? [r.accelerator] : [] });
      continue;
    }
    const literal = literalAccelerator(shortcut);
    out.push({ shortcut, accelerators: literal ? [literal] : [] });
  }
  return out;
}

export function matchBoundShortcut(
  e: KeyEventLike,
  bound: readonly BoundPlaybackShortcut[],
): PlaybackShortcut | undefined {
  const acc = eventAccelerator(e);
  if (!acc) return undefined;
  return bound.find((b) => b.accelerators.some((a) => acceleratorsEqual(a, acc)))?.shortcut;
}

/** True when the event target is a text-entry / slider control that owns keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"]',
    ) !== null
  );
}
