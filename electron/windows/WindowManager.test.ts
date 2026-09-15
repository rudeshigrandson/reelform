import {
  type DisplayInfo,
  type ManagedWindow,
  type ScreenApi,
  WindowManager,
} from "./WindowManager";
import { createWindowsHandlers } from "./contracts";
import { createMemoryHudPositionStore, resolveHudPosition, saveHudPosition } from "./hudPosition";
import { type Rect, type WindowOptions, defaultHudPosition } from "./windowOptions";

type Listener = () => void;

class FakeWindow implements ManagedWindow {
  static created: FakeWindow[] = [];
  destroyed = false;
  minimized = false;
  bounds: Rect;
  calls: string[] = [];
  loaded: { url?: string; file?: string; query?: Record<string, string> } = {};
  ignoreMouse: { ignore: boolean; forward?: boolean | undefined } | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly options: WindowOptions) {
    this.bounds = {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width,
      height: options.height,
    };
    FakeWindow.created.push(this);
  }
  loadURL(url: string) {
    this.loaded.url = url;
    return Promise.resolve();
  }
  loadFile(file: string, o: { query: Record<string, string> }) {
    this.loaded = { file, query: o.query };
    return Promise.resolve();
  }
  show() {
    this.calls.push("show");
  }
  showInactive() {
    this.calls.push("showInactive");
  }
  focus() {
    this.calls.push("focus");
  }
  restore() {
    this.minimized = false;
    this.calls.push("restore");
  }
  close() {
    if (this.destroyed) return;
    this.emit("close");
    this.destroyed = true;
    this.emit("closed");
  }
  isMinimized() {
    return this.minimized;
  }
  isDestroyed() {
    return this.destroyed;
  }
  getBounds() {
    return this.bounds;
  }
  setBounds(b: Rect) {
    this.bounds = { ...b };
    this.calls.push(`setBounds:${b.x},${b.y},${b.width}x${b.height}`);
  }
  once(event: string, l: Listener) {
    this.on(event, l);
  }
  on(event: string, l: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), l]);
  }
  emit(event: string) {
    for (const l of this.listeners.get(event) ?? []) l();
  }
  setAlwaysOnTop(flag: boolean, level?: string) {
    this.calls.push(`alwaysOnTop:${flag}:${level}`);
  }
  setVisibleOnAllWorkspaces(v: boolean) {
    this.calls.push(`allWorkspaces:${v}`);
  }
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }) {
    this.ignoreMouse = { ignore, forward: options?.forward };
  }
}

const displays: DisplayInfo[] = [
  {
    id: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
  },
  {
    id: 2,
    bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1440, y: 0, width: 1920, height: 1040 },
  },
];

const screen: ScreenApi = {
  getAllDisplays: () => displays,
  // biome-ignore lint/style/noNonNullAssertion: fixture has two displays
  getPrimaryDisplay: () => displays[0]!,
  // biome-ignore lint/style/noNonNullAssertion: fixture has two displays
  getDisplayMatching: (r) => (r.x >= 1440 ? displays[1]! : displays[0]!),
};

function setup(
  loadSource: ConstructorParameters<typeof WindowManager>[0]["loadSource"] = {
    type: "dev",
    devServerUrl: "http://localhost:5173",
  },
  onHudVisibilityChange?: (open: boolean) => void,
) {
  FakeWindow.created = [];
  const protectedWins: ManagedWindow[] = [];
  const hudPositions = createMemoryHudPositionStore();
  const manager = new WindowManager({
    BrowserWindow: FakeWindow,
    screen,
    setContentProtection: (w, on) => {
      if (on) protectedWins.push(w);
    },
    preloadPath: "/preload.cjs",
    loadSource,
    hudPositions,
    onHudVisibilityChange,
  });
  return { manager, protectedWins, hudPositions };
}

