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
    const manager = { openEditor: vi.fn(), openSettings: vi.fn(), openLauncher: vi.fn() };
    const h = createWindowsHandlers({ manager });
    expect(await h["windows:openEditor"]({ projectId: "p" })).toEqual({ ok: true });
    await h["windows:openSettings"]();
    await h["windows:openLauncher"]();
    expect(manager.openEditor).toHaveBeenCalledWith("p");
    expect(manager.openSettings).toHaveBeenCalledOnce();
    expect(manager.openLauncher).toHaveBeenCalledOnce();
  });
});
