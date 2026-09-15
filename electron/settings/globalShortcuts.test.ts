import { describe, expect, it, vi } from "vitest";
import {
  type GlobalShortcutApi,
  createGlobalShortcutManager,
  routeGlobalShortcut,
  shortcutContextForRecordingEvent,
} from "./globalShortcuts";

describe("shortcutContextForRecordingEvent", () => {
  it("maps session phases to context patches", () => {
    expect(shortcutContextForRecordingEvent("countdown")).toEqual({ countdown: true });
    for (const t of ["started", "resumed", "paused"]) {
      expect(shortcutContextForRecordingEvent(t)).toEqual({ recording: true, countdown: false });
    }
    for (const t of ["stopped", "interrupted", "discarded", "error"]) {
      expect(shortcutContextForRecordingEvent(t)).toEqual({ recording: false, countdown: false });
    }
    for (const t of ["stats", "diskLow", "deviceLost"]) {
      expect(shortcutContextForRecordingEvent(t)).toBeNull();
    }
  });
});

describe("routeGlobalShortcut", () => {
  it("opens the HUD for start/stop only when nothing is open or running", () => {
    const idle = { hudOpen: false, sessionActive: false };
    expect(routeGlobalShortcut("record.toggle", idle)).toBe("open-hud");
    expect(routeGlobalShortcut("record.toggle", { ...idle, hudOpen: true })).toBe("broadcast");
    expect(routeGlobalShortcut("record.toggle", { ...idle, sessionActive: true })).toBe(
      "broadcast",
    );
    expect(routeGlobalShortcut("record.pause", idle)).toBe("broadcast");
  });
});

class FakeGlobalShortcut implements GlobalShortcutApi {
  registered = new Map<string, () => void>();
  /** Accelerators owned by another app. */
  taken = new Set<string>();
  register = vi.fn((accel: string, cb: () => void) => {
    if (this.taken.has(accel) || this.registered.has(accel)) return false;
    this.registered.set(accel, cb);
    return true;
  });
  unregister = vi.fn((accel: string) => {
    this.registered.delete(accel);
  });
  press(accel: string) {
    this.registered.get(accel)?.();
  }
}

const setup = (platform: "mac" | "win" = "mac") => {
  const gs = new FakeGlobalShortcut();
  const onTrigger = vi.fn();
  const onStatus = vi.fn();
  const manager = createGlobalShortcutManager({
    globalShortcut: gs,
    platform,
    onTrigger,
    onStatus,
  });
  return { gs, onTrigger, onStatus, manager };
};

