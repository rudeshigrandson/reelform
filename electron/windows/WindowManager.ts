import { type HudPositionStore, resolveHudPosition, saveHudPosition } from "./hudPosition";
import { CONTENT_PROTECTED, type WindowKind, type WindowParams, windowKey } from "./windowKinds";
import {
  HUD_SIZE,
  type HudAnchor,
  type HudLayout,
  type Point,
  type Rect,
  type Size,
  type WindowOptions,
  buildWindowOptions,
  hudExpansionLayout,
  hudResizeRect,
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
  /** Show without activating (click-through overlays must not take focus). */
  showInactive(): void;
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
  /** Fired `true` when `openHud` creates the HUD and `false` once no HUD is left open. */
  onHudVisibilityChange?: ((open: boolean) => void) | undefined;
}

/**
 * A prepared HUD window change (SPEC §5.7 flicker-free resize): main computes
 * the target without moving the window; the renderer lays out for it, waits
 * for paint, then commits by id. `previous` / `target` are window bounds.
 */
export interface HudWindowPlan {
  commitId: number;
  previous: Rect;
  target: Rect;
}

export interface HudExpansionPlan extends HudWindowPlan {
  /** Null when the change collapses back to the bare pill. */
  layout: HudLayout | null;
}

interface PendingHudChange {
  win: ManagedWindow;
  commitId: number;
  target: Rect;
  pillSize: Size;
  expansion: Point | null;
}

