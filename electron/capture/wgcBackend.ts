import { createHelperBackend } from "./helperBackend";
import type { NativeBackendDeps } from "./sckBackend";
import type { CaptureBackend } from "./types";

/** Windows.Graphics.Capture backend via the `reelform-wgc.exe` helper (§5.4). */
export const WGC_HELPER_NAME = "reelform-wgc.exe";

export function createWgcBackend(deps: NativeBackendDeps): CaptureBackend {
  return createHelperBackend({
    ...deps,
    id: "wgc",
    targetPlatform: "win32",
    targetOsName: "Windows",
  });
}