describe("createGlobalShortcutManager", () => {
  it("registers only the always-scoped start/stop key while idle (HUD closed, not recording)", () => {
    const { gs, manager, onTrigger } = setup();
    manager.setOverrides({});
    expect([...gs.registered.keys()]).toEqual(["Command+Shift+R"]);
    expect(manager.getStatus().registered).toEqual([{ id: "record.toggle", accelerator: "⇧⌘R" }]);
    gs.press("Command+Shift+R");
    expect(onTrigger).toHaveBeenCalledWith("record.toggle");
  });

  it("always scope survives context changes and follows overrides", () => {
    const { gs, manager } = setup();
    manager.setContext({ hudOpen: true });
    manager.setContext({ hudOpen: false, recording: false, countdown: false });
    expect([...gs.registered.keys()]).toEqual(["Command+Shift+R"]);
    manager.setOverrides({ "record.toggle": "Ctrl+Alt+9" });
    expect([...gs.registered.keys()]).toEqual(["Control+Alt+9"]);
    manager.setOverrides({ "record.toggle": "" });
    expect(gs.registered.size).toBe(0);
  });

  it("registers pause and region after setContext({ recording: true })", () => {
    const { gs, manager } = setup();
    manager.setOverrides({});
    expect(gs.registered.has("Command+Shift+P")).toBe(false);
    manager.setContext({ recording: true });
    expect([...gs.registered.keys()].sort()).toEqual([
      "Command+Alt+Shift+R",
      "Command+Shift+P",
      "Command+Shift+R",
    ]);
    expect(manager.getStatus().context).toEqual({
      hudOpen: false,
      recording: true,
      countdown: false,
    });
  });

  it("registers start/stop, pause and region while the HUD is open and unregisters on close", () => {
    const { gs, manager, onTrigger } = setup("mac");
    manager.setContext({ hudOpen: true });
    expect([...gs.registered.keys()].sort()).toEqual([
      "Command+Alt+Shift+R",
      "Command+Shift+P",
      "Command+Shift+R",
    ]);
    gs.press("Command+Shift+R");
    expect(onTrigger).toHaveBeenCalledWith("record.toggle");
    expect(manager.getStatus().registered).toContainEqual({
      id: "record.toggle",
      accelerator: "⇧⌘R",
    });

    manager.setContext({ hudOpen: false, recording: true });
    expect(gs.registered.size).toBe(3);
    manager.setContext({ recording: false });
    expect([...gs.registered.keys()]).toEqual(["Command+Shift+R"]);
  });

  it("uses Control on Windows/Linux", () => {
    const { gs, manager } = setup("win");
    manager.setContext({ recording: true });
    expect(gs.registered.has("Control+Shift+R")).toBe(true);
  });

  it("registers Esc only during the countdown", () => {
    const { gs, manager, onTrigger } = setup();
    manager.setContext({ hudOpen: true });
    expect(gs.registered.has("Escape")).toBe(false);
    manager.setContext({ countdown: true });
    gs.press("Escape");
    expect(onTrigger).toHaveBeenCalledWith("record.cancelCountdown");
    manager.setContext({ countdown: false });
    expect(gs.registered.has("Escape")).toBe(false);
  });

  it("re-registers when overrides change and supports unbinding", () => {
    const { gs, manager } = setup();
    manager.setContext({ hudOpen: true });
    manager.setOverrides({ "record.toggle": "Ctrl+Alt+9", "record.region": "" });
    expect(gs.unregister).toHaveBeenCalledWith("Command+Shift+R");
    expect(gs.unregister).toHaveBeenCalledWith("Command+Alt+Shift+R");
    expect([...gs.registered.keys()].sort()).toEqual(["Command+Shift+P", "Control+Alt+9"]);
  });

  it("reports keys owned by another app as os-conflict and retries later", () => {
    const { gs, manager, onStatus } = setup();
    gs.taken.add("Command+Shift+P");
    manager.setContext({ hudOpen: true });
    expect(manager.getStatus().failures).toEqual([
      { id: "record.pause", accelerator: "⇧⌘P", reason: "os-conflict" },
    ]);
    expect(onStatus).toHaveBeenCalled();
    gs.taken.clear();
    manager.setContext({ recording: true });
    expect(manager.getStatus().failures).toEqual([]);
    expect(gs.registered.has("Command+Shift+P")).toBe(true);
  });

  it("duplicate global bindings: first wins, second reported", () => {
    const { gs, manager } = setup();
    manager.setOverrides({ "record.pause": "Shift+Meta+R" });
    manager.setContext({ hudOpen: true });
    expect(manager.getStatus().failures).toEqual([
      { id: "record.pause", accelerator: "⇧⌘R", reason: "duplicate" },
    ]);
    expect(gs.registered.size).toBe(2);
  });

  it("treats a throwing register (invalid accelerator) as a failure, not a crash", () => {
    const { gs, manager } = setup();
    gs.register.mockImplementationOnce(() => {
      throw new Error("bad accelerator");
    });
    expect(() => manager.setContext({ hudOpen: true })).not.toThrow();
    expect(manager.getStatus().failures).toHaveLength(1);
  });

  it("status callback fires only on change; dispose unregisters everything", () => {
    const { gs, manager, onStatus } = setup();
    manager.setContext({ hudOpen: true });
    const calls = onStatus.mock.calls.length;
    manager.setContext({ hudOpen: true });
    expect(onStatus.mock.calls.length).toBe(calls);
    manager.dispose();
    expect(gs.registered.size).toBe(0);
    expect(manager.getStatus().registered).toEqual([]);
  });
});
