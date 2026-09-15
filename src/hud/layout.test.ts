import { describe, expect, it } from "vitest";
import {
  APP_REGION_DRAG,
  CHIP_ROW_HEIGHT,
  HUD_GAP,
  MENU_SIZE,
  PICKER_POPOVER_SIZE,
  hudExpansionSize,
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
