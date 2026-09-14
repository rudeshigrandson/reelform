import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { patchCommand } from "./command";
import { createHistory } from "./history";
import { isTextEntryTarget, matchHistoryShortcut } from "./shortcuts";
import { useHistoryShortcuts, useHistoryState } from "./useHistoryShortcuts";

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const mockHistory = () => ({ undo: vi.fn(() => true), redo: vi.fn(() => true) });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("matchHistoryShortcut", () => {
  const ev = (
    key: string,
    mods: Partial<Record<"metaKey" | "ctrlKey" | "shiftKey" | "altKey", boolean>> = {},
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("maps the standard chords", () => {
    expect(matchHistoryShortcut(ev("z", { metaKey: true }))).toBe("undo");
    expect(matchHistoryShortcut(ev("z", { ctrlKey: true }))).toBe("undo");
    expect(matchHistoryShortcut(ev("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(matchHistoryShortcut(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(matchHistoryShortcut(ev("y", { ctrlKey: true }))).toBe("redo");
  });

  it("falls back to the physical key on non-Latin layouts only", () => {
    expect(matchHistoryShortcut({ ...ev("я", { metaKey: true }), code: "KeyZ" })).toBe("undo");
    expect(
      matchHistoryShortcut({ ...ev("Я", { metaKey: true, shiftKey: true }), code: "KeyZ" }),
    ).toBe("redo");
    expect(matchHistoryShortcut({ ...ev("н", { ctrlKey: true }), code: "KeyY" })).toBe("redo");
    // AZERTY: physical KeyW produces "z" -> undo; physical KeyZ produces "w" -> nothing.
    expect(matchHistoryShortcut({ ...ev("z", { metaKey: true }), code: "KeyW" })).toBe("undo");
    expect(matchHistoryShortcut({ ...ev("w", { metaKey: true }), code: "KeyZ" })).toBeNull();
  });

  it("rejects unmodified, alt, and non-matching chords", () => {
    expect(matchHistoryShortcut(ev("z"))).toBeNull();
    expect(matchHistoryShortcut(ev("z", { shiftKey: true }))).toBeNull();
    expect(matchHistoryShortcut(ev("z", { metaKey: true, altKey: true }))).toBeNull();
    expect(matchHistoryShortcut(ev("y", { metaKey: true }))).toBeNull();
    expect(matchHistoryShortcut(ev("y", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchHistoryShortcut(ev("x", { metaKey: true }))).toBeNull();
  });
});

describe("isTextEntryTarget", () => {
  it("text inputs, textarea, contenteditable, role=textbox own their undo", () => {
    document.body.innerHTML = `
      <input id="text" /><input id="search" type="search" /><textarea id="ta"></textarea>
      <div contenteditable="true"><span id="ce">x</span></div>
      <div role="textbox" id="tb"></div>
      <input id="range" type="range" /><input id="cb" type="checkbox" />
      <div role="slider" id="slider"></div><button id="btn">b</button>`;
    const el = (id: string) => document.getElementById(id);
    expect(isTextEntryTarget(el("text"))).toBe(true);
    expect(isTextEntryTarget(el("search"))).toBe(true);
    expect(isTextEntryTarget(el("ta"))).toBe(true);
    expect(isTextEntryTarget(el("tb"))).toBe(true);
    expect(isTextEntryTarget(el("range"))).toBe(false);
    expect(isTextEntryTarget(el("cb"))).toBe(false);
    expect(isTextEntryTarget(el("slider"))).toBe(false);
    expect(isTextEntryTarget(el("btn"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(window)).toBe(false);
  });
});

describe("useHistoryShortcuts", () => {
  it("⌘Z undoes, ⇧⌘Z and Ctrl+Y redo, preventing default", () => {
    const h = mockHistory();
    renderHook(() => useHistoryShortcuts(h));
    const e1 = press("z", { metaKey: true });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(e1.defaultPrevented).toBe(true);
    press("Z", { metaKey: true, shiftKey: true });
    press("y", { ctrlKey: true });
    expect(h.redo).toHaveBeenCalledTimes(2);
  });

  it("ignores text-entry targets but not sliders", () => {
    const h = mockHistory();
    document.body.innerHTML = `<input id="i" /><div role="slider" id="s" tabindex="0"></div>`;
    renderHook(() => useHistoryShortcuts(h));
    const e = press("z", { metaKey: true }, document.getElementById("i") as HTMLElement);
    expect(h.undo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    press("z", { metaKey: true }, document.getElementById("s") as HTMLElement);
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  it("skips already-handled events and plain keys", () => {
    const h = mockHistory();
    renderHook(() => useHistoryShortcuts(h));
    const e = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    e.preventDefault();
    document.body.dispatchEvent(e);
    const plain = press("z");
    expect(h.undo).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
  });

  it("disabled / null target / null history bind nothing; unmount unbinds", () => {
    const h = mockHistory();
    const a = renderHook(() => useHistoryShortcuts(h, { enabled: false }));
    renderHook(() => useHistoryShortcuts(h, { target: null }));
    renderHook(() => useHistoryShortcuts(null));
    press("z", { metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
    a.unmount();
    const b = renderHook(() => useHistoryShortcuts(h));
    b.unmount();
    press("z", { metaKey: true });
    expect(h.undo).not.toHaveBeenCalled();
  });

  it("listens on a custom target element only", () => {
    const h = mockHistory();
    document.body.innerHTML = `<div id="root"><span id="inner"></span></div><div id="out"></div>`;
    const root = document.getElementById("root") as HTMLElement;
    renderHook(() => useHistoryShortcuts(h, { target: root }));
    press("z", { ctrlKey: true }, document.getElementById("out") as HTMLElement);
    expect(h.undo).not.toHaveBeenCalled();
    press("z", { ctrlKey: true }, document.getElementById("inner") as HTMLElement);
    expect(h.undo).toHaveBeenCalledTimes(1);
  });
});

describe("integration with a zustand store", () => {
  it("keyboard undo/redo drives the store and useHistoryState tooltips", () => {
    const store = create<{ padding: number }>(() => ({ padding: 0 }));
    let t = 0;
    const history = createHistory({
      getState: store.getState,
      setState: (s) => store.setState(s, true),
      now: () => t,
    });

    function Buttons() {
      useHistoryShortcuts(history);
      const snap = useHistoryState(history);
      return (
        <div>
          <span data-testid="undo">{snap.undoLabel ?? "Undo"}</span>
          <span data-testid="redo">{snap.redoLabel ?? "Redo"}</span>
          <span data-testid="dirty">{String(snap.dirty)}</span>
        </div>
      );
    }
    render(<Buttons />);
    expect(screen.getByTestId("undo").textContent).toBe("Undo");

    act(() => {
      for (let p = 1; p <= 5; p++) {
        history.push(patchCommand("Change padding", { padding: p * 4 }, "padding-slider"));
        t += 16;
      }
    });
    expect(store.getState().padding).toBe(20);
    expect(screen.getByTestId("undo").textContent).toBe("Undo: Change padding");
    expect(screen.getByTestId("dirty").textContent).toBe("true");

    act(() => void press("z", { metaKey: true }));
    expect(store.getState().padding).toBe(0);
    expect(screen.getByTestId("undo").textContent).toBe("Undo");
    expect(screen.getByTestId("redo").textContent).toBe("Redo: Change padding");
    expect(screen.getByTestId("dirty").textContent).toBe("false");

    act(() => void press("Z", { metaKey: true, shiftKey: true }));
    expect(store.getState().padding).toBe(20);
  });
});
