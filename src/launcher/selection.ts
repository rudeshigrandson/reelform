import type { DeviceInfo, SourceItem, SourceMode } from "./types";

/**
 * Selection rules shared by the launcher and the pre-record HUD: sources and
 * devices refresh while open, so a pick is kept only while it still exists and
 * otherwise falls back to the first entry.
 */

/** Screen and region capture displays; window mode captures windows. */
export function sourceKindFor(mode: SourceMode): SourceItem["kind"] {
  return mode === "window" ? "window" : "display";
}

export function effectiveSourceId(
  sources: ReadonlyArray<Pick<SourceItem, "id" | "kind">>,
  mode: SourceMode,
  selectedId: string | null,
): string | null {
  const kind = sourceKindFor(mode);
  const visible = sources.filter((s) => s.kind === kind);
  return visible.some((s) => s.id === selectedId) ? selectedId : (visible[0]?.id ?? null);
}

export function effectiveDeviceId(devices: ReadonlyArray<DeviceInfo>, pick: string): string {
  return devices.some((d) => d.id === pick) ? pick : (devices[0]?.id ?? "");
}

/** Mode after picking a source: windows switch to Window; displays leave Window mode. */
export function modeForPick(current: SourceMode, kind: SourceItem["kind"]): SourceMode {
  if (kind === "window") return "window";
  return current === "window" ? "screen" : current;
}
