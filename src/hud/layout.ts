import type { CSSProperties } from "react";

/**
 * HUD window sizing (guide S05/S06, SPEC §5.7). The HUD window is exactly the
 * 560×64 pill; anything that must appear outside it (warning chips, device /
 * overflow menus, the source picker) grows the window around the pill through
 * `windows:setHudExpansion`, which keeps the pill anchored on screen.
 */

export const PILL_WIDTH = 560;
export const PILL_HEIGHT = 64;
/** Space between the pill and a chip row or popover. */
export const HUD_GAP = 8;
export const CHIP_ROW_HEIGHT = 32;
export const MENU_SIZE = { width: 560, height: 280 } as const;
export const PICKER_POPOVER_SIZE = { width: 720, height: 420 } as const;

/**
 * `-webkit-app-region: drag` (SPEC §5.7: the pill is draggable). Not in React's
 * CSS typings, hence the cast; interactive controls stay outside the region.
 */
export const APP_REGION_DRAG = { WebkitAppRegion: "drag" } as unknown as CSSProperties;

export type HudPopover = "mic" | "camera" | "overflow" | "picker";

export interface HudSize {
  width: number;
  height: number;
}

/** Window size for what is open, or null when the bare pill fits. Chips stack one per row. */
export function hudExpansionSize(popover: HudPopover | null, chipCount: number): HudSize | null {
  const pop = popover === null ? null : popover === "picker" ? PICKER_POPOVER_SIZE : MENU_SIZE;
  const rows = Number.isFinite(chipCount) ? Math.max(0, Math.floor(chipCount)) : 0;
  if (!pop && rows === 0) return null;
  return {
    width: Math.max(PILL_WIDTH, pop?.width ?? 0),
    height: PILL_HEIGHT + rows * (HUD_GAP + CHIP_ROW_HEIGHT) + (pop ? HUD_GAP + pop.height : 0),
  };
}
