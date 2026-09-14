import { useEffect, useRef } from "react";
import {
  PLAYBACK_SHORTCUTS,
  type PlaybackShortcut,
  isEditableTarget,
  matchShortcut,
} from "./shortcuts";
import { usePlaybackStore } from "./store";

export interface PlaybackShortcutsOptions {
  /** Where to listen. Defaults to `window`; `null` disables. */
  target?: Window | HTMLElement | null | undefined;
  onSplit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  enabled?: boolean | undefined;
  shortcuts?: readonly PlaybackShortcut[] | undefined;
}

/**
 * Binds the playback shortcuts to keydown on `target`. Ignored while typing
 * (inputs, textareas, selects, contenteditable, role=slider/textbox) and when
 * meta/ctrl is held (reserved for app shortcuts). Only handled keys are
 * `preventDefault`ed.
 */
export function usePlaybackShortcuts(options: PlaybackShortcutsOptions = {}): void {
  const { enabled = true, shortcuts = PLAYBACK_SHORTCUTS } = options;
  const target =
    options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;

  const callbacks = useRef({ onSplit: options.onSplit, onDelete: options.onDelete });
  callbacks.current = { onSplit: options.onSplit, onDelete: options.onDelete };

  useEffect(() => {
    if (!enabled || !target) return;
    const onKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (isEditableTarget(event.target)) return;
      const shortcut = matchShortcut(event, shortcuts);
      if (!shortcut) return;
      if (event.repeat && !shortcut.repeat) {
        event.preventDefault();
        return;
      }
      const s = usePlaybackStore.getState();
      const handled = shortcut.action({
        toggle: s.toggle,
        stepFrame: s.stepFrame,
        stepSecond: s.stepSecond,
        skipToStart: s.skipToStart,
        skipToEnd: s.skipToEnd,
        shuttleBack: s.shuttleBack,
        shuttleStop: s.shuttleStop,
        shuttleForward: s.shuttleForward,
        onSplit: callbacks.current.onSplit,
        onDelete: callbacks.current.onDelete,
      });
      if (handled !== false) event.preventDefault();
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [enabled, target, shortcuts]);
}
