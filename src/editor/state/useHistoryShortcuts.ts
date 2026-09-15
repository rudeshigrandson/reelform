import { useEffect, useSyncExternalStore } from "react";
import type { History, HistorySnapshot } from "./history";
import { isTextEntryTarget, matchHistoryShortcut } from "./shortcuts";

export interface HistoryShortcutsOptions {
  /** Where to listen. Defaults to `window`; `null` disables. */
  target?: Window | HTMLElement | null | undefined;
  enabled?: boolean | undefined;
}

/**
 * Binds ⌘/Ctrl+Z (undo), ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y (redo) to `history`.
 * Ignored while typing in text fields (they keep native text undo). Matched
 * keys are `preventDefault`ed even when the stack is empty.
 */
export function useHistoryShortcuts(
  history: Pick<History<unknown>, "undo" | "redo"> | null | undefined,
  options: HistoryShortcutsOptions = {},
): void {
  const { enabled = true } = options;
  const target =
    options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;

  useEffect(() => {
    if (!enabled || !target || !history) return;
    const onKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return;
      if (isTextEntryTarget(event.target)) return;
      const action = matchHistoryShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (action === "undo") history.undo();
      else history.redo();
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [enabled, target, history]);
}

/** Re-renders on history changes; for undo/redo button state and tooltips. */
export function useHistoryState(
  history: Pick<History<unknown>, "subscribe" | "getSnapshot">,
): HistorySnapshot {
  return useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
}
