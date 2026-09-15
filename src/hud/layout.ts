import type { CSSProperties } from "react";

/**
 * HUD window sizing (guide S05/S06/S10, SPEC §5.7). The HUD window is exactly
 * its pill: 560×64 before recording, 300×48 while recording, a 20px dot (in a
 * 36×36 window, room for its shadow) when hidden. Anything that must appear
 * outside the pill (warning chips, device / overflow menus, the source picker,
 * the discard confirm) grows the window around the pill through
 * `windows:setHudExpansion`, which keeps the pill anchored on screen.
 */

export interface HudSize {
  width: number;
  height: number;
}

export const PILL_WIDTH = 560;
export const PILL_HEIGHT = 64;
export const PRE_RECORD_PILL: HudSize = { width: PILL_WIDTH, height: PILL_HEIGHT };
/** S10 recording pill. */
export const RECORDING_PILL: HudSize = { width: 300, height: 48 };
/** S10 hidden mode: the dot, and the window around it (shadow margin). */
export const HIDDEN_DOT_SIZE = 20;
export const HIDDEN_DOT_WINDOW: HudSize = { width: 36, height: 36 };
/** Space between the pill and a chip row or popover. */
export const HUD_GAP = 8;
export const CHIP_ROW_HEIGHT = 32;
export const MENU_SIZE = { width: 560, height: 280 } as const;
export const PICKER_POPOVER_SIZE = { width: 720, height: 420 } as const;
/** Recording pill overflow: source header + Restart, Discard, Hide pill, Mute mic. */
export const RECORDING_MENU_SIZE = { width: 220, height: 184 } as const;
export const DISCARD_CONFIRM_SIZE = { width: 300, height: 120 } as const;

/**
 * `-webkit-app-region: drag` (SPEC §5.7: the pill is draggable). Not in React's
 * CSS typings, hence the cast; interactive controls stay outside the region.
 */
export const APP_REGION_DRAG = { WebkitAppRegion: "drag" } as unknown as CSSProperties;

export type HudPopover = "mic" | "camera" | "overflow" | "picker";

/** What the recording pill has open around it. */
export type RecordingPanel = "menu" | "confirm";

/** What the HUD window shows, which decides the pill (= collapsed window) size. */
export type HudView = "prerecord" | "recording" | "interrupted" | "hidden";

const rowCount = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Window size for what is open, or null when the bare pill fits. Chips stack one per row. */
export function hudExpansionSize(
  popover: HudPopover | null,
  chipCount: number,
  pill: HudSize = PRE_RECORD_PILL,
): HudSize | null {
  const pop = popover === null ? null : popover === "picker" ? PICKER_POPOVER_SIZE : MENU_SIZE;
  const rows = rowCount(chipCount);
  if (!pop && rows === 0) return null;
  return {
    width: Math.max(pill.width, pop?.width ?? 0),
    height: pill.height + rows * (HUD_GAP + CHIP_ROW_HEIGHT) + (pop ? HUD_GAP + pop.height : 0),
  };
}

/** Recording pill window growth: a warning strip row and/or the overflow menu or discard confirm. */
export function recordingExpansionSize(
  panel: RecordingPanel | null,
  warningRows: number,
  pill: HudSize = RECORDING_PILL,
): HudSize | null {
  const pop =
    panel === "menu" ? RECORDING_MENU_SIZE : panel === "confirm" ? DISCARD_CONFIRM_SIZE : null;
  const rows = rowCount(warningRows);
  if (!pop && rows === 0) return null;
  return {
    width: Math.max(pill.width, pop?.width ?? 0),
    height: pill.height + rows * (HUD_GAP + CHIP_ROW_HEIGHT) + (pop ? HUD_GAP + pop.height : 0),
  };
}

export function hudPillSize(view: HudView): HudSize {
  switch (view) {
    case "recording":
      return RECORDING_PILL;
    case "hidden":
      return HIDDEN_DOT_WINDOW;
    default:
      // Pre-record and the interrupted warning pill ("Recording saved up to 00:42 — …").
      return PRE_RECORD_PILL;
  }
}
