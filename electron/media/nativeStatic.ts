import { PROGRESS_PREFIX, type TimeRange, sec } from "./args";
import { type VideoEncodeSettings, videoEncoderArgs } from "./encoders";
import { MediaError } from "./errors";

/**
 * `native-static` export route (ENGINEERING_SPEC §10.1 route 2): projects with
 * only frame styling + trims are rendered by one ffmpeg filter graph —
 * trim/concat → scale → rounded mask → shadow (drawbox approximation) →
 * overlay on a colour or image background → hardware H.264.
 */

export interface NativeStaticPlan {
  input: string;
  output: string;
  /** Source ranges in timeline order. */
  clips: readonly TimeRange[];
  source: { width: number; height: number; hasAudio: boolean };
  canvas: { width: number; height: number };
  fps: number;
  background: { kind: "color"; color: string } | { kind: "image"; path: string };
  /** Canvas px on each side reserved around the content. */
  padding: { top: number; right: number; bottom: number; left: number };
  radiusPx: number;
  /** `geq` computes the mask per frame; `png` uses a pre-rendered mask sized to the content. */
  mask?: { kind: "geq" } | { kind: "png"; path: string } | undefined;
  /** strength 0–100 (opacity), offsetY / blur in canvas px, colour #rrggbb. */
  shadow?: { strength: number; offsetY: number; blur: number; color: string } | undefined;
  encode: Omit<VideoEncodeSettings, "fps">;
  audioBitrateKbps?: number | undefined;
}

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/** Aspect-fit the source into the padded canvas box, centred, even dimensions. */
export function fitContent(
  plan: Pick<NativeStaticPlan, "canvas" | "padding"> & {
    source: { width: number; height: number };
  },
): ContentRect {
  const { source, canvas, padding } = plan;
  const boxW = Math.max(2, canvas.width - padding.left - padding.right);
  const boxH = Math.max(2, canvas.height - padding.top - padding.bottom);
  const scale = Math.min(boxW / source.width, boxH / source.height);
  const width = Math.min(even(source.width * scale), even(canvas.width));
  const height = Math.min(even(source.height * scale), even(canvas.height));
  const x = Math.round(padding.left + (boxW - width) / 2);
  const y = Math.round(padding.top + (boxH - height) / 2);
  return { x, y, width, height };
}

/** `#rrggbb` → ffmpeg `0xRRGGBB`. */
export function ffColor(hex: string, alpha?: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex))
    throw new MediaError("MEDIA_INVALID_ARGS", `bad colour ${hex}`);
  const base = `0x${hex.slice(1).toUpperCase()}`;
  return alpha === undefined
    ? base
    : `${base}@${Number(Math.min(1, Math.max(0, alpha)).toFixed(3))}`;
}

/** Rounded-corner alpha expression for `geq` (255 inside, 0 outside the arc). */
export function roundedMaskExpr(radius: number): string {
  const r = Math.max(0, Math.round(radius));
  return (
    `if(gt(abs(W/2-X),W/2-${r})*gt(abs(H/2-Y),H/2-${r}),` +
    `if(lte(hypot(${r}-(W/2-abs(W/2-X)),${r}-(H/2-abs(H/2-Y))),${r}),255,0),255)`
  );
}

export const SHADOW_LAYERS = 4;

/**
 * Soft shadow approximated by stacked filled boxes, each grown by blur/N. Alpha
 * blending compounds (`1 - (1 - a)^n`), so each layer carries the per-layer alpha
 * `a = 1 - (1 - opacity)^(1/N)`: the core, covered by all N layers, reaches the
 * configured strength and the outer rings fade out. Returns `drawbox` filters.
 */
export function shadowLayerAlpha(opacity: number, layers: number): number {
  const o = Math.min(1, Math.max(0, opacity));
  return 1 - (1 - o) ** (1 / Math.max(1, layers));
}

export function shadowBoxes(
  rect: ContentRect,
  shadow: NonNullable<NativeStaticPlan["shadow"]>,
): string[] {
  const opacity = Math.min(1, Math.max(0, shadow.strength / 100));
  if (!(opacity > 0)) return [];
  const layers = shadow.blur > 0 ? SHADOW_LAYERS : 1;
  const share = shadowLayerAlpha(opacity, layers);
  const out: string[] = [];
  for (let i = layers; i >= 1; i--) {
    const grow = shadow.blur > 0 ? Math.round((shadow.blur * i) / layers / 2) : 0;
    out.push(
      `drawbox=x=${rect.x - grow}:y=${Math.round(rect.y + shadow.offsetY) - grow}` +
        `:w=${rect.width + 2 * grow}:h=${rect.height + 2 * grow}` +
        `:color=${ffColor(shadow.color, share)}:t=fill`,
    );
  }
  return out;
}

