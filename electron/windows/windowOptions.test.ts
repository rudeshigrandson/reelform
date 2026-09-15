import fc from "fast-check";
import { CONTENT_PROTECTED, INSTANCE_POLICY, WINDOW_KINDS, windowKey } from "./windowKinds";
import {
  COUNTDOWN_SIZE,
  EDITOR_SIZE,
  HUD_SIZE,
  LAUNCHER_SIZE,
  type Rect,
  SETTINGS_SIZE,
  buildWindowOptions,
  centerIn,
  clampIntoArea,
  defaultHudPosition,
  hudExpansionLayout,
} from "./windowOptions";

const rectArb = fc.record({
  x: fc.integer({ min: -5000, max: 5000 }),
  y: fc.integer({ min: -5000, max: 5000 }),
  width: fc.integer({ min: 0, max: 8000 }),
  height: fc.integer({ min: 0, max: 8000 }),
});

describe("buildWindowOptions", () => {
  it("always sets hardened webPreferences for every kind and context", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...WINDOW_KINDS),
        fc.string(),
        fc.option(rectArb, { nil: undefined }),
        fc.option(rectArb, { nil: undefined }),
        (kind, preloadPath, displayBounds, workArea) => {
          const o = buildWindowOptions(kind, { preloadPath, displayBounds, workArea });
          // Throttling is the only allowed extra (launcher; see windowOptions.throttling.test.ts).
          const { backgroundThrottling: _throttling, ...hardened } = o.webPreferences;
          expect(hardened).toEqual({
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          });
          expect(o.show).toBe(false);
        },
      ),
    );
  });

  it("uses the spec sizes for launcher, editor and settings", () => {
    const ctx = { preloadPath: "/p.cjs" };
    expect(buildWindowOptions("launcher", ctx)).toMatchObject(LAUNCHER_SIZE);
    expect(buildWindowOptions("launcher", ctx)).toMatchObject({
      width: 720,
      height: 520,
      minWidth: 640,
      minHeight: 480,
    });
    expect(buildWindowOptions("editor", ctx)).toMatchObject(EDITOR_SIZE);
    expect(buildWindowOptions("editor", ctx)).toMatchObject({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
    });
    expect(buildWindowOptions("settings", ctx)).toMatchObject({
      ...SETTINGS_SIZE,
      width: 860,
      height: 620,
    });
  });

  it("makes overlay kinds transparent, frameless, always-on-top and off the taskbar", () => {
    for (const kind of ["hud", "region-overlay", "countdown", "webcam-bubble"] as const) {
      const o = buildWindowOptions(kind, { preloadPath: "/p" });
      expect(o).toMatchObject({
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
      });
      expect(o.backgroundColor).toBe("#00000000");
    }
    for (const kind of ["launcher", "editor", "settings"] as const) {
      const o = buildWindowOptions(kind, { preloadPath: "/p" });
      expect(o.transparent).toBeUndefined();
      expect(o.frame).toBeUndefined();
    }
  });

  it("HUD is 560x64 and placed at the given position or bottom-center of the work area", () => {
    const workArea = { x: 0, y: 25, width: 1440, height: 875 };
    const hud = buildWindowOptions("hud", { preloadPath: "/p", workArea });
    expect(hud).toMatchObject({ width: 560, height: 64, ...defaultHudPosition(workArea) });
    const placed = buildWindowOptions("hud", {
      preloadPath: "/p",
      workArea,
      position: { x: 7, y: 9 },
    });
    expect(placed).toMatchObject({ x: 7, y: 9 });
  });

  it("region overlay fills the display bounds exactly", () => {
    fc.assert(
      fc.property(rectArb, (b) => {
        const o = buildWindowOptions("region-overlay", { preloadPath: "/p", displayBounds: b });
        expect({ x: o.x, y: o.y, width: o.width, height: o.height }).toEqual(b);
        expect(o.movable).toBe(false);
      }),
    );
  });

  it("countdown is centered in the work area", () => {
    const workArea: Rect = { x: 1440, y: 0, width: 1920, height: 1080 };
    const o = buildWindowOptions("countdown", { preloadPath: "/p", workArea });
    expect({ x: o.x, y: o.y }).toEqual(centerIn(workArea, COUNTDOWN_SIZE));
    expect(o.focusable).toBe(true);
  });

  it("webcam bubble defaults to bottom-left, honours size and position overrides", () => {
    const workArea: Rect = { x: 0, y: 0, width: 1000, height: 800 };
    const o = buildWindowOptions("webcam-bubble", { preloadPath: "/p", workArea });
    expect(o).toMatchObject({ x: 24, y: 800 - 240 - 24, movable: true });
    const big = buildWindowOptions("webcam-bubble", {
      preloadPath: "/p",
      size: { width: 320, height: 320 },
      position: { x: 5, y: 6 },
    });
    expect(big).toMatchObject({ width: 320, height: 320, x: 5, y: 6 });
  });
});

