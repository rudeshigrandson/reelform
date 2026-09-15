import { useEffect, useMemo, useRef } from "react";
import { useOptionalShortcutsContext } from "../../shortcuts/ShortcutsProvider";
import type { ShortcutPlatform } from "../../shortcuts/accelerator";
import type { ShortcutOverrides } from "../../shortcuts/registry";
import {
  PLAYBACK_SHORTCUTS,
  type PlaybackShortcut,
  type PlaybackShortcutActions,
  bindPlaybackShortcuts,
  isEditableTarget,
  matchBoundShortcut,
} from "./shortcuts";
import { usePlaybackStore } from "./store";

export interface PlaybackShortcutsOptions {
  /** Where to listen. Defaults to `window`; `null` disables. */
  target?: Window | HTMLElement | null | undefined;
  onSplit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  enabled?: boolean | undefined;
  shortcuts?: readonly PlaybackShortcut[] | undefined;
  /** Standalone mode only: user overrides (a provider supplies its own). */
  overrides?: ShortcutOverrides | undefined;
  /** Standalone mode only; defaults from `navigator.platform`. */
  platform?: ShortcutPlatform | undefined;
}

function detectPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "mac" : "win";
}

function playbackActions(callbacks: {
  onSplit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}): PlaybackShortcutActions {
  const s = usePlaybackStore.getState();
  return {
    toggle: s.toggle,
    stepFrame: s.stepFrame,
    stepSecond: s.stepSecond,
    skipToStart: s.skipToStart,
    skipToEnd: s.skipToEnd,
    shuttleBack: s.shuttleBack,
    shuttleStop: s.shuttleStop,
    shuttleForward: s.shuttleForward,
    onSplit: callbacks.onSplit,
    onDelete: callbacks.onDelete,
  };
}

/**
 * Binds the playback shortcuts.
 *
 * - Inside a `ShortcutsProvider` (and without a custom `target`/`shortcuts`),
 *   actions are registered with the provider by registry id: one dispatcher,
 *   focus scopes and user overrides apply, and no key fires twice.
 * - Standalone, listens for keydown on `target`. Ignored while typing (inputs,
 *   textareas, selects, contenteditable, role=slider/textbox); keys must match
 *   exactly, so meta/ctrl combos (app shortcuts) never trigger playback. Only
 *   handled keys are `preventDefault`ed.
 */
export function usePlaybackShortcuts(options: PlaybackShortcutsOptions = {}): void {
  const { enabled = true, shortcuts = PLAYBACK_SHORTCUTS } = options;
  const ctx = useOptionalShortcutsContext();
  const useProvider =
    ctx !== null && options.target === undefined && options.shortcuts === undefined;
  const target =
    options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;

  const callbacks = useRef({ onSplit: options.onSplit, onDelete: options.onDelete });
  callbacks.current = { onSplit: options.onSplit, onDelete: options.onDelete };

  const platform = options.platform ?? detectPlatform();
  const bound = useMemo(
    () => bindPlaybackShortcuts(shortcuts, platform, options.overrides),
    [shortcuts, platform, options.overrides],
  );

  // Provider mode: register each registry id once.
  const register = ctx?.register;
  useEffect(() => {
    if (!useProvider || !enabled || !register) return;
    const unregister: Array<() => void> = [];
    const done = new Set<string>();
    for (const shortcut of PLAYBACK_SHORTCUTS) {
      for (const id of shortcut.registryIds ?? []) {
        if (done.has(id)) continue;
        done.add(id);
        unregister.push(register(id, () => shortcut.action(playbackActions(callbacks.current))));
      }
    }
    return () => {
      for (const u of unregister) u();
    };
  }, [useProvider, enabled, register]);

  // Standalone mode.
  useEffect(() => {
    if (useProvider || !enabled || !target) return;
    const onKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (isEditableTarget(event.target)) return;
      const shortcut = matchBoundShortcut(event, bound);
      if (!shortcut) return;
      if (event.repeat && !shortcut.repeat) {
        event.preventDefault();
        return;
      }
      const handled = shortcut.action(playbackActions(callbacks.current));
      if (handled !== false) event.preventDefault();
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [useProvider, enabled, target, bound]);
}
