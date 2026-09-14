import { type HelperBackendConfig, createHelperBackend } from "./helperBackend";
import type { CaptureBackend } from "./types";

/** macOS ScreenCaptureKit backend via the `reelform-sck` helper (§5.3). */
export const SCK_HELPER_NAME = "reelform-sck";

export type NativeBackendDeps = Omit<HelperBackendConfig, "id" | "targetPlatform" | "targetOsName">;

export function createSckBackend(deps: NativeBackendDeps): CaptureBackend {
  return createHelperBackend({
    ...deps,
    id: "sck",
    targetPlatform: "darwin",
    targetOsName: "macOS",
  });
}
