import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialPlaybackState, usePlaybackStore } from "./store";
import { usePlaybackShortcuts } from "./usePlaybackShortcuts";

const get = () => usePlaybackStore.getState();

function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
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
  document.body.innerHTML = "";
});

describe("usePlaybackShortcuts", () => {
  it("Space toggles play and prevents default", () => {
    renderHook(() => usePlaybackShortcuts());
    const e = press(" ");
    expect(get().isPlaying).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    press(" ");
    expect(get().isPlaying).toBe(false);
  });

  it("ignores auto-repeat Space", () => {
    renderHook(() => usePlaybackShortcuts());
    press(" ", { repeat: true });
    expect(get().isPlaying).toBe(false);
  });

  it("arrows step one frame, shift-arrows one second", () => {
    renderHook(() => usePlaybackShortcuts());
    press("ArrowRight");
    expect(get().currentMs).toBeCloseTo(5000 + 1000 / 30, 6);
    press("ArrowLeft");
    expect(get().currentMs).toBeCloseTo(5000, 6);
    press("ArrowLeft", { shiftKey: true });
    expect(get().currentMs).toBeCloseTo(4000, 6);
    press("ArrowRight", { shiftKey: true });
    expect(get().currentMs).toBeCloseTo(5000, 6);
  });

  it("Home/End skip, J/K/L shuttle", () => {
    renderHook(() => usePlaybackShortcuts());
    press("End");
    expect(get().currentMs).toBe(10_000);
    press("Home");
    expect(get().currentMs).toBe(0);
    press("L");
    expect(get().isPlaying).toBe(true);
    press("l");
    expect(get().shuttleRate).toBe(2);
    press("k");
    expect(get().isPlaying).toBe(false);
    get().seek(3000);
    press("j");
    expect(get().currentMs).toBe(2000);
  });

  it("is ignored inside an input and contenteditable", () => {
    renderHook(() => usePlaybackShortcuts());
    const input = document.createElement("input");
    document.body.append(input);
    const e = press(" ", {}, input);
    expect(get().isPlaying).toBe(false);
    expect(e.defaultPrevented).toBe(false);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);
    document.body.append(editable);
    press(" ", {}, child);
    expect(get().isPlaying).toBe(false);

    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    document.body.append(slider);
    press("ArrowRight", {}, slider);
    expect(get().currentMs).toBe(5000);
  });

  it("is ignored with meta or ctrl held", () => {
    renderHook(() => usePlaybackShortcuts());
    const e = press("s", { metaKey: true });
    press(" ", { ctrlKey: true });
    expect(get().isPlaying).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it("s and Delete/Backspace call the callbacks", () => {
    const onSplit = vi.fn();
    const onDelete = vi.fn();
    renderHook(() => usePlaybackShortcuts({ onSplit, onDelete }));
    expect(press("s").defaultPrevented).toBe(true);
    press("Delete");
    press("Backspace");
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it("does not prevent split/delete when no callback is provided", () => {
    renderHook(() => usePlaybackShortcuts());
    expect(press("s").defaultPrevented).toBe(false);
    expect(press("Backspace").defaultPrevented).toBe(false);
  });

  it("leaves unhandled keys alone", () => {
    renderHook(() => usePlaybackShortcuts());
    expect(press("q").defaultPrevented).toBe(false);
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(press("Home", { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("detaches on unmount and honours a custom target", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { unmount } = renderHook(() => usePlaybackShortcuts({ target: host }));
    press(" ", {}, document.body);
    expect(get().isPlaying).toBe(false);
    press(" ", {}, host);
    expect(get().isPlaying).toBe(true);
    unmount();
    press(" ", {}, host);
    expect(get().isPlaying).toBe(true);
  });
});
