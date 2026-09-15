import { type HudPositionStore, resolveHudPosition, saveHudPosition } from "./hudPosition";
import { CONTENT_PROTECTED, type WindowKind, type WindowParams, windowKey } from "./windowKinds";
import {
  HUD_SIZE,
  type HudLayout,
  type Point,
  type Rect,
  type Size,
  type WindowOptions,
  buildWindowOptions,
  hudExpansionLayout,
} from "./windowOptions";
import { type LoadSource, buildLoadTarget } from "./windowUrl";

/**
 * Owns every renderer window (ENGINEERING_SPEC §2). Electron is injected:
 * a BrowserWindow constructor, the `screen` API and the content-protection
 * setter, so the registry/focus/reuse logic is testable in node.
 */

/** The subset of `BrowserWindow` the manager uses. */
export interface ManagedWindow {
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string, options: { query: Record<string, string> }): Promise<void>;
  show(): void;
  focus(): void;
  close(): void;
  restore(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
  once(event: "ready-to-show", listener: () => void): unknown;
  on(event: "close" | "closed" | "moved", listener: () => void): unknown;
  setAlwaysOnTop(flag: boolean, level?: "screen-saver" | "floating"): void;
  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
}

export type WindowConstructor = new (options: WindowOptions) => ManagedWindow;

export interface DisplayInfo {
  id: number | string;
  bounds: Rect;
  workArea: Rect;
}

export interface ScreenApi {
  getAllDisplays(): DisplayInfo[];
  getPrimaryDisplay(): DisplayInfo;
  getDisplayMatching(rect: Rect): DisplayInfo;
}

export interface WindowManagerDeps {
  BrowserWindow: WindowConstructor;
  screen: ScreenApi;
  setContentProtection(win: ManagedWindow, enabled: boolean): void;
  preloadPath: string;
  loadSource: LoadSource;
  hudPositions: HudPositionStore;
}

export class WindowManager {
  private readonly registry = new Map<string, ManagedWindow>();
  /** Params each live registry entry was opened with. */
  private readonly params = new Map<string, WindowParams>();
  /** The HUD window currently grown around its pill, and where the pill sits in it. */
  private hudExpansion: { win: ManagedWindow; pillOffset: Point } | null = null;

  constructor(private readonly deps: WindowManagerDeps) {}

  /** Live window for params, if any. */
  get(params: WindowParams): ManagedWindow | undefined {
    const win = this.registry.get(windowKey(params));
    return win && !win.isDestroyed() ? win : undefined;
  }

  /** Registry keys of live windows (for tests / diagnostics). */
  keys(): string[] {
    return [...this.registry.entries()].filter(([, w]) => !w.isDestroyed()).map(([k]) => k);
  }

  openLauncher(): ManagedWindow {
    return this.focusOrCreate({ kind: "launcher" }, () =>
      buildWindowOptions("launcher", { preloadPath: this.deps.preloadPath }),
    );
  }

  /** One editor per project; reopening a project focuses its window. */
  openEditor(projectId: string): ManagedWindow {
    if (!projectId) throw new Error("openEditor requires a projectId");
    return this.focusOrCreate({ kind: "editor", projectId }, () =>
      buildWindowOptions("editor", { preloadPath: this.deps.preloadPath }),
    );
  }

  openSettings(): ManagedWindow {
    return this.focusOrCreate({ kind: "settings" }, () =>
      buildWindowOptions("settings", { preloadPath: this.deps.preloadPath }),
    );
  }

  /** HUD on a display (default primary), at its persisted position. */
  openHud(displayId?: string | undefined): ManagedWindow {
    const display = this.display(displayId);
    const id = String(display.id);
    const position = resolveHudPosition(this.deps.hudPositions, id, display.workArea, HUD_SIZE);
    const win = this.focusOrCreate({ kind: "hud", displayId: id }, () =>
      buildWindowOptions("hud", { preloadPath: this.deps.preloadPath, position }),
    );
    return win;
  }

  /**
   * Grow the HUD window for popovers keeping the pill at the same screen
   * position (`null` collapses back to the pill). Returns the layout the HUD
   * renderer uses to place the pill, or null when collapsed / no HUD.
   */
  setHudExpansion(size: Size | null): HudLayout | null {
    const win = this.get({ kind: "hud" });
    if (!win) return null;
    const pill = this.hudPillRect(win);
    if (!size) {
      if (this.hudExpansion?.win === win) {
        this.hudExpansion = null;
        win.setBounds(pill);
      }
      return null;
    }
    const display = this.deps.screen.getDisplayMatching(pill);
    const layout = hudExpansionLayout(pill, size, display.workArea);
    this.hudExpansion = { win, pillOffset: layout.pillOffset };
    win.setBounds(layout.bounds);
    return layout;
  }

