import { describe, expect, it } from "vitest";
import {
  APP_REGION_DRAG,
  CHIP_ROW_HEIGHT,
  DISCARD_CONFIRM_SIZE,
  HIDDEN_DOT_WINDOW,
  HUD_GAP,
  MENU_SIZE,
  PICKER_POPOVER_SIZE,
  RECORDING_MENU_SIZE,
  RECORDING_PILL,
  hudExpansionSize,
  hudPillSize,
  recordingExpansionSize,
} from "./layout";

describe("hudExpansionSize", () => {
  it("bare pill needs no expansion", () => {
    expect(hudExpansionSize(null, 0)).toBeNull();
  });

  it("each chip adds its own row above the pill so none is clipped", () => {
    expect(hudExpansionSize(null, 1)).toEqual({
      width: 560,
      height: 64 + HUD_GAP + CHIP_ROW_HEIGHT,
    });
    expect(hudExpansionSize(null, 3)).toEqual({
      width: 560,
      height: 64 + 3 * (HUD_GAP + CHIP_ROW_HEIGHT),
    });
  });

  it("ignores negative and non-finite chip counts", () => {
    expect(hudExpansionSize(null, -2)).toBeNull();
    expect(hudExpansionSize(null, Number.NaN)).toBeNull();
    expect(hudExpansionSize("overflow", Number.POSITIVE_INFINITY)).toEqual({
      width: 560,
      height: 64 + HUD_GAP + MENU_SIZE.height,
    });
  });

  it("the drag region is -webkit-app-region: drag", () => {
    expect(APP_REGION_DRAG).toEqual({ WebkitAppRegion: "drag" });
  });

  it("menus keep the pill width; the picker widens to 720x420", () => {
    expect(hudExpansionSize("mic", 0)).toEqual({
      width: 560,
      height: 64 + HUD_GAP + MENU_SIZE.height,
    });
    expect(hudExpansionSize("picker", 1)).toEqual({
      width: PICKER_POPOVER_SIZE.width,
      height: 64 + HUD_GAP + CHIP_ROW_HEIGHT + HUD_GAP + PICKER_POPOVER_SIZE.height,
    });
  });
});

describe("recording pill sizing (S10)", () => {
  it("the recording pill is 300x48 and grows for the menu, the confirm and a warning strip", () => {
    expect(RECORDING_PILL).toEqual({ width: 300, height: 48 });
    expect(recordingExpansionSize(null, 0)).toBeNull();
    expect(recordingExpansionSize("menu", 0)).toEqual({
      width: 300,
      height: 48 + HUD_GAP + RECORDING_MENU_SIZE.height,
    });
    expect(recordingExpansionSize("confirm", 1)).toEqual({
      width: DISCARD_CONFIRM_SIZE.width,
      height: 48 + HUD_GAP + CHIP_ROW_HEIGHT + HUD_GAP + DISCARD_CONFIRM_SIZE.height,
    });
    expect(recordingExpansionSize(null, Number.NaN)).toBeNull();
  });

  it("maps each HUD view to its pill window size", () => {
    expect(hudPillSize("prerecord")).toEqual({ width: 560, height: 64 });
    expect(hudPillSize("recording")).toEqual(RECORDING_PILL);
    expect(hudPillSize("interrupted")).toEqual({ width: 560, height: 64 });
    expect(hudPillSize("hidden")).toEqual(HIDDEN_DOT_WINDOW);
    expect(HIDDEN_DOT_WINDOW).toEqual({ width: 36, height: 36 });
  });
});