describe("WindowManager registry", () => {
  it("reuses and focuses an existing singleton instead of creating a second", () => {
    const { manager } = setup();
    const a = manager.openSettings() as FakeWindow;
    a.minimized = true;
    const b = manager.openSettings();
    expect(b).toBe(a);
    expect(FakeWindow.created).toHaveLength(1);
    expect(a.calls).toEqual(expect.arrayContaining(["restore", "focus"]));
  });

  it("keeps one editor per project and focuses the existing one", () => {
    const { manager } = setup();
    const p1 = manager.openEditor("p1");
    const p2 = manager.openEditor("p2");
    expect(p1).not.toBe(p2);
    expect(manager.openEditor("p1")).toBe(p1);
    expect(FakeWindow.created).toHaveLength(2);
    expect(manager.keys().sort()).toEqual(["editor:p1", "editor:p2"]);
    expect((p1 as FakeWindow).loaded.url).toBe("http://localhost:5173/?window=editor&projectId=p1");
  });

  it("rejects an empty projectId", () => {
    const { manager } = setup();
    expect(() => manager.openEditor("")).toThrow();
  });

  it("recreates a window after it was closed", () => {
    const { manager } = setup();
    const first = manager.openLauncher();
    first.close();
    expect(manager.get({ kind: "launcher" })).toBeUndefined();
    const second = manager.openLauncher();
    expect(second).not.toBe(first);
    expect(FakeWindow.created).toHaveLength(2);
  });

  it("ignores a destroyed window still in the registry", () => {
    const { manager } = setup();
    const w = manager.openLauncher() as FakeWindow;
    w.destroyed = true; // destroyed without a closed event
    expect(manager.openLauncher()).not.toBe(w);
  });

  it("loads from file with query in production", () => {
    const { manager } = setup({ type: "file", indexHtmlPath: "/app/index.html" });
    const w = manager.openEditor("p9") as FakeWindow;
    expect(w.loaded).toEqual({
      file: "/app/index.html",
      query: { window: "editor", projectId: "p9" },
    });
  });

  it("shows the window on ready-to-show", () => {
    const { manager } = setup();
    const w = manager.openLauncher() as FakeWindow;
    expect(w.calls).not.toContain("show");
    w.emit("ready-to-show");
    expect(w.calls).toContain("show");
  });
});

