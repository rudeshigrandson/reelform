import { z } from "zod";
import type { WindowManager } from "./WindowManager";

/**
 * Renderer → main window requests (ENGINEERING_SPEC §2). Transient overlays
 * (HUD, region overlays, countdown, webcam bubble) are driven by the
 * recording session in main, so only user-navigable windows are exposed.
 */
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
} as const;

type WindowsContracts = typeof windowsContracts;

export type WindowsHandlers = {
  [K in keyof WindowsContracts]: (
    req: z.infer<WindowsContracts[K]["request"]>,
  ) => Promise<z.infer<WindowsContracts[K]["response"]>>;
};

export interface WindowsDeps {
  manager: Pick<WindowManager, "openEditor" | "openSettings" | "openLauncher">;
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
  };
}
