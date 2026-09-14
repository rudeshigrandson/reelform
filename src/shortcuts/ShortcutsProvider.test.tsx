import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ShortcutHandler,
  ShortcutsProvider,
  useShortcut,
  useShortcutsContext,
} from "./ShortcutsProvider";
import { isEditableTarget, scopeChainFor, shortcutScopeProps } from "./matcher";

afterEach(cleanup);

function Bind({ id, handler }: { id: string; handler: ShortcutHandler }) {
  useShortcut(id, handler);
  return null;
}

function Display({ id }: { id: string }) {
  const { displayFor } = useShortcutsContext();
  return <span data-testid={`display-${id}`}>{displayFor(id)}</span>;
}

const key = (
  target: Element | Window,
  k: string,
  code: string,
  init: Partial<KeyboardEventInit> = {},
) => fireEvent.keyDown(target, { key: k, code, bubbles: true, ...init });

describe("ShortcutsProvider", () => {
  it("dispatches editor shortcuts from the document body and prevents default", () => {
    const save = vi.fn();
    render(
      <ShortcutsProvider platform="mac">
        <Bind id="editor.save" handler={save} />
      </ShortcutsProvider>,
    );
    const notPrevented = key(document.body, "s", "KeyS", { metaKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
    // Wrong modifier on mac (Ctrl instead of ⌘) does nothing.
    key(document.body, "s", "KeyS", { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while typing in inputs, except allowInInputs ones", () => {
    const play = vi.fn();
    const save = vi.fn();
    const { getByRole } = render(
      <ShortcutsProvider platform="win">
        <Bind id="editor.playPause" handler={play} />
        <Bind id="editor.save" handler={save} />
        <input aria-label="name" />
      </ShortcutsProvider>,
    );
    const input = getByRole("textbox");
    const notPrevented = key(input, " ", "Space");
    expect(play).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
    key(input, "s", "KeyS", { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    key(document.body, " ", "Space");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("uses the focused region's scope first and falls through when a handler declines", () => {
    const nudge = vi.fn<ShortcutHandler>(() => false);
    const frame = vi.fn();
    const split = vi.fn();
    const { getByTestId } = render(
      <ShortcutsProvider platform="win">
        <Bind id="timeline.nudgeBack" handler={nudge} />
        <Bind id="editor.frameBack" handler={frame} />
        <Bind id="timeline.split" handler={split} />
        <div {...shortcutScopeProps("timeline")}>
          <button type="button" data-testid="clip">
            clip
          </button>
        </div>
      </ShortcutsProvider>,
    );
    const clip = getByTestId("clip");
    key(clip, "ArrowLeft", "ArrowLeft");
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenCalledTimes(1);

    nudge.mockImplementation(() => undefined);
    key(clip, "ArrowLeft", "ArrowLeft");
    expect(nudge).toHaveBeenCalledTimes(2);
    expect(frame).toHaveBeenCalledTimes(1);

    // Timeline-scoped split is inactive outside the timeline region.
    key(document.body, "s", "KeyS");
    expect(split).not.toHaveBeenCalled();
    key(clip, "s", "KeyS");
    expect(split).toHaveBeenCalledTimes(1);
  });

  it("applies user overrides and exposes display strings", () => {
    const exp = vi.fn();
    const { getByTestId } = render(
      <ShortcutsProvider platform="mac" overrides={{ "editor.export": "Shift+Meta+E" }}>
        <Bind id="editor.export" handler={exp} />
        <Display id="editor.export" />
      </ShortcutsProvider>,
    );
    expect(getByTestId("display-editor.export").textContent).toBe("⇧⌘E");
    key(document.body, "e", "KeyE", { metaKey: true });
    expect(exp).not.toHaveBeenCalled();
    key(document.body, "E", "KeyE", { metaKey: true, shiftKey: true });
    expect(exp).toHaveBeenCalledTimes(1);
  });

  it("suppresses auto-repeat for non-repeating shortcuts but allows repeating ones", () => {
    const play = vi.fn();
    const frame = vi.fn();
    render(
      <ShortcutsProvider platform="win">
        <Bind id="editor.playPause" handler={play} />
        <Bind id="editor.frameForward" handler={frame} />
      </ShortcutsProvider>,
    );
    key(document.body, " ", "Space", { repeat: true });
    expect(play).not.toHaveBeenCalled();
    key(document.body, "ArrowRight", "ArrowRight", { repeat: true });
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it("latest-mounted handler wins, unmount unregisters, disabled provider ignores keys", () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(
      <ShortcutsProvider platform="win">
        <Bind id="editor.undo" handler={a} />
        <Bind id="editor.undo" handler={b} />
      </ShortcutsProvider>,
    );
    key(document.body, "z", "KeyZ", { ctrlKey: true });
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    rerender(
      <ShortcutsProvider platform="win">
        <Bind id="editor.undo" handler={a} />
      </ShortcutsProvider>,
    );
    key(document.body, "z", "KeyZ", { ctrlKey: true });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    rerender(
      <ShortcutsProvider platform="win" enabled={false}>
        <Bind id="editor.undo" handler={a} />
      </ShortcutsProvider>,
    );
    key(document.body, "z", "KeyZ", { ctrlKey: true });
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("unbound shortcut never fires; already-prevented events are left alone", () => {
    const save = vi.fn();
    render(
      <ShortcutsProvider platform="win" overrides={{ "editor.save": "" }}>
        <Bind id="editor.save" handler={save} />
      </ShortcutsProvider>,
    );
    key(document.body, "s", "KeyS", { ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves events another handler already prevented alone", () => {
    const save = vi.fn();
    const { getByTestId } = render(
      <ShortcutsProvider platform="win">
        <Bind id="editor.save" handler={save} />
        <div data-testid="owner" onKeyDown={(e) => e.preventDefault()} />
      </ShortcutsProvider>,
    );
    key(getByTestId("owner"), "s", "KeyS", { ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
    key(document.body, "s", "KeyS", { ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("useShortcutsContext throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Display id="x" />)).toThrow(/ShortcutsProvider/);
    spy.mockRestore();
  });
});

describe("matcher DOM helpers", () => {
  it("isEditableTarget", () => {
    const text = document.createElement("input");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const div = document.createElement("div");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.appendChild(child);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(slider)).toBe(true);
    expect(isEditableTarget(child)).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("scopeChainFor walks nested regions, most specific first", () => {
    const outer = document.createElement("div");
    outer.setAttribute("data-shortcut-scope", "editor");
    const inner = document.createElement("div");
    inner.setAttribute("data-shortcut-scope", "canvas");
    const leaf = document.createElement("span");
    outer.appendChild(inner);
    inner.appendChild(leaf);
    expect(scopeChainFor(leaf)).toEqual(["canvas", "editor", "global"]);
    expect(scopeChainFor(null)).toEqual(["editor", "global"]);
    expect(scopeChainFor(null, "global")).toEqual(["global"]);
  });
});