describe("WindowManager overlays", () => {
  it("content-protects HUD, overlays, countdown and bubble but not launcher/editor/settings", () => {
    const { manager, protectedWins } = setup();
    manager.openLauncher();
    manager.openEditor("p");
    manager.openSettings();
    expect(protectedWins).toHaveLength(0);
    const hud = manager.openHud();
    const bubble = manager.openWebcamBubble();
    const countdown = manager.openCountdown();
    const overlays = manager.openRegionOverlays();
    expect(protectedWins).toEqual([hud, bubble, countdown, ...overlays]);
    expect((hud as FakeWindow).calls).toEqual(
      expect.arrayContaining(["alwaysOnTop:true:screen-saver", "allWorkspaces:true"]),
    );
  });

  it("opens one click-through region overlay per display and toggles selection", () => {
    const { manager } = setup();
    const overlays = manager.openRegionOverlays() as FakeWindow[];
    expect(overlays).toHaveLength(2);
    expect(overlays[1]?.options).toMatchObject(displays[1]?.bounds ?? {});
    expect(overlays[0]?.ignoreMouse).toEqual({ ignore: true, forward: true });
    manager.setRegionSelecting("1", true);
    expect(overlays[0]?.ignoreMouse?.ignore).toBe(false);
    manager.setRegionSelecting("1", false);
    expect(overlays[0]?.ignoreMouse).toEqual({ ignore: true, forward: true });
    expect(manager.openRegionOverlays()).toEqual(overlays);
    manager.closeRegionOverlays();
    expect(manager.keys()).toEqual([]);
    expect(() => manager.setRegionSelecting("1", true)).not.toThrow();
  });

  it("centers the countdown on the requested display", () => {
    const { manager } = setup();
    const w = manager.openCountdown("2") as FakeWindow;
    expect(w.options.x).toBe(1440 + (1920 - 240) / 2);
    expect((w as FakeWindow).loaded.url).toContain("displayId=2");
  });

  it("refocuses the HUD on the same display but recreates it on another display", () => {
    const { manager } = setup();
    const onOne = manager.openHud("1") as FakeWindow;
    expect(manager.openHud("1")).toBe(onOne);
    expect(FakeWindow.created).toHaveLength(1);
    const onTwo = manager.openHud("2") as FakeWindow;
    expect(onTwo).not.toBe(onOne);
    expect(onOne.destroyed).toBe(true);
    expect(onTwo.options.x).toBeGreaterThanOrEqual(1440);
    expect(onTwo.loaded.url).toContain("displayId=2");
    expect(manager.get({ kind: "hud" })).toBe(onTwo);
    expect(manager.keys()).toEqual(["hud"]);
  });

  it("moves the countdown to the newly requested display", () => {
    const { manager } = setup();
    const a = manager.openCountdown("1") as FakeWindow;
    const b = manager.openCountdown("2") as FakeWindow;
    expect(b).not.toBe(a);
    expect(a.destroyed).toBe(true);
    expect(b.options.x).toBe(1440 + (1920 - 240) / 2);
  });

  it("closeKind closes every window of that kind only", () => {
    const { manager } = setup();
    manager.openEditor("a");
    manager.openEditor("b");
    manager.openSettings();
    manager.closeKind("editor");
    expect(manager.keys()).toEqual(["settings"]);
    expect(FakeWindow.created.filter((w) => w.destroyed)).toHaveLength(2);
  });

  it("falls back to the primary display for an unknown displayId", () => {
    const { manager } = setup();
    const w = manager.openHud("99") as FakeWindow;
    expect(w.options).toMatchObject(
      defaultHudPosition(displays[0]?.workArea ?? { x: 0, y: 0, width: 0, height: 0 }),
    );
  });
});

describe("HUD position persistence", () => {
  it("persists the moved position per display and restores it on reopen", () => {
    const { manager, hudPositions } = setup();
    const hud = manager.openHud("2") as FakeWindow;
    hud.bounds = { x: 1500, y: 100, width: 560, height: 64 };
    hud.emit("moved");
    expect(hudPositions.get("2")).toEqual({ x: 60, y: 100 });
    hud.close();
    const again = manager.openHud("2") as FakeWindow;
    expect(again.options).toMatchObject({ x: 1500, y: 100 });
    // Display 1 is unaffected.
    again.close();
    const other = manager.openHud("1") as FakeWindow;
    expect(other.options).toMatchObject(
      defaultHudPosition(displays[0]?.workArea ?? { x: 0, y: 0, width: 0, height: 0 }),
    );
  });

  it("persists the position on close even without a moved event (Linux)", () => {
    const { manager, hudPositions } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    hud.bounds = { x: 100, y: 225, width: 560, height: 64 };
    manager.closeKind("hud");
    expect(hudPositions.get("1")).toEqual({ x: 100, y: 200 });
    const again = manager.openHud("1") as FakeWindow;
    expect(again.options).toMatchObject({ x: 100, y: 225 });
  });

  it("clamps a stored offset that no longer fits (display shrank)", () => {
    const store = createMemoryHudPositionStore();
    saveHudPosition(store, "1", { x: 0, y: 0, width: 3000, height: 2000 }, { x: 2400, y: 1900 });
    const p = resolveHudPosition(store, "1", { x: 0, y: 0, width: 1280, height: 800 });
    expect(p).toEqual({ x: 1280 - 560, y: 800 - 64 });
  });

  it("falls back to default for corrupt stored values", () => {
    const store = createMemoryHudPositionStore();
    store.set("1", { x: Number.NaN, y: 3 });
    const wa = { x: 0, y: 0, width: 1000, height: 700 };
    expect(resolveHudPosition(store, "1", wa)).toEqual(defaultHudPosition(wa));
  });
});