/** Input list + filter graph. Input 0 = source; background / mask images follow. */
export function buildNativeStaticGraph(plan: NativeStaticPlan): {
  inputs: string[];
  graph: string;
  rect: ContentRect;
} {
  if (plan.clips.length === 0) throw new MediaError("MEDIA_INVALID_ARGS", "no clips");
  const evenInt = (n: number): boolean => Number.isInteger(n) && n >= 2 && n % 2 === 0;
  // yuv420p H.264 needs even output dimensions.
  if (
    !(plan.fps > 0) ||
    !Number.isFinite(plan.fps) ||
    !evenInt(plan.canvas.width) ||
    !evenInt(plan.canvas.height)
  ) {
    throw new MediaError("MEDIA_INVALID_ARGS", "invalid canvas or fps");
  }
  if (!(plan.source.width > 0) || !(plan.source.height > 0)) {
    throw new MediaError("MEDIA_INVALID_ARGS", "invalid source dimensions");
  }
  for (const c of plan.clips) {
    if (!(c.endMs > c.startMs) || c.startMs < 0) {
      throw new MediaError("MEDIA_INVALID_ARGS", `invalid clip ${c.startMs}–${c.endMs}`);
    }
  }
  const rect = fitContent(plan);
  const { width: W, height: H } = plan.canvas;
  const inputs: string[] = ["-i", plan.input];
  const f: string[] = [];
  const audio = plan.source.hasAudio;
  const n = plan.clips.length;

  // Trims + concat.
  plan.clips.forEach((c, i) => {
    f.push(`[0:v:0]trim=start=${sec(c.startMs)}:end=${sec(c.endMs)},setpts=PTS-STARTPTS[v${i}]`);
    if (audio)
      f.push(
        `[0:a:0]atrim=start=${sec(c.startMs)}:end=${sec(c.endMs)},asetpts=PTS-STARTPTS[a${i}]`,
      );
  });
  if (n === 1) {
    f.push("[v0]null[vc]");
    if (audio) f.push("[a0]anull[aout]");
  } else {
    const labels = plan.clips.map((_, i) => (audio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
    f.push(`${labels}concat=n=${n}:v=1:a=${audio ? 1 : 0}${audio ? "[vc][aout]" : "[vc]"}`);
  }

  // Content: scale, then rounded mask.
  const radius = Math.min(
    Math.max(0, Math.round(plan.radiusPx)),
    Math.floor(Math.min(rect.width, rect.height) / 2),
  );
  const scale = `scale=${rect.width}:${rect.height}:flags=lanczos,fps=${plan.fps}`;
  const mask = plan.mask ?? { kind: "geq" as const };
  if (radius === 0) {
    f.push(`[vc]${scale},format=yuv420p[content]`);
  } else if (mask.kind === "png") {
    const idx = inputs.filter((a) => a === "-i").length;
    inputs.push("-loop", "1", "-i", mask.path);
    f.push(`[vc]${scale},format=yuva420p[vs]`);
    f.push(`[${idx}:v]scale=${rect.width}:${rect.height},format=gray[mask]`);
    f.push("[vs][mask]alphamerge[content]");
  } else {
    const a = roundedMaskExpr(radius);
    f.push(
      `[vc]${scale},format=yuva444p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${a}'[content]`,
    );
  }

  // Background.
  if (plan.background.kind === "color") {
    f.push(`color=c=${ffColor(plan.background.color)}:s=${W}x${H}:r=${plan.fps}[bg]`);
  } else {
    const idx = inputs.filter((a) => a === "-i").length;
    inputs.push("-loop", "1", "-i", plan.background.path);
    f.push(
      `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${plan.fps},format=yuv420p[bg]`,
    );
  }

  // Shadow on the background, then overlay the content.
  const boxes = plan.shadow ? shadowBoxes(rect, plan.shadow) : [];
  if (boxes.length > 0) f.push(`[bg]${boxes.join(",")}[bgs]`);
  const bg = boxes.length > 0 ? "[bgs]" : "[bg]";
  f.push(
    `${bg}[content]overlay=x=${rect.x}:y=${rect.y}:shortest=1:format=auto,format=yuv420p[vout]`,
  );

  return { inputs, graph: f.join(";"), rect };
}

export function buildNativeStaticExportArgs(plan: NativeStaticPlan): string[] {
  const { inputs, graph } = buildNativeStaticGraph(plan);
  return [
    ...PROGRESS_PREFIX,
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[vout]",
    ...(plan.source.hasAudio
      ? [
          "-map",
          "[aout]",
          "-c:a",
          "aac",
          "-b:a",
          `${plan.audioBitrateKbps ?? 192}k`,
          "-ar",
          "48000",
        ]
      : ["-an"]),
    ...videoEncoderArgs({ ...plan.encode, fps: plan.fps }),
    "-r",
    String(plan.fps),
    "-movflags",
    "+faststart",
    plan.output,
  ];
}

/** Output duration (sum of clips), for the progress ratio. */
export function nativeStaticDurationMs(plan: Pick<NativeStaticPlan, "clips">): number {
  return plan.clips.reduce((acc, c) => acc + Math.max(0, c.endMs - c.startMs), 0);
}
