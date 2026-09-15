// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHORTCUTS_TRIGGERED_EVENT,
  bridgeShortcutSubscribe,
  hudShortcutAction,
  isTypingTarget,
} from "./hudShortcuts";

describe("hudShortcutAction", () => {
  it("record.toggle stops a live recording and starts from pre-record", () => {
    expect(hudShortcutAction("record.toggle", "recording")).toBe("stop");
    expect(hudShortcutAction("record.toggle", "paused")).toBe("stop");
    expect(hudShortcutAction("record.toggle", "prerecord")).toBe("start");
    for (const p of ["countdown", "finalizing", "interrupted", null] as const) {
      expect(hudShortcutAction("record.toggle", p)).toBeNull();
    }
  });

  it("record.pause toggles only while recording or paused", () => {
    expect(hudShortcutAction("record.pause", "recording")).toBe("pauseToggle");
    expect(hudShortcutAction("record.pause", "paused")).toBe("pauseToggle");
    for (const p of ["countdown", "prerecord", "finalizing", null] as const) {
      expect(hudShortcutAction("record.pause", p)).toBeNull();
    }
  });

  it("Esc (record.cancelCountdown) discards only during the countdown", () => {
    expect(hudShortcutAction("record.cancelCountdown", "countdown")).toBe("discard");
    for (const p of ["recording", "paused", "prerecord", null] as const) {
      expect(hudShortcutAction("record.cancelCountdown", p)).toBeNull();
    }
  });

  it("ignores unknown and non-HUD ids", () => {
    expect(hudShortcutAction("record.region", "recording")).toBeNull();
    expect(hudShortcutAction("editor.playPause", "recording")).toBeNull();
    expect(hudShortcutAction("", "prerecord")).toBeNull();
  });
});

describe("isTypingTarget", () => {
  const el = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild;
  };

  it("text fields count as typing; buttons, checkboxes and null do not", () => {
    expect(isTypingTarget(el("<input>"))).toBe(true);
    expect(isTypingTarget(el('<input type="search">'))).toBe(true);
    expect(isTypingTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isTypingTarget(el("<select></select>"))).toBe(true);
    expect(isTypingTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isTypingTarget(el('<input type="radio">'))).toBe(false);
    expect(isTypingTarget(el("<button></button>"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("contentEditable counts as typing", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTypingTarget(div)).toBe(true);
  });
});

describe("bridgeShortcutSubscribe", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "reelform");
  });

  it("is a no-op without the preload bridge", () => {
    const off = bridgeShortcutSubscribe(() => {});
    expect(() => off()).not.toThrow();
  });

  it("forwards string ids from shortcuts:triggered and drops malformed payloads", () => {
    let handler: ((payload: unknown) => void) | null = null;
    const off = vi.fn();
    const on = vi.fn((channel: string, cb: (payload: unknown) => void) => {
      expect(channel).toBe(SHORTCUTS_TRIGGERED_EVENT);
      handler = cb;
      return off;
    });
    Object.defineProperty(window, "reelform", {
      value: { on, invoke: vi.fn() },
      configurable: true,
    });
    const seen: string[] = [];
    const unsubscribe = bridgeShortcutSubscribe((id) => seen.push(id));
    const emit = (p: unknown) => (handler as ((payload: unknown) => void) | null)?.(p);
    emit({ id: "record.pause" });
    emit({ id: 42 });
    emit(null);
    expect(seen).toEqual(["record.pause"]);
    unsubscribe();
    expect(off).toHaveBeenCalledOnce();
  });
});
