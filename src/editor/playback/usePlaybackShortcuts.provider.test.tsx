import { cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutsProvider, useShortcut } from "../../shortcuts/ShortcutsProvider";
import { shortcutScopeProps } from "../../shortcuts/matcher";
import { bindPlaybackShortcuts, matchBoundShortcut } from "./shortcuts";
import { initialPlaybackState, usePlaybackStore } from "./store";
import { usePlaybackShortcuts } from "./usePlaybackShortcuts";

const get = () => usePlaybackStore.getState();

function press(
  key: string,
  code: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
) {
  const e = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  usePlaybackStore.setState({
    ...initialPlaybackState(),
    durationMs: 10_000,
    currentMs: 5000,
    fps: 30,
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("usePlaybackShortcuts inside a ShortcutsProvider", () => {
  const wrap =
    (overrides?: Record<string, string>) =>
    ({ children }: { children?: ReactNode }) => (
      <ShortcutsProvider platform="mac" overrides={overrides}>
        {children}
      </ShortcutsProvider>
    );

  it("Space toggles exactly once (single dispatcher, no second listener)", () => {
    const spy = vi.spyOn(window, "addEventListener");
    renderHook(() => usePlaybackShortcuts(), { wrapper: wrap() });
    expect(spy.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    spy.mockRestore();
    const e = press(" ", "Space");
    expect(get().isPlaying).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    press(" ", "Space");
    expect(get().isPlaying).toBe(false);
  });

  it("a timeline nudge handler shadows frame stepping; declining falls through once", () => {
    let nudge = true;
    const onNudge = vi.fn(() => nudge);
    function Timeline() {
      useShortcut("timeline.nudgeForward", () => onNudge());
      return <div {...shortcutScopeProps("timeline")} tabIndex={-1} data-testid="tl" />;
    }
    function Editor() {
      usePlaybackShortcuts();
      return <Timeline />;
    }
    const { getByTestId } = render(
      <ShortcutsProvider platform="mac">
        <Editor />
      </ShortcutsProvider>,
    );
    const tl = getByTestId("tl");
    press("ArrowRight", "ArrowRight", {}, tl);
    expect(onNudge).toHaveBeenCalledTimes(1);
    expect(get().currentMs).toBe(5000);
    nudge = false;
    press("ArrowRight", "ArrowRight", {}, tl);
    expect(get().currentMs).toBeCloseTo(5000 + 1000 / 30, 6);
  });

  it("applies user overrides from the provider", () => {
    renderHook(() => usePlaybackShortcuts(), { wrapper: wrap({ "editor.playPause": "P" }) });
    press(" ", "Space");
    expect(get().isPlaying).toBe(false);
    press("p", "KeyP");
    expect(get().isPlaying).toBe(true);
  });

  it("split/delete follow registry focus scopes and decline without callbacks", () => {
    const onSplit = vi.fn();
    const onDelete = vi.fn();
    function Editor({ withCallbacks }: { withCallbacks: boolean }) {
      usePlaybackShortcuts(withCallbacks ? { onSplit, onDelete } : {});
      return (
        <>
          <div {...shortcutScopeProps("timeline")} data-testid="tl" />
          <div {...shortcutScopeProps("canvas")} data-testid="cv" />
        </>
      );
    }
    const { getByTestId, rerender } = render(
      <ShortcutsProvider platform="mac">
        <Editor withCallbacks={false} />
      </ShortcutsProvider>,
    );
    expect(press("s", "KeyS", {}, getByTestId("tl")).defaultPrevented).toBe(false);
    rerender(
      <ShortcutsProvider platform="mac">
        <Editor withCallbacks />
      </ShortcutsProvider>,
    );
    press("s", "KeyS", {}, getByTestId("tl"));
    press("Backspace", "Backspace", {}, getByTestId("tl"));
    press("Backspace", "Backspace", {}, getByTestId("cv"));
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it("unregisters on unmount and when disabled", () => {
    const { unmount } = renderHook(() => usePlaybackShortcuts({ enabled: true }), {
      wrapper: wrap(),
    });
    unmount();
    press(" ", "Space");
    expect(get().isPlaying).toBe(false);
  });

  it("an explicit target keeps standalone mode even inside a provider", () => {
    const host = document.createElement("div");
    document.body.append(host);
    renderHook(() => usePlaybackShortcuts({ target: host }), { wrapper: wrap() });
    press(" ", "Space", {}, document.body);
    expect(get().isPlaying).toBe(false);
    press(" ", "Space", {}, host);
    expect(get().isPlaying).toBe(true);
  });
});

describe("standalone overrides", () => {
  it("rebinding replaces the literal key; aliases collapse to one binding", () => {
    const bound = bindPlaybackShortcuts(
      [
        {
          id: "delete",
          key: "Delete",
          label: "",
          registryIds: ["timeline.delete"],
          action: () => true,
        },
        {
          id: "delete-backspace",
          key: "Backspace",
          label: "",
          registryIds: ["timeline.delete"],
          action: () => true,
        },
      ],
      "win",
      { "timeline.delete": "Ctrl+Backspace" },
    );
    expect(bound).toHaveLength(1);
    const ev = {
      key: "Backspace",
      code: "Backspace",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
    expect(matchBoundShortcut(ev, bound)?.id).toBe("delete");
    expect(matchBoundShortcut({ ...ev, ctrlKey: false }, bound)).toBeUndefined();
  });

  it("unbinding silences the key in the standalone hook", () => {
    renderHook(() =>
      usePlaybackShortcuts({ overrides: { "editor.playPause": "" }, platform: "mac" }),
    );
    expect(press(" ", "").defaultPrevented).toBe(false);
    expect(get().isPlaying).toBe(false);
    press("End", "End");
    expect(get().currentMs).toBe(10_000);
  });
});
