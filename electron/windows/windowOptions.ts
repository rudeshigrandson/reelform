import type { WindowKind } from "./windowKinds";

/**
 * Pure BrowserWindow option factories (ENGINEERING_SPEC §2).
 *
 * The returned objects are a structural subset of Electron's
 * `BrowserWindowConstructorOptions`, so logic stays importable without
 * Electron. Every kind gets the same hardened `webPreferences`.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SecureWebPreferences {
  preload: string;
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  /** Off only for windows that must keep working hidden (the launcher hosts MediaRecorders). */
  backgroundThrottling?: boolean | undefined;
}

export interface WindowOptions {
  width: number;
  height: number;
  x?: number | undefined;
  y?: number | undefined;
  minWidth?: number | undefined;
  minHeight?: number | undefined;
  show: boolean;
  title?: string | undefined;
  backgroundColor: string;
  transparent?: boolean | undefined;
  frame?: boolean | undefined;
  resizable?: boolean | undefined;
  movable?: boolean | undefined;
  minimizable?: boolean | undefined;
  maximizable?: boolean | undefined;
  fullscreenable?: boolean | undefined;
  alwaysOnTop?: boolean | undefined;
  skipTaskbar?: boolean | undefined;
  hasShadow?: boolean | undefined;
  focusable?: boolean | undefined;
  enableLargerThanScreen?: boolean | undefined;
  webPreferences: SecureWebPreferences;
}

/** Dark-first opaque ground shown before first paint. */
export const OPAQUE_BACKGROUND = "#0a0a0b";
export const TRANSPARENT_BACKGROUND = "#00000000";

export const LAUNCHER_SIZE = { width: 720, height: 520, minWidth: 640, minHeight: 480 } as const;
export const EDITOR_SIZE = { width: 1440, height: 900, minWidth: 1024, minHeight: 700 } as const;
export const SETTINGS_SIZE = { width: 860, height: 620 } as const;
export const HUD_SIZE: Size = { width: 560, height: 64 };
export const COUNTDOWN_SIZE: Size = { width: 240, height: 240 };
export const WEBCAM_BUBBLE_SIZE: Size = { width: 240, height: 240 };
/** Gap between a floating window and the work-area edge. */
export const EDGE_MARGIN = 24;

export interface WindowOptionsContext {
  preloadPath: string;
  /** Target display bounds (region overlay fills them). */
  displayBounds?: Rect | undefined;
  /** Target display work area (floating windows are placed inside it). */
  workArea?: Rect | undefined;
  /** Explicit top-left for floating windows (HUD restored position, bubble). */
  position?: Point | undefined;
  /** Override size for resizable floating windows (webcam bubble). */
  size?: Size | undefined;
}

export function secureWebPreferences(preloadPath: string): SecureWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

/** Center a size inside a rect (rounded to whole pixels). */
export function centerIn(area: Rect, size: Size): Point {
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
  };
}

const floating = {
  transparent: true,
  frame: false,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  backgroundColor: TRANSPARENT_BACKGROUND,
} as const;

/** Build the constructor options for a window kind. */
export function buildWindowOptions(kind: WindowKind, ctx: WindowOptionsContext): WindowOptions {
  const webPreferences = secureWebPreferences(ctx.preloadPath);
  switch (kind) {
    case "launcher":
      return {
        ...LAUNCHER_SIZE,
        show: false,
        title: "Reelform",
        backgroundColor: OPAQUE_BACKGROUND,
        resizable: true,
        // The launcher hosts the Electron backend's MediaRecorders and may be
        // hidden during capture; throttling would stall chunks and the mic meter.
        webPreferences: { ...webPreferences, backgroundThrottling: false },
      };
    case "editor":
      return {
        ...EDITOR_SIZE,
        show: false,
        title: "Reelform",
        backgroundColor: OPAQUE_BACKGROUND,
        resizable: true,
        webPreferences,
      };
    case "settings":
      return {
        ...SETTINGS_SIZE,
        show: false,
        title: "Settings",
        backgroundColor: OPAQUE_BACKGROUND,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        webPreferences,
      };
    case "hud": {
      const pos =
        ctx.position ?? (ctx.workArea ? defaultHudPosition(ctx.workArea, HUD_SIZE) : undefined);
      return {
        ...floating,
        ...HUD_SIZE,
        x: pos?.x,
        y: pos?.y,
        show: false,
        movable: true,
        focusable: true,
        webPreferences,
      };
    }
    case "region-overlay": {
      const b = ctx.displayBounds ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        ...floating,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        show: false,
        movable: false,
        enableLargerThanScreen: true,
        webPreferences,
      };
    }
    case "countdown": {
      const pos = ctx.workArea ? centerIn(ctx.workArea, COUNTDOWN_SIZE) : undefined;
      return {
        ...floating,
        ...COUNTDOWN_SIZE,
        x: pos?.x,
        y: pos?.y,
        show: false,
        movable: false,
        // Focusable so Esc cancels the countdown.
        focusable: true,
        webPreferences,
      };
    }
    case "webcam-bubble": {
      const size = ctx.size ?? WEBCAM_BUBBLE_SIZE;
      const pos =
        ctx.position ??
        (ctx.workArea
          ? {
              x: ctx.workArea.x + EDGE_MARGIN,
              y: ctx.workArea.y + ctx.workArea.height - size.height - EDGE_MARGIN,
            }
          : undefined);
      return {
        ...floating,
        ...size,
        x: pos?.x,
        y: pos?.y,
        show: false,
        movable: true,
        focusable: false,
        webPreferences,
      };
    }
  }
}

/** HUD default: bottom-center of the work area. */
export function defaultHudPosition(workArea: Rect, size: Size = HUD_SIZE): Point {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - EDGE_MARGIN),
  };
}

/** Clamp a top-left so a window of `size` stays fully inside `area` (when it fits). */
export function clampIntoArea(pos: Point, area: Rect, size: Size): Point {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  const x = Number.isFinite(pos.x) ? pos.x : area.x;
  const y = Number.isFinite(pos.y) ? pos.y : area.y;
  return {
    x: clamp(x, area.x, area.x + area.width - size.width),
    y: clamp(y, area.y, area.y + area.height - size.height),
  };
}
