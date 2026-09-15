import type { HudPhase } from "../../hud/types";

/**
 * Global shortcuts in the HUD window (SPEC §5.6). Main registers them with the
 * OS and broadcasts `shortcuts:triggered` `{ id }` to every window; the HUD maps
 * them onto its own session actions.
 */

/** Main → renderer broadcast (electron/main.ts); not a typed contract event. */
export const SHORTCUTS_TRIGGERED_EVENT = "shortcuts:triggered";

export type HudShortcutAction = "start" | "stop" | "pauseToggle" | "discard";

/** Live pill phase, `prerecord` for the S05 pill, null when neither is shown. */
export type HudShortcutPhase = HudPhase | "prerecord" | null;

export function hudShortcutAction(id: string, phase: HudShortcutPhase): HudShortcutAction | null {
  switch (id) {
    case "record.toggle":
      if (phase === "recording" || phase === "paused") return "stop";
      return phase === "prerecord" ? "start" : null;
    case "record.pause":
      return phase === "recording" || phase === "paused" ? "pauseToggle" : null;
    case "record.cancelCountdown":
      return phase === "countdown" ? "discard" : null;
    default:
      return null;
  }
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "submit",
  "reset",
  "image",
]);

/** Focus is in a text field: shortcuts are ignored so typing never stops a recording. */
export function isTypingTarget(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || "text").toLowerCase());
  }
  return (el as HTMLElement).isContentEditable === true;
}

export type ShortcutSubscribe = (listener: (id: string) => void) => () => void;

/** `window.reelform.on("shortcuts:triggered")`; a no-op outside Electron. */
export const bridgeShortcutSubscribe: ShortcutSubscribe = (listener) => {
  if (typeof window === "undefined" || !window.reelform) return () => {};
  return window.reelform.on(SHORTCUTS_TRIGGERED_EVENT, (payload) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string") listener(id);
  });
};
