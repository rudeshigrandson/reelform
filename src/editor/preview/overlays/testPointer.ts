import { act } from "@testing-library/react";

/**
 * Dispatch a pointer-typed MouseEvent (jsdom lacks PointerEvent; React maps
 * native `pointer*` events by type, so clientX/Y and modifiers come through).
 */
export function pointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  opts: { shiftKey?: boolean } = {},
): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        shiftKey: opts.shiftKey ?? false,
      }),
    );
  });
}

/** Press at (x0,y0), move to (x1,y1), release. */
export function drag(
  el: Element,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  opts: { shiftKey?: boolean } = {},
): void {
  pointer(el, "pointerdown", x0, y0, opts);
  pointer(el, "pointermove", x1, y1, opts);
  pointer(el, "pointerup", x1, y1, opts);
}