describe("windows handlers", () => {
  it("delegate to the manager", async () => {
    const manager = {
      openEditor: vi.fn(),
      openSettings: vi.fn(),
      openLauncher: vi.fn(),
      openHud: vi.fn(),
      openCountdown: vi.fn(),
      openRegionOverlays: vi.fn(() => []),
      setRegionSelecting: vi.fn(),
      openWebcamBubble: vi.fn(),
      closeKind: vi.fn(),
      keys: vi.fn(() => []),
      setHudExpansion: vi.fn(() => null),
      setHudSize: vi.fn(() => ({
        commitId: 3,
        previous: { x: 0, y: 0, width: 560, height: 64 },
        target: { x: 130, y: 8, width: 300, height: 48 },
      })),
      commitHudExpansion: vi.fn(() => true),
      openSourceOutline: vi.fn(),
    };
    const h = createWindowsHandlers({ manager });
    expect(await h["windows:openEditor"]({ projectId: "p" })).toEqual({ ok: true });
    await h["windows:openSettings"]();
    await h["windows:openLauncher"]();
    expect(manager.openEditor).toHaveBeenCalledWith("p");
    expect(manager.openSettings).toHaveBeenCalledOnce();
    expect(manager.openLauncher).toHaveBeenCalledOnce();
    expect(await h["windows:setHudExpansion"]({ size: { width: 720, height: 500 } })).toEqual({
      ok: true,
      layout: null,
      commitId: null,
      previous: null,
      target: null,
    });
    expect(manager.setHudExpansion).toHaveBeenCalledWith({ width: 720, height: 500 });
    expect(await h["windows:setHudSize"]({ width: 300, height: 48, anchor: "center" })).toEqual({
      ok: true,
      commitId: 3,
      previous: { x: 0, y: 0, width: 560, height: 64 },
      target: { x: 130, y: 8, width: 300, height: 48 },
    });
    expect(manager.setHudSize).toHaveBeenCalledWith({ width: 300, height: 48 }, "center");
    expect(await h["windows:commitHudExpansion"]({ commitId: 3 })).toEqual({
      ok: true,
      applied: true,
    });
    expect(await h["windows:openSourceOutline"]({ displayId: "2" })).toEqual({ ok: true });
    expect(manager.openSourceOutline).toHaveBeenCalledWith("2");
  });
});

/** Prepare + commit in one step (what the renderer does after it painted the layout). */
function expand(manager: WindowManager, size: { width: number; height: number } | null) {
  const plan = manager.setHudExpansion(size);
  if (plan) manager.commitHudExpansion(plan.commitId);
  return plan;
}

