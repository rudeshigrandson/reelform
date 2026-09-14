/**
 * Playback shortcut registry (design guide §5, ENGINEERING_SPEC §6.9).
 * Declarative so the bar tooltips and a future settings/overrides UI can read
 * the same table the key handler uses.
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
  /** Returns false when the shortcut is unavailable (event left untouched). */
  action: (a: PlaybackShortcutActions) => boolean | undefined;
}

const run = (fn: (() => void) | undefined): boolean => {
  if (!fn) return false;
  fn();
  return true;
};

export const PLAYBACK_SHORTCUTS: readonly PlaybackShortcut[] = [
  { id: "play-pause", key: " ", label: "Space", action: (a) => void a.toggle() },
  {
    id: "frame-back",
    key: "ArrowLeft",
    repeat: true,
    label: "←",
    action: (a) => void a.stepFrame(-1),
  },
  {
    id: "frame-forward",
    key: "ArrowRight",
    repeat: true,
    label: "→",
    action: (a) => void a.stepFrame(1),
  },
  {
    id: "second-back",
    key: "ArrowLeft",
    shift: true,
    repeat: true,
    label: "Shift+←",
    action: (a) => void a.stepSecond(-1),
  },
  {
    id: "second-forward",
    key: "ArrowRight",
    shift: true,
    repeat: true,
    label: "Shift+→",
    action: (a) => void a.stepSecond(1),
  },
  { id: "skip-start", key: "Home", label: "Home", action: (a) => void a.skipToStart() },
  { id: "skip-end", key: "End", label: "End", action: (a) => void a.skipToEnd() },
  { id: "shuttle-back", key: "j", label: "J", action: (a) => void a.shuttleBack() },
  { id: "shuttle-stop", key: "k", label: "K", action: (a) => void a.shuttleStop() },
  { id: "shuttle-forward", key: "l", label: "L", action: (a) => void a.shuttleForward() },
  { id: "split", key: "s", label: "S", action: (a) => run(a.onSplit) },
  { id: "delete", key: "Delete", label: "Delete", action: (a) => run(a.onDelete) },
  { id: "delete-backspace", key: "Backspace", label: "Backspace", action: (a) => run(a.onDelete) },
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
