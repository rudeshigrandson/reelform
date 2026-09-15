/**
 * Undo/redo key matching (ENGINEERING_SPEC §6.9). ⌘Z / Ctrl+Z undo;
 * ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo. Either modifier is accepted on every OS.
 */

export type HistoryAction = "undo" | "redo";

export function matchHistoryShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"> & {
    code?: string | undefined;
  },
): HistoryAction | null {
  if (e.altKey || !(e.metaKey || e.ctrlKey)) return null;
  let key = e.key.toLowerCase();
  // Non-Latin layouts (e.g. Cyrillic "я") report the localized character; fall
  // back to the physical key. Latin layouts (AZERTY, Dvorak) keep `key`.
  if (!/^[\x20-\x7e]$/.test(key) && e.code?.startsWith("Key")) {
    key = e.code.slice(3).toLowerCase();
  }
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) return "redo";
  return null;
}

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * True when the target has its own native text undo (text inputs, textareas,
 * contenteditable, role=textbox). Sliders/checkboxes do not, so ⌘Z still undoes
 * the document while they are focused.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") {
    return !NON_TEXT_INPUTS.has((target.getAttribute("type") ?? "text").toLowerCase());
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null
  );
}
