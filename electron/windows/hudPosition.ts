import {
  HUD_SIZE,
  type Point,
  type Rect,
  type Size,
  clampIntoArea,
  defaultHudPosition,
} from "./windowOptions";

/**
 * HUD position persisted per display (ENGINEERING_SPEC §5.7). Stored as an
 * offset from the display work-area origin so it survives display
 * re-arrangement; restored positions are clamped back inside the work area.
 */
export interface HudPositionStore {
  get(displayId: string): Point | undefined;
  set(displayId: string, offset: Point): void;
}

/** In-memory store (tests, or a fallback when settings are unavailable). */
export function createMemoryHudPositionStore(): HudPositionStore {
  const map = new Map<string, Point>();
  return {
    get: (id) => map.get(id),
    set: (id, offset) => {
      map.set(id, { x: offset.x, y: offset.y });
    },
  };
}

export function resolveHudPosition(
  store: HudPositionStore,
  displayId: string,
  workArea: Rect,
  size: Size = HUD_SIZE,
): Point {
  const offset = store.get(displayId);
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    return defaultHudPosition(workArea, size);
  }
  return clampIntoArea({ x: workArea.x + offset.x, y: workArea.y + offset.y }, workArea, size);
}

export function saveHudPosition(
  store: HudPositionStore,
  displayId: string,
  workArea: Rect,
  topLeft: Point,
): void {
  store.set(displayId, {
    x: Math.round(topLeft.x - workArea.x),
    y: Math.round(topLeft.y - workArea.y),
  });
}