  /** Screen rect of the HUD pill (the whole window unless expanded). */
  private hudPillRect(win: ManagedWindow): Rect {
    const b = win.getBounds();
    const exp = this.hudExpansion?.win === win ? this.hudExpansion : null;
    if (!exp) return { x: b.x, y: b.y, width: b.width, height: b.height };
    return { x: b.x + exp.pillOffset.x, y: b.y + exp.pillOffset.y, ...HUD_SIZE };
  }

  /** One click-through overlay per connected display. */
  openRegionOverlays(): ManagedWindow[] {
    return this.deps.screen.getAllDisplays().map((d) => {
      const displayId = String(d.id);
      return this.focusOrCreate({ kind: "region-overlay", displayId }, () =>
        buildWindowOptions("region-overlay", {
          preloadPath: this.deps.preloadPath,
          displayBounds: d.bounds,
        }),
      );
    });
  }

  /** Overlays ignore the mouse (forwarding moves) except while selecting. */
  setRegionSelecting(displayId: string, selecting: boolean): void {
    const win = this.get({ kind: "region-overlay", displayId });
    if (!win) return;
    if (selecting) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  }

  closeRegionOverlays(): void {
    this.closeKind("region-overlay");
  }

  openCountdown(displayId?: string | undefined): ManagedWindow {
    const display = this.display(displayId);
    return this.focusOrCreate({ kind: "countdown", displayId: String(display.id) }, () =>
      buildWindowOptions("countdown", {
        preloadPath: this.deps.preloadPath,
        workArea: display.workArea,
      }),
    );
  }

  openWebcamBubble(position?: Point | undefined): ManagedWindow {
    const display = this.deps.screen.getPrimaryDisplay();
    return this.focusOrCreate({ kind: "webcam-bubble" }, () =>
      buildWindowOptions("webcam-bubble", {
        preloadPath: this.deps.preloadPath,
        workArea: display.workArea,
        position,
      }),
    );
  }

  /** Close every live window of a kind. */
  closeKind(kind: WindowKind): void {
    for (const [key, win] of [...this.registry.entries()]) {
      if (key === kind || key.startsWith(`${kind}:`)) {
        this.registry.delete(key);
        this.params.delete(key);
        if (!win.isDestroyed()) win.close();
      }
    }
  }

  private display(displayId: string | undefined): DisplayInfo {
    if (displayId !== undefined) {
      const found = this.deps.screen.getAllDisplays().find((d) => String(d.id) === displayId);
      if (found) return found;
    }
    return this.deps.screen.getPrimaryDisplay();
  }

  private focusOrCreate(params: WindowParams, options: () => WindowOptions): ManagedWindow {
    const key = windowKey(params);
    const existing = this.registry.get(key);
    if (existing && !existing.isDestroyed()) {
      const prev = this.params.get(key);
      // Singletons bound to a display (HUD, countdown) are recreated on the
      // requested display instead of focusing the one on another display.
      if (prev?.displayId === params.displayId) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return existing;
      }
      this.registry.delete(key);
      this.params.delete(key);
      existing.close();
    }

    const win = new this.deps.BrowserWindow(options());
    this.registry.set(key, win);
    this.params.set(key, params);
    win.on("closed", () => {
      if (this.registry.get(key) === win) {
        this.registry.delete(key);
        this.params.delete(key);
      }
    });
    this.applyKindBehaviour(params.kind, win);

    // Registry keys by kind for singletons; the URL still carries the display.
    const target = buildLoadTarget(this.deps.loadSource, params);
    win.once("ready-to-show", () => win.show());
    const loading =
      target.type === "url"
        ? win.loadURL(target.url)
        : win.loadFile(target.filePath, { query: target.query });
    loading.catch(() => {
      // Load failures surface via the window's own did-fail-load; never crash main.
    });
    return win;
  }

  private applyKindBehaviour(kind: WindowKind, win: ManagedWindow): void {
    if (CONTENT_PROTECTED[kind]) this.deps.setContentProtection(win, true);
    switch (kind) {
      case "hud": {
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        const persist = () => {
          if (win.isDestroyed()) return;
          // Persist the pill, never the grown popover window around it.
          const pill = this.hudPillRect(win);
          const display = this.deps.screen.getDisplayMatching(pill);
          saveHudPosition(this.deps.hudPositions, String(display.id), display.workArea, pill);
        };
        // `moved` is macOS/Windows only; `close` also covers Linux.
        win.on("moved", persist);
        win.on("close", persist);
        win.on("closed", () => {
          if (this.hudExpansion?.win === win) this.hudExpansion = null;
        });
        break;
      }
      case "region-overlay":
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setIgnoreMouseEvents(true, { forward: true });
        break;
      case "countdown":
      case "webcam-bubble":
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        break;
      default:
        break;
    }
  }
}
