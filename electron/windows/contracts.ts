import { z } from "zod";
import type { WindowManager } from "./WindowManager";

/**
 * Renderer → main window requests (ENGINEERING_SPEC §2). User-navigable
 * windows plus the transient recording overlays (HUD, region overlays,
 * countdown, webcam bubble) the renderer recording flow opens and closes.
 */

/** Only transient recording windows may be closed from a renderer. */
export const CLOSABLE_WINDOW_KINDS = [
  "hud",
  "region-overlay",
  "countdown",
  "webcam-bubble",
] as const;

const Ok = z.object({ ok: z.literal(true) });
const DisplayId = z.string().min(1).max(256);
export const windowsContracts = {
  "windows:openEditor": {
    name: "windows:openEditor",
    request: z.object({ projectId: z.string().min(1) }),
    response: z.object({ ok: z.literal(true) }),
  },
  "windows:openSettings": {
    name: "windows:openSettings",
    request: z.void(),
    response: z.object({ ok: z.literal(true) }),
  },
  "windows:openLauncher": {
    name: "windows:openLauncher",
    request: z.void(),
    response: z.object({ ok: z.literal(true) }),
  },
  /** Recording HUD on a display (default primary), at its persisted position. */
  "windows:openHud": {
    name: "windows:openHud",
    request: z.object({ displayId: DisplayId.optional() }),
    response: Ok,
  },
  "windows:openCountdown": {
    name: "windows:openCountdown",
    request: z.object({ displayId: DisplayId.optional() }),
    response: Ok,
  },
  /** One region-selector overlay per display; returns the display ids opened. */
  "windows:openRegionOverlays": {
    name: "windows:openRegionOverlays",
    request: z.void(),
    response: z.object({ ok: z.literal(true), displayIds: z.array(z.string()) }),
  },
  /** Overlays ignore the mouse except while the user is selecting (§2). */
  "windows:setRegionSelecting": {
    name: "windows:setRegionSelecting",
    request: z.object({ displayId: DisplayId, selecting: z.boolean() }),
    response: Ok,
  },
  "windows:openWebcamBubble": {
    name: "windows:openWebcamBubble",
    request: z.object({
      position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
    }),
    response: Ok,
  },
  "windows:closeKind": {
    name: "windows:closeKind",
    request: z.object({ kind: z.enum(CLOSABLE_WINDOW_KINDS) }),
    response: Ok,
  },
  /**
   * Grow the HUD window for its popovers (menus, source picker, chips) keeping
   * the pill anchored on screen; `size: null` collapses back to the pill.
   * `layout` is null when collapsed or no HUD is open.
   */
  "windows:setHudExpansion": {
    name: "windows:setHudExpansion",
    request: z.object({
      size: z
        .object({
          width: z.number().int().positive().max(8192),
          height: z.number().int().positive().max(8192),
        })
        .nullable(),
    }),
    response: z.object({
      ok: z.literal(true),
      layout: z
        .object({
          bounds: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
          placement: z.enum(["above", "below"]),
          pillOffset: z.object({ x: z.number(), y: z.number() }),
        })
        .nullable(),
    }),
  },
} as const;

type WindowsContracts = typeof windowsContracts;

export type WindowsHandlers = {
  [K in keyof WindowsContracts]: (
    req: z.infer<WindowsContracts[K]["request"]>,
  ) => Promise<z.infer<WindowsContracts[K]["response"]>>;
};

export interface WindowsDeps {
  manager: Pick<
    WindowManager,
    | "openEditor"
    | "openSettings"
    | "openLauncher"
    | "openHud"
    | "openCountdown"
    | "openRegionOverlays"
    | "setRegionSelecting"
    | "openWebcamBubble"
    | "closeKind"
    | "keys"
    | "setHudExpansion"
  >;
}

export function createWindowsHandlers(deps: WindowsDeps): WindowsHandlers {
  return {
    "windows:openEditor": async ({ projectId }) => {
      deps.manager.openEditor(projectId);
      return { ok: true };
    },
    "windows:openSettings": async () => {
      deps.manager.openSettings();
      return { ok: true };
    },
    "windows:openLauncher": async () => {
      deps.manager.openLauncher();
      return { ok: true };
    },
    "windows:openHud": async ({ displayId }) => {
      deps.manager.openHud(displayId);
      return { ok: true };
    },
    "windows:openCountdown": async ({ displayId }) => {
      deps.manager.openCountdown(displayId);
      return { ok: true };
    },
    "windows:openRegionOverlays": async () => {
      deps.manager.openRegionOverlays();
      const prefix = "region-overlay:";
      const displayIds = deps.manager
        .keys()
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
      return { ok: true, displayIds };
    },
    "windows:setRegionSelecting": async ({ displayId, selecting }) => {
      deps.manager.setRegionSelecting(displayId, selecting);
      return { ok: true };
    },
    "windows:openWebcamBubble": async ({ position }) => {
      deps.manager.openWebcamBubble(position);
      return { ok: true };
    },
    "windows:closeKind": async ({ kind }) => {
      deps.manager.closeKind(kind);
      return { ok: true };
    },
    "windows:setHudExpansion": async ({ size }) => ({
      ok: true,
      layout: deps.manager.setHudExpansion(size),
    }),
  };
}
