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
  "source-outline",
] as const;

const Ok = z.object({ ok: z.literal(true) });
const DisplayId = z.string().min(1).max(256);
const HudSize = z.object({
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
});
const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
/** A prepared HUD window change: window bounds before / after its commit. */
const HudPlan = {
  commitId: z.number().int().positive().nullable(),
  previous: Bounds.nullable(),
  target: Bounds.nullable(),
};
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
   * Prepare growing the HUD window for its popovers (menus, source picker,
   * chips) keeping the pill anchored on screen; `size: null` collapses back to
   * the pill. Nothing moves until `windows:commitHudExpansion` (SPEC §5.7: the
   * renderer lays out first, so the pill never jumps). `layout` is null when
   * collapsing; `commitId` is null when no HUD is open.
   */
  "windows:setHudExpansion": {
    name: "windows:setHudExpansion",
    request: z.object({ size: HudSize.nullable() }),
    response: z.object({
      ok: z.literal(true),
      layout: z
        .object({
          bounds: Bounds,
          placement: z.enum(["above", "below"]),
          pillOffset: z.object({ x: z.number(), y: z.number() }),
        })
        .nullable(),
      ...HudPlan,
    }),
  },
  /**
   * Prepare resizing the HUD pill itself (recording pill 300×48, hidden dot)
   * around its centre or top-left, clamped to the work area; committed like an
   * expansion.
   */
  "windows:setHudSize": {
    name: "windows:setHudSize",
    request: HudSize.extend({ anchor: z.enum(["center", "top-left"]) }),
    response: z.object({ ok: z.literal(true), ...HudPlan }),
  },
  /** Apply the prepared HUD change; `applied` is false for a stale id or a closed HUD. */
  "windows:commitHudExpansion": {
    name: "windows:commitHudExpansion",
    request: z.object({ commitId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true), applied: z.boolean() }),
  },
  /** Click-through outline of the selected window source on its display (SPEC §5.7). */
  "windows:openSourceOutline": {
    name: "windows:openSourceOutline",
    request: z.object({ displayId: DisplayId }),
    response: Ok,
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
    | "setHudSize"
    | "commitHudExpansion"
    | "openSourceOutline"
  >;
}

const NO_PLAN = { commitId: null, previous: null, target: null } as const;

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
    "windows:setHudExpansion": async ({ size }) => {
      const plan = deps.manager.setHudExpansion(size);
      return plan
        ? {
            ok: true,
            layout: plan.layout,
            commitId: plan.commitId,
            previous: plan.previous,
            target: plan.target,
          }
        : { ok: true, layout: null, ...NO_PLAN };
    },
    "windows:setHudSize": async ({ width, height, anchor }) => {
      const plan = deps.manager.setHudSize({ width, height }, anchor);
      return plan
        ? { ok: true, commitId: plan.commitId, previous: plan.previous, target: plan.target }
        : { ok: true, ...NO_PLAN };
    },
    "windows:commitHudExpansion": async ({ commitId }) => ({
      ok: true,
      applied: deps.manager.commitHudExpansion(commitId),
    }),
    "windows:openSourceOutline": async ({ displayId }) => {
      deps.manager.openSourceOutline(displayId);
      return { ok: true };
    },
  };
}