export class WindowManager {
  private readonly registry = new Map<string, ManagedWindow>();
  /** Params each live registry entry was opened with. */
  private readonly params = new Map<string, WindowParams>();
  /** The HUD window currently grown around its pill, and where the pill sits in it. */
  private hudExpansion: { win: ManagedWindow; pillOffset: Point } | null = null;
  /** Current pill size of the live HUD (pre-record 560×64, recording 300×48, hidden dot). */
  private hudPill: { win: ManagedWindow; size: Size } | null = null;
  /** The last prepared, uncommitted HUD change; a newer prepare replaces it. */
  private hudPending: PendingHudChange | null = null;
  private hudCommitSeq = 0;
  private hudOpenNotified = false;

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
    if (!this.hudOpenNotified) {
      this.hudOpenNotified = true;
      this.deps.onHudVisibilityChange?.(true);
    }
    return win;
  }

  isHudOpen(): boolean {
    return this.get({ kind: "hud" }) !== undefined;
  }

  /**
   * Prepare growing the HUD window for popovers keeping the pill at the same
   * screen position (`null` collapses back to the pill). Nothing moves until
   * {@link commitHudExpansion}. Null when no HUD is open.
   */
  setHudExpansion(size: Size | null): HudExpansionPlan | null {
    const win = this.get({ kind: "hud" });
    if (!win) return null;
    const previous = copyRect(win.getBounds());
    const pill = this.hudPillRect(win);
    const pillSize = { width: pill.width, height: pill.height };
    if (!size) {
      return {
        ...this.prepareHud({ win, target: pill, pillSize, expansion: null }),
        previous,
        layout: null,
      };
    }
    const display = this.deps.screen.getDisplayMatching(pill);
    const layout = hudExpansionLayout(pill, size, display.workArea);
    const plan = this.prepareHud({
      win,
      target: layout.bounds,
      pillSize,
      expansion: layout.pillOffset,
    });
    return { ...plan, previous, layout };
  }

  /**
   * Prepare resizing the HUD pill itself (recording pill, hidden dot), around
   * the pill's centre or top-left and clamped into the work area. Collapses any
   * expansion. Nothing moves until {@link commitHudExpansion}.
   */
  setHudSize(size: Size, anchor: HudAnchor = "center"): HudWindowPlan | null {
    const win = this.get({ kind: "hud" });
    if (!win) return null;
    const previous = copyRect(win.getBounds());
    const pill = this.hudPillRect(win);
    const display = this.deps.screen.getDisplayMatching(pill);
    const target = hudResizeRect(pill, size, anchor, display.workArea);
    const pillSize = { width: target.width, height: target.height };
    return { ...this.prepareHud({ win, target, pillSize, expansion: null }), previous };
  }

  /** Apply a prepared HUD change; false when it is stale or the HUD is gone. */
  commitHudExpansion(commitId: number): boolean {
    const p = this.hudPending;
    if (!p || p.commitId !== commitId) return false;
    this.hudPending = null;
    if (p.win.isDestroyed() || this.get({ kind: "hud" }) !== p.win) return false;
    this.hudPill = { win: p.win, size: p.pillSize };
    this.hudExpansion = p.expansion ? { win: p.win, pillOffset: p.expansion } : null;
    const b = p.win.getBounds();
    const same =
      b.x === p.target.x &&
      b.y === p.target.y &&
      b.width === p.target.width &&
      b.height === p.target.height;
    if (!same) p.win.setBounds(p.target);
    return true;
  }

  private prepareHud(change: Omit<PendingHudChange, "commitId">): {
    commitId: number;
    target: Rect;
  } {
    const commitId = ++this.hudCommitSeq;
    this.hudPending = { ...change, commitId };
    return { commitId, target: copyRect(change.target) };
  }

  /** Screen rect of the HUD pill (the whole window unless expanded). */
  private hudPillRect(win: ManagedWindow): Rect {
    const b = win.getBounds();
    const exp = this.hudExpansion?.win === win ? this.hudExpansion : null;
    if (!exp) return { x: b.x, y: b.y, width: b.width, height: b.height };
    const size = this.hudPill?.win === win ? this.hudPill.size : HUD_SIZE;
    return { x: b.x + exp.pillOffset.x, y: b.y + exp.pillOffset.y, ...size };
  }

  /**
   * One click-through outline overlay on the display holding the selected
   * window source (SPEC §5.7); outlines on other displays are closed.
   */
  openSourceOutline(displayId: string): ManagedWindow | undefined {
    const display = this.deps.screen.getAllDisplays().find((d) => String(d.id) === displayId);
    if (!display) return undefined;
    const prefix = "source-outline:";
    for (const key of this.keys()) {
      if (key.startsWith(prefix) && key !== `${prefix}${displayId}`) {
        const win = this.registry.get(key);
        this.registry.delete(key);
        this.params.delete(key);
        win?.close();
      }
    }
    return this.focusOrCreate({ kind: "source-outline", displayId }, () =>
      buildWindowOptions("source-outline", {
        preloadPath: this.deps.preloadPath,
        displayBounds: display.bounds,
      }),
    );
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
        // Click-through outlines never take focus from the HUD.
        if (params.kind === "source-outline") existing.showInactive();
        else {
          existing.show();
          existing.focus();
        }
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
    win.once("ready-to-show", () => {
      if (params.kind === "source-outline") win.showInactive();
      else win.show();
    });
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
          // Persist the pill, never the grown popover window around it. A
          // resized pill (recording pill, hidden dot) is stored as the 560×64
          // pre-record pill sharing its centre, so reopening restores it there.
          const pill = this.hudPillRect(win);
          const display = this.deps.screen.getDisplayMatching(pill);
          const topLeft = {
            x: pill.x + (pill.width - HUD_SIZE.width) / 2,
            y: pill.y + (pill.height - HUD_SIZE.height) / 2,
          };
          saveHudPosition(this.deps.hudPositions, String(display.id), display.workArea, topLeft);
        };
        // `moved` is macOS/Windows only; `close` also covers Linux.
        win.on("moved", persist);
        win.on("close", persist);
        win.on("closed", () => {
          if (this.hudExpansion?.win === win) this.hudExpansion = null;
          if (this.hudPill?.win === win) this.hudPill = null;
          if (this.hudPending?.win === win) this.hudPending = null;
          if (this.hudOpenNotified && !this.isHudOpen()) {
            this.hudOpenNotified = false;
            this.deps.onHudVisibilityChange?.(false);
          }
        });
        break;
      }
      case "source-outline":
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        // Purely visual: every click goes to the app underneath.
        win.setIgnoreMouseEvents(true);
        break;
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

const copyRect = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
