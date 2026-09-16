import type { BackendId } from "../capture/types";
import type { Settings } from "./schema";

/**
 * Settings › Advanced "Capture backend" (ENGINEERING_SPEC §5.1) → the
 * recording controller's `backendOverride`. `native` means the platform's
 * native helper: ScreenCaptureKit on macOS, Windows.Graphics.Capture on
 * Windows. Linux has no native helper, so it stays on auto selection.
 */
export function backendOverrideFor(
  choice: Settings["captureBackend"],
  platform: string,
): BackendId | null {
  switch (choice) {
    case "electron":
      return "electron";
    case "native":
      if (platform === "darwin") return "sck";
      if (platform === "win32") return "wgc";
      return null;
    default:
      return null;
  }
}
