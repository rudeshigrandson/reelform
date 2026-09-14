import fc from "fast-check";
import {
  type NativeStaticPlan,
  buildNativeStaticExportArgs,
  buildNativeStaticGraph,
  ffColor,
  fitContent,
  nativeStaticDurationMs,
  roundedMaskExpr,
  shadowBoxes,
  shadowLayerAlpha,
} from "./nativeStatic";

const plan = (over: Partial<NativeStaticPlan> = {}): NativeStaticPlan => ({
  input: "/p/screen.mp4",
  output: "/p/export.mp4",
  clips: [{ startMs: 0, endMs: 5000 }],
  source: { width: 1920, height: 1080, hasAudio: true },
  canvas: { width: 1920, height: 1080 },
  fps: 60,
  background: { kind: "color", color: "#112233" },
  padding: { top: 64, right: 64, bottom: 64, left: 64 },
  radiusPx: 12,
  shadow: { strength: 50, offsetY: 12, blur: 40, color: "#000000" },
  encode: { encoder: "h264_videotoolbox", bitrateKbps: 16000 },
  ...over,
});

const argAfter = (args: readonly string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1];

describe("native-static export (§10.1 route 2)", () => {
  it("fits content into the padded box, centred with even dims", () => {
    expect(fitContent(plan())).toEqual({ x: 114, y: 64, width: 1692, height: 952 });
  });

  it("property: content rect is even, inside the padded box, aspect preserved", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 64, max: 7680 }),
        fc.integer({ min: 64, max: 7680 }),
        fc.integer({ min: 16, max: 7680 }),
        fc.integer({ min: 16, max: 7680 }),
        fc.integer({ min: 0, max: 200 }),
        (cw, ch, sw, sh, pad) => {
          fc.pre(2 * pad < cw - 4 && 2 * pad < ch - 4);
          const r = fitContent({
            source: { width: sw, height: sh },
            canvas: { width: cw, height: ch },
            padding: { top: pad, right: pad, bottom: pad, left: pad },
          });
          expect(r.width % 2).toBe(0);
          expect(r.height % 2).toBe(0);
          expect(r.x).toBeGreaterThanOrEqual(pad);
          expect(r.y).toBeGreaterThanOrEqual(pad);
          expect(r.x + r.width).toBeLessThanOrEqual(cw - pad + 1);
          expect(r.y + r.height).toBeLessThanOrEqual(ch - pad + 1);
          // Either dimension touches the box (within even rounding), so nothing is needlessly small.
          expect(Math.min(cw - 2 * pad - r.width, ch - 2 * pad - r.height)).toBeLessThanOrEqual(2);
        },
      ),
    );
  });

  it("single clip graph: trim, geq rounded mask, colour bg, stacked shadow, overlay", () => {
    const { graph, inputs } = buildNativeStaticGraph(plan());
    expect(inputs).toEqual(["-i", "/p/screen.mp4"]);
    expect(graph).toContain("[0:v:0]trim=start=0:end=5,setpts=PTS-STARTPTS[v0]");
    expect(graph).toContain("[0:a:0]atrim=start=0:end=5,asetpts=PTS-STARTPTS[a0]");
    expect(graph).toContain("[a0]anull[aout]");
    expect(graph).toContain("scale=1692:952:flags=lanczos,fps=60,format=yuva444p,geq=");
    expect(graph).toContain("color=c=0x112233:s=1920x1080:r=60[bg]");
    expect(graph.match(/drawbox=/g)).toHaveLength(4);
    expect(graph).toContain("[bgs][content]overlay=x=114:y=64:shortest=1");
    expect(graph.endsWith("[vout]")).toBe(true);
  });

  it("multi clip concat without audio", () => {
    const { graph } = buildNativeStaticGraph(
      plan({
        clips: [
          { startMs: 0, endMs: 1000 },
          { startMs: 3000, endMs: 4000 },
        ],
        source: { width: 1920, height: 1080, hasAudio: false },
      }),
    );
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[vc]");
    expect(graph).not.toContain("atrim");
  });

  it("image background and png mask become looped inputs with correct indices", () => {
    const { inputs, graph } = buildNativeStaticGraph(
      plan({
        mask: { kind: "png", path: "/tmp/mask.png" },
        background: { kind: "image", path: "/p/media/bg.jpg" },
      }),
    );
    expect(inputs).toEqual([
      "-i",
      "/p/screen.mp4",
      "-loop",
      "1",
      "-i",
      "/tmp/mask.png",
      "-loop",
      "1",
      "-i",
      "/p/media/bg.jpg",
    ]);
    expect(graph).toContain("[1:v]scale=1692:952,format=gray[mask]");
    expect(graph).toContain("[vs][mask]alphamerge[content]");
    expect(graph).toContain(
      "[2:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    );
  });

  it("zero radius skips the mask; zero-strength shadow skips drawbox", () => {
    const { graph } = buildNativeStaticGraph(
      plan({ radiusPx: 0, shadow: { strength: 0, offsetY: 0, blur: 0, color: "#000000" } }),
    );
    expect(graph).not.toContain("geq");
    expect(graph).not.toContain("drawbox");
    expect(graph).toContain("[bg][content]overlay");
  });

  it("radius clamps to half the content size", () => {
    const { graph } = buildNativeStaticGraph(
      plan({
        radiusPx: 5000,
        canvas: { width: 200, height: 100 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    );
    expect(graph).toContain(roundedMaskExpr(50));
  });

  it("shadow layers cumulate to the configured opacity", () => {
    const boxes = shadowBoxes(
      { x: 100, y: 100, width: 200, height: 100 },
      { strength: 80, offsetY: 10, blur: 40, color: "#000000" },
    );
    expect(boxes).toHaveLength(4);
    // 1 - (1 - 0.8)^(1/4) = 0.331 per layer; four layers compound back to 0.8.
    expect(boxes[0]).toBe("drawbox=x=80:y=90:w=240:h=140:color=0x000000@0.331:t=fill");
    expect(boxes[3]).toBe("drawbox=x=95:y=105:w=210:h=110:color=0x000000@0.331:t=fill");
    expect(
      shadowBoxes(
        { x: 0, y: 0, width: 10, height: 10 },
        { strength: 100, offsetY: 0, blur: 0, color: "#ffffff" },
      ),
    ).toEqual(["drawbox=x=0:y=0:w=10:h=10:color=0xFFFFFF@1:t=fill"]);
  });

  it("property: stacked shadow layers composite to exactly the configured strength at the core", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 8 }), (s, n) => {
        const a = shadowLayerAlpha(s / 100, n);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(1 - (1 - a) ** n).toBeCloseTo(s / 100, 9);
        // Outer ring (one layer) never exceeds the core.
        expect(a).toBeLessThanOrEqual(s / 100 + 1e-12);
      }),
    );
  });

  it("rejects odd or non-integer canvas and degenerate source dimensions", () => {
    for (const canvas of [
      { width: 1921, height: 1080 },
      { width: 1920, height: 1079 },
      { width: 1920.5, height: 1080 },
    ]) {
      expect(() => buildNativeStaticGraph(plan({ canvas }))).toThrow(/invalid canvas/);
    }
    expect(() => buildNativeStaticGraph(plan({ fps: Number.POSITIVE_INFINITY }))).toThrow(
      /invalid canvas/,
    );
    expect(() =>
      buildNativeStaticGraph(plan({ source: { width: 0, height: 1080, hasAudio: false } })),
    ).toThrow(/invalid source/);
  });

  it("full args: audio aac, hw encoder, fps and output last", () => {
    const a = buildNativeStaticExportArgs(plan());
    expect(argAfter(a, "-c:v")).toBe("h264_videotoolbox");
    expect(argAfter(a, "-c:a")).toBe("aac");
    expect(a.filter((x) => x === "-map")).toHaveLength(2);
    expect(argAfter(a, "-r")).toBe("60");
    expect(a.at(-1)).toBe("/p/export.mp4");
    const silent = buildNativeStaticExportArgs(
      plan({ source: { width: 1920, height: 1080, hasAudio: false } }),
    );
    expect(silent).toContain("-an");
    expect(silent).not.toContain("[aout]");
  });

  it("validation and helpers", () => {
    expect(() => buildNativeStaticGraph(plan({ clips: [] }))).toThrow(
      expect.objectContaining({ code: "MEDIA_INVALID_ARGS" }),
    );
    expect(() => buildNativeStaticGraph(plan({ clips: [{ startMs: 5, endMs: 1 }] }))).toThrow(
      /invalid clip/,
    );
    expect(() => buildNativeStaticGraph(plan({ fps: 0 }))).toThrow(/invalid canvas/);
    expect(() => ffColor("red")).toThrow(/bad colour/);
    expect(ffColor("#abcdef", 2)).toBe("0xABCDEF@1");
    expect(
      nativeStaticDurationMs({
        clips: [
          { startMs: 0, endMs: 1000 },
          { startMs: 5000, endMs: 5500 },
        ],
      }),
    ).toBe(1500);
  });
});
