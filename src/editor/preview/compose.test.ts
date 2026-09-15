import { describe, expect, it } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import { DEFAULT_FRAME_SETTINGS } from "../inspector/frame/types";
import type { Clip } from "../model/schema";
import { grainSeed } from "./colorEffects";
import { type ComposeInput, composeScene, createComposedSceneEvaluator } from "./compose";
import { RIPPLE_MS, buildCursorMotion } from "./cursorEffects";
import { buildSmoothedCursorTrack } from "./cursorSmoothing";

// Cursor moves linearly across the source: x = tMs / 10_000.
const points = Array.from({ length: 11 }, (_, i) => ({ tMs: i * 1000, x: i / 10, y: 0.5 }));
const track = buildSmoothedCursorTrack(points, { smoothing: 0 });

const clips: Clip[] = [
  { id: "a", sourceStartMs: 1000, sourceEndMs: 3000, timelineStartMs: 0 },
  { id: "b", sourceStartMs: 6000, sourceEndMs: 9000, timelineStartMs: 2000 },
];

const input = (patch: Partial<ComposeInput> = {}): ComposeInput => ({
  canvas: { width: 1920, height: 1080 },
  frame: structuredClone(DEFAULT_FRAME_SETTINGS),
  sourceSize: { width: 1920, height: 1080 },
  zoomRegions: [],
  cursor: structuredClone(DEFAULT_CURSOR_SETTINGS),
  cursorTrack: track,
  hasVideo: true,
  durationMs: 5000,
  ...patch,
});

describe("composeScene", () => {
  it("is deterministic and matches the export evaluator", () => {
    const evalAt = createComposedSceneEvaluator(input());
    for (const t of [0, 1234.5, 4999]) {
      expect(composeScene(input(), t)).toEqual(composeScene(input(), t));
      expect(evalAt(t)).toEqual(composeScene(input(), t));
    }
  });

  it("looks telemetry up in source time through clips", () => {
    const s = composeScene(input({ clips }), 2500);
    const expected = track.positionAt(6500).x * s.layout.content.width;
    expect(s.composition?.cursor.x).toBeCloseTo(expected, 3);
    expect(s.cursor.x).toBeCloseTo(expected, 3);
    const noClips = composeScene(input(), 2500);
    expect(noClips.composition?.cursor.x).toBeCloseTo(
      track.positionAt(2500).x * s.layout.content.width,
      3,
    );
  });

  it("follow-focus zoom tracks the cursor in source time", () => {
    const zoom = {
      id: "z",
      startMs: 0,
      endMs: 5000,
      level: 2,
      focus: { mode: "follow" as const, x: 0.5, y: 0.5 },
      easeInMs: 0,
      easeOutMs: 0,
      curve: "linear" as const,
      source: "manual" as const,
    };
    const s = composeScene(input({ clips, zoomRegions: [zoom] }), 2500);
    expect(s.camera.focus.x).toBeCloseTo(track.positionAt(6500).x, 3);
  });

  it("loop mode returns the cursor to its t=0 position at the end", () => {
    const cursor = { ...structuredClone(DEFAULT_CURSOR_SETTINGS), loop: true };
    const end = composeScene(input({ cursor }), 5000);
    const start = composeScene(input({ cursor }), 0);
    expect(end.composition?.cursor.x).toBeCloseTo(start.composition?.cursor.x ?? -1, 3);
  });

  it("click ripple maps through the crop and lives 300ms", () => {
    const motion = buildCursorMotion({ points, clicks: [[1000, 0.5, 0.5, "left", "down"]] });
    const frame = {
      ...structuredClone(DEFAULT_FRAME_SETTINGS),
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    };
    const s = composeScene(input({ motion, frame }), 1100);
    const fx = s.composition?.cursor.clicks[0];
    expect(fx?.kind).toBe("ripple");
    expect(fx?.x).toBeCloseTo(0.5 * s.layout.content.width);
    expect(
      composeScene(input({ motion, frame }), 1000 + RIPPLE_MS + 1).composition?.cursor.clicks,
    ).toEqual([]);
  });

  it("hide-when-idle fades the cursor during a long still stretch", () => {
    const still = [
      { tMs: 0, x: 0.1, y: 0.1 },
      { tMs: 5000, x: 0.1, y: 0.1 },
    ];
    const motion = buildCursorMotion({ points: still });
    const cursor = {
      ...structuredClone(DEFAULT_CURSOR_SETTINGS),
      hideWhenIdle: { enabled: true, delaySec: 1 },
    };
    const s = composeScene(
      input({ motion, cursor, cursorTrack: buildSmoothedCursorTrack(still) }),
      3000,
    );
    expect(s.composition?.cursor.alpha).toBe(0);
    expect(s.composition?.cursor.visible).toBe(false);
  });

  it("no cursor track hides the cursor but keeps the style", () => {
    const cursor = { ...structuredClone(DEFAULT_CURSOR_SETTINGS), style: "windows" as const };
    const s = composeScene(input({ cursorTrack: null, cursor }), 0);
    expect(s.composition?.cursor).toMatchObject({ visible: false, style: "windows" });
  });

  it("carries color fx (seeded by fps) and title cards", () => {
    const effects = structuredClone(DEFAULT_EFFECTS_SETTINGS);
    effects.color.grain = true;
    effects.intro = { text: "Intro", bg: "#000000", durationMs: 1000 };
    const s = composeScene(input({ effects, fps: 60 }), 500);
    expect(s.composition?.color.grain?.seed).toBe(grainSeed(500, 60));
    expect(s.composition?.titleCard).toMatchObject({
      visible: true,
      which: "intro",
      text: "Intro",
    });
  });

  it("non-finite time evaluates at 0", () => {
    expect(composeScene(input(), Number.NaN).tMs).toBe(0);
  });
});
