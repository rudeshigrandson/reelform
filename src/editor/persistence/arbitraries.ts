import fc from "fast-check";
import {
  ANNOTATION_KINDS,
  type Annotation,
  type AnnotationAnim,
  DEFAULT_PROPS,
} from "../inspector/annotations/types";
import type { AudioRegion, AudioSettings, TrackSettings } from "../inspector/audio/types";
import type { Caption, CaptionStyle } from "../inspector/captions/types";
import { ANCHORS } from "../inspector/controls";
import { CLICK_EFFECTS, CURSOR_STYLES, type CursorSettings } from "../inspector/cursor/types";
import {
  type EffectsSettings,
  type SpeedRegionEdit,
  TRANSITION_KINDS,
  type TitleCard,
} from "../inspector/effects/types";
import {
  ASPECT_PRESETS,
  BACKGROUND_KINDS,
  DEFAULT_FRAME_SETTINGS,
  type FrameSettings,
} from "../inspector/frame/types";
import {
  DEFAULT_WEBCAM_SETTINGS,
  WEBCAM_SHAPES,
  type WebcamSettings,
} from "../inspector/webcam/types";
import type { ZoomRegion, ZoomSettings } from "../inspector/zoom/types";
import type { EditorData } from "../store";

/**
 * fast-check arbitraries producing schema-valid `EditorData` for the
 * persistence round-trip properties. Test-only helper (not in the barrel).
 */