describe("HUD expansion", () => {
  it("prepares without moving, commits the growth around the anchored pill, and collapses back", () => {
    const { manager } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    const pill = { ...hud.bounds };
    const plan = manager.setHudExpansion({ width: 720, height: 492 });
    const layout = plan?.layout;
    expect(layout?.placement).toBe("above");
    // Nothing moves before the renderer commits.
    expect(hud.bounds).toEqual(pill);
    expect(plan?.previous).toEqual(pill);
    expect(plan?.target).toEqual(layout?.bounds);
    expect(manager.commitHudExpansion(plan?.commitId ?? 0)).toBe(true);
    expect(hud.bounds).toEqual(layout?.bounds);
    // Pill's screen position is unchanged.
    expect(hud.bounds.x + (layout?.pillOffset.x ?? 0)).toBe(pill.x);
    expect(hud.bounds.y + (layout?.pillOffset.y ?? 0)).toBe(pill.y);
    // A commit applies once.
    expect(manager.commitHudExpansion(plan?.commitId ?? 0)).toBe(false);

    const collapse = manager.setHudExpansion(null);
    expect(collapse?.layout).toBeNull();
    expect(collapse?.target).toEqual(pill);
    expect(hud.bounds).toEqual(layout?.bounds);
    manager.commitHudExpansion(collapse?.commitId ?? 0);
    expect(hud.bounds).toEqual(pill);
    // Collapsing twice does not move the window.
    const before = hud.calls.length;
    expand(manager, null);
    expect(hud.calls.length).toBe(before);
  });

  it("ignores a stale commit once a newer change was prepared", () => {
    const { manager } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    const first = manager.setHudExpansion({ width: 720, height: 492 });
    const second = manager.setHudExpansion({ width: 560, height: 104 });
    expect(manager.commitHudExpansion(first?.commitId ?? 0)).toBe(false);
    expect(hud.calls.some((c) => c.startsWith("setBounds"))).toBe(false);
    expect(manager.commitHudExpansion(second?.commitId ?? 0)).toBe(true);
    expect(hud.bounds).toEqual(second?.target);
  });

  it("opens below when the pill sits at the top of the work area", () => {
    const { manager, hudPositions } = setup();
    hudPositions.set("1", { x: 400, y: 0 });
    const hud = manager.openHud("1") as FakeWindow;
    const plan = expand(manager, { width: 560, height: 364 });
    expect(plan?.layout?.placement).toBe("below");
    expect(plan?.layout?.pillOffset).toEqual({ x: 0, y: 0 });
    expect(hud.bounds.y).toBe(25);
  });

  it("persists the pill position, not the expanded window, when moved while expanded", () => {
    const { manager, hudPositions } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    const plan = expand(manager, { width: 720, height: 492 });
    hud.bounds = { ...hud.bounds, x: hud.bounds.x + 10, y: hud.bounds.y - 20 };
    hud.emit("moved");
    const def = defaultHudPosition(displays[0]?.workArea ?? { x: 0, y: 0, width: 0, height: 0 });
    expect(plan).not.toBeNull();
    expect(hudPositions.get("1")).toEqual({ x: def.x + 10, y: def.y - 20 - 25 });
    expand(manager, null);
    expect(hud.bounds).toEqual({ x: def.x + 10, y: def.y - 20, width: 560, height: 64 });
  });

  it("returns null without a HUD and forgets the expansion when the HUD closes", () => {
    const { manager } = setup();
    expect(manager.setHudExpansion({ width: 720, height: 492 })).toBeNull();
    const first = manager.openHud("1") as FakeWindow;
    expand(manager, { width: 720, height: 492 });
    const pending = manager.setHudExpansion({ width: 560, height: 104 });
    manager.closeKind("hud");
    expect(manager.commitHudExpansion(pending?.commitId ?? 0)).toBe(false);
    const second = manager.openHud("1") as FakeWindow;
    expect(second).not.toBe(first);
    expect(second.options).toMatchObject({ width: 560, height: 64 });
    expand(manager, null);
    expect(second.calls.some((c) => c.startsWith("setBounds"))).toBe(false);
  });
});

