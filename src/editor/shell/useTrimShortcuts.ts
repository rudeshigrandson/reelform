import { useEffect, useRef } from "react";
import { isEditableTarget } from "../playback";

export interface TrimShortcutsOptions {
  /** `[`: trim the clip under the playhead to start at the playhead. */
  onTrimStart?: (() => void) | undefined;
  /** `]`: trim the clip under the playhead to end at the playhead. */
  onTrimEnd?: (() => void) | undefined;
  /** Where to listen. Defaults to `window`; `null` disables. */
  target?: Window | HTMLElement | null | undefined;
  enabled?: boolean | undefined;
}

/**
 * `[` / `]` trim-to-playhead (guide §5, SPEC §6.7). Ignored while typing and
 * with ⌘/Ctrl/Alt held; only handled keys are `preventDefault`ed.
 */
export function useTrimShortcuts(options: TrimShortcutsOptions): void {
  const { enabled = true } = options;
  const target =
    options.target === undefined ? (typeof window === "undefined" ? null : window) : options.target;
  const callbacks = useRef(options);
  callbacks.current = options;

  useEffect(() => {
    if (!enabled || !target) return;
    const onKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const fn =
        event.key === "["
          ? callbacks.current.onTrimStart
          : event.key === "]"
            ? callbacks.current.onTrimEnd
            : undefined;
      if (!fn) return;
      event.preventDefault();
      if (!event.repeat) fn();
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [enabled, target]);
}
