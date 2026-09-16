import type { ReelformApi } from "@contracts";
import type { InspectorHost, PickFileOptions } from "./types";

/**
 * Filesystem path of a dropped / browsed `File`. Electron ≥ 32 removed
 * `File.path`; the preload exposes `webUtils.getPathForFile` on
 * `window.reelform.getPathForFile`. Null when neither is available (tests,
 * plain browser).
 */
export function fileSystemPath(file: File): string | null {
  const bridge = (globalThis as { reelform?: Partial<ReelformApi> }).reelform;
  try {
    const viaBridge = bridge?.getPathForFile?.(file);
    if (viaBridge) return viaBridge;
  } catch {
    // Not a real on-disk file (e.g. synthesized in a test or pasted from memory).
  }
  const legacy = (file as File & { path?: unknown }).path;
  return typeof legacy === "string" && legacy !== "" ? legacy : null;
}

/** The file's path, or — when the renderer can't see it — ask the user to pick the file. */
export async function pathForFile(
  host: Pick<InspectorHost, "pickFile">,
  file: File | null,
  pick: PickFileOptions,
): Promise<string | null> {
  return (file ? fileSystemPath(file) : null) ?? host.pickFile(pick);
}