describe("HUD size", () => {
  it("shrinks to the recording pill around the pill centre, then grows popovers from that pill", () => {
    const { manager } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    const pill = { ...hud.bounds };
    const plan = manager.setHudSize({ width: 300, height: 48 }, "center");
    expect(hud.bounds).toEqual(pill);
    expect(plan?.previous).toEqual(pill);
    expect(plan?.target).toEqual({ x: pill.x + 130, y: pill.y + 8, width: 300, height: 48 });
    manager.commitHudExpansion(plan?.commitId ?? 0);
    expect(hud.bounds).toEqual(plan?.target);

    const menu = expand(manager, { width: 300, height: 232 });
    expect(menu?.layout?.pillOffset).toEqual({ x: 0, y: 232 - 48 });
    expand(manager, null);
    expect(hud.bounds).toEqual(plan?.target);
  });

  it("anchors top-left, clamps into the work area and collapses an open expansion", () => {
    const { manager, hudPositions } = setup();
    hudPositions.set("1", { x: 0, y: 0 });
    const hud = manager.openHud("1") as FakeWindow;
    expand(manager, { width: 720, height: 492 });
    const dot = manager.setHudSize({ width: 36, height: 36 }, "top-left");
    manager.commitHudExpansion(dot?.commitId ?? 0);
    expect(hud.bounds).toEqual({ x: 0, y: 25, width: 36, height: 36 });
    // Back to the pill: centred on the dot, but never outside the work area.
    const back = manager.setHudSize({ width: 560, height: 64 }, "center");
    manager.commitHudExpansion(back?.commitId ?? 0);
    expect(hud.bounds).toEqual({ x: 0, y: 25, width: 560, height: 64 });
    expect(manager.setHudSize({ width: 1, height: 1 }, "center")).not.toBeNull();
  });

  it("persists a resized pill as the pre-record pill sharing its centre", () => {
    const { manager, hudPositions } = setup();
    const hud = manager.openHud("1") as FakeWindow;
    const plan = manager.setHudSize({ width: 300, height: 48 }, "center");
    manager.commitHudExpansion(plan?.commitId ?? 0);
    const pill = hud.bounds;
    hud.emit("moved");
    expect(hudPositions.get("1")).toEqual({ x: pill.x - 130, y: pill.y - 8 - 25 });
  });

  it("returns null without a HUD", () => {
    const { manager } = setup();
    expect(manager.setHudSize({ width: 300, height: 48 }, "center")).toBeNull();
  });
});

describe("HUD visibility", () => {
  it("reports open when openHud creates it and closed on its closed event", () => {
    const changes: boolean[] = [];
    const { manager } = setup(undefined, (open) => changes.push(open));
    expect(manager.isHudOpen()).toBe(false);
    const hud = manager.openHud("1");
    manager.openHud("1"); // refocus: no second notification
    expect(changes).toEqual([true]);
    expect(manager.isHudOpen()).toBe(true);
    hud.close();
    expect(changes).toEqual([true, false]);
    expect(manager.isHudOpen()).toBe(false);
  });

  it("moving the HUD to another display reports the real transitions only", () => {
    const changes: boolean[] = [];
    const { manager } = setup(undefined, (open) => changes.push(open));
    manager.openHud("1");
    manager.openHud("2");
    expect(changes).toEqual([true, false, true]);
    manager.closeKind("hud");
    expect(changes).toEqual([true, false, true, false]);
  });
});

describe("source outline", () => {
  it("opens one click-through, content-protected outline per display covering it", () => {
    const { manager, protectedWins } = setup();
    expect(manager.openSourceOutline("99")).toBeUndefined();
    const one = manager.openSourceOutline("1") as FakeWindow;
    expect(one.options).toMatchObject({
      ...displays[0]?.bounds,
      focusable: false,
      transparent: true,
    });
    expect(one.ignoreMouse).toEqual({ ignore: true, forward: undefined });
    expect(protectedWins).toEqual([one]);
    expect(one.loaded.url).toContain("window=source-outline");
    expect(one.loaded.url).toContain("displayId=1");
    // Reopening on the same display reuses it without stealing focus.
    one.emit("ready-to-show");
    expect(one.calls.filter((c) => /^(show|showInactive|focus)$/.test(c))).toEqual([
      "showInactive",
    ]);
    expect(manager.openSourceOutline("1")).toBe(one);
    expect(one.calls).not.toContain("focus");
    expect(one.calls).not.toContain("show");
    // The selection moved to another display: only that display keeps an outline.
    const two = manager.openSourceOutline("2") as FakeWindow;
    expect(one.destroyed).toBe(true);
    expect(manager.keys()).toEqual(["source-outline:2"]);
    manager.closeKind("source-outline");
    expect(two.destroyed).toBe(true);
  });
});
