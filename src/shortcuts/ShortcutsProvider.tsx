import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ShortcutPlatform } from "./accelerator";
import { matchKeydown, scopeChainFor } from "./matcher";
import {
  type ResolvedShortcut,
  SHORTCUTS,
  type ShortcutDefinition,
  type ShortcutOverrides,
  type ShortcutScope,
  resolveShortcuts,
} from "./registry";

/**
 * Renderer shortcut dispatch (ENGINEERING_SPEC §6.9). One window-level keydown
 * listener; the focused element's `data-shortcut-scope` ancestors decide which
 * scopes are live (most specific first). Handlers are registered by id with
 * {@link useShortcut}; a handler returning `false` declines (e.g. nudge with
 * nothing selected) and dispatch falls through to the next candidate — so
 * timeline ← nudges the selection or else steps a frame. Never fires while
 * typing in inputs unless the shortcut is `allowInInputs`.
 */

/** Return `false` to decline; anything else counts as handled. */
export type ShortcutHandler = (event: KeyboardEvent) => boolean | undefined;

export interface ShortcutsContextValue {
  platform: ShortcutPlatform;
  resolved: readonly ResolvedShortcut[];
  /** Display string for a shortcut id ("⌘E"), "" when unbound/unknown. */
  displayFor: (id: string) => string;
  /** Register a handler; returns the unregister function. */
  register: (id: string, handler: ShortcutHandler) => () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export interface ShortcutsProviderProps {
  platform: ShortcutPlatform;
  overrides?: ShortcutOverrides | undefined;
  registry?: readonly ShortcutDefinition[] | undefined;
  /** Scope when focus is outside any marked region. Default `editor`. */
  rootScope?: ShortcutScope | undefined;
  /** Where to listen. Defaults to `window`; `null` disables. */
  target?: Window | HTMLElement | null | undefined;
  enabled?: boolean | undefined;
  children?: ReactNode;
}

export function ShortcutsProvider({
  platform,
  overrides,
  registry = SHORTCUTS,
  rootScope = "editor",
  target: targetProp,
  enabled = true,
  children,
}: ShortcutsProviderProps) {
  const resolved = useMemo(
    () => resolveShortcuts(platform, overrides ?? {}, registry),
    [platform, overrides, registry],
  );
  const handlers = useRef(new Map<string, ShortcutHandler[]>());
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const target =
    targetProp === undefined ? (typeof window === "undefined" ? null : window) : targetProp;

  useEffect(() => {
    if (!enabled || !target) return;
    const onKeyDown = (event: Event): void => {
      if (!(event instanceof KeyboardEvent) || event.defaultPrevented || event.isComposing) return;
      const chain = scopeChainFor(event.target, rootScope);
      const candidates = matchKeydown(event, resolvedRef.current, chain);
      for (const candidate of candidates) {
        const list = handlers.current.get(candidate.id);
        if (!list || list.length === 0) continue;
        if (event.repeat && !candidate.def.repeat) {
          event.preventDefault();
          return;
        }
        // Most recently mounted handler first.
        for (let i = list.length - 1; i >= 0; i--) {
          const handler = list[i];
          if (handler && handler(event) !== false) {
            event.preventDefault();
            return;
          }
        }
      }
    };
    target.addEventListener("keydown", onKeyDown);
    return () => target.removeEventListener("keydown", onKeyDown);
  }, [enabled, target, rootScope]);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      platform,
      resolved,
      displayFor: (id) => resolved.find((r) => r.id === id)?.display ?? "",
      register: (id, handler) => {
        const list = handlers.current.get(id) ?? [];
        list.push(handler);
        handlers.current.set(id, list);
        return () => {
          const current = handlers.current.get(id);
          if (!current) return;
          const idx = current.lastIndexOf(handler);
          if (idx >= 0) current.splice(idx, 1);
        };
      },
    }),
    [platform, resolved],
  );

  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcutsContext(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error("useShortcutsContext must be used inside <ShortcutsProvider>");
  return ctx;
}

/**
 * Bind `handler` to shortcut `id` while mounted. The latest handler closure is
 * always used; re-registration happens only when `id`/`enabled` change.
 */
export function useShortcut(
  id: string,
  handler: ShortcutHandler,
  options: { enabled?: boolean | undefined } = {},
): void {
  const { enabled = true } = options;
  const ctx = useShortcutsContext();
  const latest = useRef(handler);
  latest.current = handler;
  const { register } = ctx;
  useEffect(() => {
    if (!enabled) return;
    return register(id, (e) => latest.current(e));
  }, [register, id, enabled]);
}