/** Finite double in range; normalizes -0 (JSON turns it into 0). */
export const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => v + 0);
const int = (min: number, max: number) => fc.integer({ min, max });
const hex = fc
  .tuple(int(0, 255), int(0, 255), int(0, 255))
  .map((c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
const ms = int(0, 600_000);
const text = fc.string({ maxLength: 20 });

/** `[startMs, endMs]` with end strictly after start. */
const span = fc.tuple(ms, int(1, 60_000)).map(([s, d]) => [s, s + d] as const);

/** Arrays whose items get unique, index-based ids. */
function withIds<T extends { id: string }>(
  item: fc.Arbitrary<Omit<T, "id">>,
  prefix: string,
  maxLength = 5,
): fc.Arbitrary<T[]> {
  return fc
    .array(item, { maxLength })
    .map((items) => items.map((it, i) => ({ ...it, id: `${prefix}${i}` }) as T));
}

const frame: fc.Arbitrary<FrameSettings> = fc
  .record({
    kind: fc.constantFrom(...BACKGROUND_KINDS),
    color: hex,
    blur: num(0, 40),
    radius: int(0, 64),
    squircle: fc.boolean(),
    pad: int(0, 200),
    matchAll: fc.boolean(),
    preset: fc.constantFrom(...ASPECT_PRESETS),
    inset: num(50, 100),
    imagePath: fc.option(text, { nil: null }),
    crop: fc.option(
      fc.record({ x: num(0, 1), y: num(0, 1), width: num(0, 1), height: num(0, 1) }),
      { nil: null },
    ),
  })
  .map((r) => {
    const f = structuredClone(DEFAULT_FRAME_SETTINGS);
    f.background.kind = r.kind;
    f.background.color = r.color;
    f.background.image.path = r.imagePath;
    f.blur = r.blur;
    f.radius = r.radius;
    f.squircle = r.squircle;
    f.padding = { ...f.padding, matchAll: r.matchAll, all: r.pad, left: r.pad };
    f.aspect.preset = r.preset;
    f.inset = r.inset;
    f.crop = r.crop;
    return f;
  });

const cursor: fc.Arbitrary<CursorSettings> = fc.record({
  show: fc.boolean(),
  style: fc.constantFrom(...CURSOR_STYLES),
  customCursor: fc.option(
    fc.record({
      fileName: fc.string({ minLength: 1 }),
      path: fc.string({ minLength: 1 }),
      kind: fc.constantFrom("png" as const, "svg" as const),
    }),
    { nil: null },
  ),
  size: num(50, 300),
  smoothing: num(0, 100),
  motionBlur: fc.record({ enabled: fc.boolean(), amount: num(0, 100) }),
  clickEffect: fc.record({
    type: fc.constantFrom(...CLICK_EFFECTS),
    color: hex,
    size: num(50, 300),
  }),
  sway: fc.boolean(),
  hideWhenIdle: fc.record({ enabled: fc.boolean(), delaySec: num(0.5, 10) }),
  loop: fc.boolean(),
  clickSound: fc.record({
    type: fc.constantFrom(
      "none" as const,
      "soft" as const,
      "mechanical" as const,
      "custom" as const,
    ),
    volume: num(0, 100),
    customSound: fc.constant(null),
  }),
});

const webcam: fc.Arbitrary<WebcamSettings> = fc
  .record({
    enabled: fc.boolean(),
    shape: fc.constantFrom(...WEBCAM_SHAPES),
    sizePct: num(10, 50),
    anchor: fc.option(fc.constantFrom(...ANCHORS), { nil: null }),
    customX: num(0, 1),
    mirror: fc.boolean(),
    crop: fc.option(
      fc.record({ x: num(0, 1000), y: num(0, 1000), w: num(1, 1000), h: num(1, 1000) }),
      { nil: null },
    ),
    syncOffsetMs: int(-5000, 5000),
  })
  .map((r) => ({ ...structuredClone(DEFAULT_WEBCAM_SETTINGS), ...r }));

/** dB with a real chance of silence (`-Infinity`, not JSON-safe). */
const db = fc.oneof(fc.constant(Number.NEGATIVE_INFINITY), num(-60, 12));

const track: fc.Arbitrary<TrackSettings> = fc.record({
  volumeDb: db,
  muted: fc.boolean(),
  solo: fc.boolean(),
  normalize: fc.boolean(),
  fadeInMs: ms,
  fadeOutMs: ms,
});

const audio: fc.Arbitrary<AudioSettings> = fc.record({
  tracks: fc.record({
    mic: fc.tuple(track, fc.boolean()).map(([t, noiseReduction]) => ({ ...t, noiseReduction })),
    system: track,
  }),
  regions: withIds<AudioRegion>(
    fc
      // Zero-length spans included: the audio tab's addRegion can produce them.
      .tuple(
        fc.oneof(
          span,
          ms.map((s) => [s, s] as const),
        ),
        text,
        db,
        fc.boolean(),
        num(0, 30),
      )
      .map(([[startMs, endMs], name, volumeDb, loop, amountDb]) => ({
        fileName: name,
        path: `media/${name}.m4a`,
        startMs,
        endMs,
        volumeDb,
        fadeInMs: 0,
        fadeOutMs: 250,
        loop,
        duck: { enabled: !loop, amountDb },
      })),
    "a",
  ),
  master: fc.record({ volumeDb: db, muteAll: fc.boolean() }),
  clickVolume: num(0, 100),
});

const captions = withIds<Caption>(
  fc
    .tuple(span, fc.array(fc.tuple(text, int(0, 500)), { maxLength: 4 }))
    .map(([[startMs, endMs], words]) => ({
      startMs,
      endMs,
      text: words.map(([w]) => w).join(" "),
      words: words.map(([w, d], i) => ({ t0: startMs + i, t1: startMs + i + d, text: w })),
    })),
  "c",
);

const captionStyle: fc.Arbitrary<CaptionStyle> = fc.record({
  preset: fc.constantFrom("clean", "bold", "karaoke", "outline", "pill"),
  font: text,
  sizePx: num(1, 200),
  color: hex,
  bgColor: hex,
  bgOpacity: num(0, 100),
  position: fc.constantFrom("bottom", "top", "custom"),
  customY: num(0, 100),
  maxLines: int(1, 4),
  wordHighlight: fc.boolean(),
  highlightColor: hex,
  uppercase: fc.boolean(),
  outline: fc.boolean(),
});

const anim: fc.Arbitrary<AnnotationAnim> = fc.record({
  type: fc.constantFrom("none", "fade", "pop", "slide"),
  direction: fc.constantFrom("left", "right", "up", "down"),
  ms: int(0, 2000),
});

const annotations = withIds<Annotation>(
  fc
    .record({
      kind: fc.constantFrom(...ANNOTATION_KINDS),
      span,
      x: num(-1, 2),
      y: num(-1, 2),
      w: num(0, 1),
      h: num(0, 1),
      rotation: num(-360, 360),
      opacity: num(0, 1),
      followZoom: fc.boolean(),
      animIn: anim,
      animOut: anim,
      label: text,
      color: hex,
    })
    .map(({ kind, span: [startMs, endMs], label, color, ...base }) => {
      const props = structuredClone(DEFAULT_PROPS[kind]) as Record<string, unknown>;
      // Vary the per-kind string/color fields each kind actually has.
      for (const key of ["text", "label", "emoji", "src"]) if (key in props) props[key] = label;
      for (const key of ["color", "stroke", "fill"]) if (key in props) props[key] = color;
      return { ...base, ...props, startMs, endMs } as Omit<Annotation, "id">;
    }),
  "n",
  8,
);

const zoomRegions = withIds<ZoomRegion>(
  fc
    .record({
      span,
      level: num(1, 4),
      mode: fc.constantFrom("fixed" as const, "follow" as const),
      x: num(0, 1),
      y: num(0, 1),
      easeInMs: int(0, 3000),
      easeOutMs: int(0, 3000),
      curve: fc.constantFrom("ease-out-cubic" as const, "spring" as const, "linear" as const),
      source: fc.constantFrom("auto" as const, "manual" as const),
      reason: fc.option(text, { nil: undefined }),
    })
    .map(({ span: [startMs, endMs], mode, x, y, reason, ...rest }) => ({
      ...rest,
      startMs,
      endMs,
      focus: { mode, x, y },
      ...(reason === undefined ? {} : { reason }),
    })),
  "z",
);

const zoom: fc.Arbitrary<ZoomSettings> = fc.record({
  autoZoom: fc.record({
    sensitivity: num(0, 1),
    followCursor: fc.boolean(),
    zoomOnClicks: fc.boolean(),
    zoomOnTyping: fc.boolean(),
  }),
  camera: fc.record({ smoothing: num(0, 1), maxZoomSpeed: num(0.5, 10) }),
});

const titleCard: fc.Arbitrary<TitleCard> = fc.record({
  text,
  bg: hex,
  durationMs: num(500, 10_000),
});

const effects: fc.Arbitrary<EffectsSettings> = fc.record({
  transition: fc.record({ kind: fc.constantFrom(...TRANSITION_KINDS), durationMs: num(100, 2000) }),
  intro: fc.option(titleCard, { nil: null }),
  outro: fc.option(titleCard, { nil: null }),
  color: fc.record({
    brightness: num(-100, 100),
    contrast: num(-100, 100),
    saturation: num(-100, 100),
    grain: fc.boolean(),
    vignette: num(0, 100),
  }),
  motion: fc.record({ tilt3d: fc.boolean(), parallax: fc.boolean() }),
});

const speedRegions = withIds<SpeedRegionEdit>(
  fc
    .record({ span, rate: num(0.25, 8), keepPitch: fc.boolean(), rampInMs: ms, rampOutMs: ms })
    .map(({ span: [startMs, endMs], ...rest }) => ({ ...rest, startMs, endMs })),
  "s",
);

/** 1–4 contiguous clips with ids k1…kn (fixtures' transitions reference k1). */
const clips = fc
  .array(fc.tuple(ms, int(1, 60_000)), { minLength: 1, maxLength: 4 })
  .map((parts) => {
    let at = 0;
    return parts.map(([sourceStartMs, len], i) => {
      const clip = {
        id: `k${i + 1}`,
        sourceStartMs,
        sourceEndMs: sourceStartMs + len,
        timelineStartMs: at,
      };
      at += len;
      return clip;
    });
  });

const nullableId = fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null });

/** Schema-valid editor document state. `captionStatus` is always idle (transient). */
export const editorDataArb: fc.Arbitrary<EditorData> = fc.record({
  durationMs: ms,
  clips,
  frame,
  cursor,
  cursorPointCount: fc.option(int(0, 1_000_000), { nil: null }),
  zoom,
  zoomRegions,
  selectedZoomId: nullableId,
  webcam,
  audio,
  captions,
  captionStyle,
  captionModel: fc.constantFrom("fast", "balanced", "accurate"),
  captionLanguage: fc.constantFrom("auto", "en", "ja"),
  captionStatus: fc.constant({ kind: "idle" as const }),
  burnInCaptions: fc.boolean(),
  annotations,
  activeTool: fc.option(fc.constantFrom(...ANNOTATION_KINDS), { nil: null }),
  selectedAnnotationId: nullableId,
  effects,
  speedRegions,
  selectedSpeedId: nullableId,
  saveRawWithProject: fc.boolean(),
});