describe("clampIntoArea / defaultHudPosition", () => {
  it("keeps a fitting window fully inside the area", () => {
    fc.assert(
      fc.property(
        rectArb.filter((r) => r.width >= HUD_SIZE.width && r.height >= HUD_SIZE.height),
        fc.double({ noNaN: false }),
        fc.double({ noNaN: false }),
        (area, x, y) => {
          const p = clampIntoArea({ x, y }, area, HUD_SIZE);
          expect(p.x).toBeGreaterThanOrEqual(area.x);
          expect(p.y).toBeGreaterThanOrEqual(area.y);
          expect(p.x + HUD_SIZE.width).toBeLessThanOrEqual(area.x + area.width);
          expect(p.y + HUD_SIZE.height).toBeLessThanOrEqual(area.y + area.height);
        },
      ),
    );
  });

  it("pins to the area origin when the window is bigger than the area", () => {
    const area = { x: 10, y: 20, width: 100, height: 30 };
    expect(clampIntoArea({ x: 500, y: 500 }, area, HUD_SIZE)).toEqual({ x: 10, y: 20 });
  });
});

describe("hudExpansionLayout", () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  it("keeps the pill at the same screen position and inside the window for any request", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1440 - 560 }),
        fc.integer({ min: 25, max: 900 - 64 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        (x, y, width, height) => {
          const pill = { x, y, width: 560, height: 64 };
          const l = hudExpansionLayout(pill, { width, height }, workArea);
          expect(l.bounds.x + l.pillOffset.x).toBe(x);
          expect(l.bounds.y + l.pillOffset.y).toBe(y);
          expect(l.pillOffset.x).toBeGreaterThanOrEqual(0);
          expect(l.pillOffset.y).toBeGreaterThanOrEqual(0);
          expect(l.pillOffset.x + 560).toBeLessThanOrEqual(l.bounds.width);
          expect(l.pillOffset.y + 64).toBeLessThanOrEqual(l.bounds.height);
          expect(l.bounds.width).toBeGreaterThanOrEqual(560);
          expect(l.bounds.width).toBeLessThanOrEqual(workArea.width);
          expect(l.bounds.height).toBeLessThanOrEqual(workArea.height);
        },
      ),
    );
  });

  it("centres above a bottom-centre pill; opens below near the top; clamps at the edge", () => {
    const pill = { ...defaultHudPosition(workArea), width: 560, height: 64 };
    const above = hudExpansionLayout(pill, { width: 720, height: 492 }, workArea);
    expect(above.placement).toBe("above");
    expect(above.pillOffset).toEqual({ x: 80, y: 428 });
    const top = hudExpansionLayout(
      { x: 440, y: 30, width: 560, height: 64 },
      { width: 720, height: 492 },
      workArea,
    );
    expect(top.placement).toBe("below");
    expect(top.pillOffset.y).toBe(0);
    const left = hudExpansionLayout(
      { x: 0, y: 800, width: 560, height: 64 },
      { width: 720, height: 300 },
      workArea,
    );
    expect(left.bounds.x).toBe(0);
    expect(left.pillOffset.x).toBe(0);
  });

  it("never shrinks below the pill and ignores non-finite requests", () => {
    const pill = { x: 100, y: 500, width: 560, height: 64 };
    const l = hudExpansionLayout(pill, { width: Number.NaN, height: 10 }, workArea);
    expect(l.bounds).toEqual(pill);
  });
});

describe("windowKinds", () => {
  it("keys singletons by kind, editors by project, overlays by display", () => {
    expect(windowKey({ kind: "launcher", projectId: "x" })).toBe("launcher");
    expect(windowKey({ kind: "settings" })).toBe("settings");
    expect(windowKey({ kind: "editor", projectId: "p1" })).toBe("editor:p1");
    expect(windowKey({ kind: "region-overlay", displayId: "2" })).toBe("region-overlay:2");
    expect(INSTANCE_POLICY.editor).toBe("per-project");
  });

  it("content-protects HUD and webcam bubble but never the main windows", () => {
    expect(CONTENT_PROTECTED.hud).toBe(true);
    expect(CONTENT_PROTECTED["webcam-bubble"]).toBe(true);
    expect(
      CONTENT_PROTECTED.launcher || CONTENT_PROTECTED.editor || CONTENT_PROTECTED.settings,
    ).toBe(false);
  });
});
