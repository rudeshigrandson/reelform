import { describe, expect, it, vi } from "vitest";
import {
  FACE_SAMPLE_COUNT,
  type FaceBox,
  type FaceDetectorLike,
  type VideoFrameSource,
  averageFaceCenter,
  bestFace,
  detectFaceCenter,
  faceSampleTimes,
} from "./faceDetect";

const SIZE = { width: 1280, height: 720 };
const face = (cx: number, cy: number, score = 0.9, w = 200, h = 200): FaceBox => ({
  x: cx - w / 2,
  y: cy - h / 2,
  width: w,
  height: h,
  score,
});

describe("faceSampleTimes", () => {
  it("spaces 10 samples through the video", () => {
    const t = faceSampleTimes(10_000);
    expect(t).toHaveLength(FACE_SAMPLE_COUNT);
    expect(t[0]).toBe(500);
    expect(t[9]).toBe(9500);
    expect(faceSampleTimes(0)).toEqual([0]);
    expect(faceSampleTimes(1000, 0)).toEqual([500]);
  });
});

describe("bestFace", () => {
  it("prefers confidence, then size, and drops weak or empty boxes", () => {
    expect(bestFace([face(100, 100, 0.6), face(500, 500, 0.95)])?.score).toBe(0.95);
    expect(bestFace([face(100, 100, 0.9, 50, 50), face(500, 500, 0.9, 300, 300)])?.width).toBe(300);
    expect(bestFace([face(100, 100, 0.2)])).toBeNull();
    expect(bestFace([{ x: 0, y: 0, width: 0, height: 10, score: 1 }])).toBeNull();
    expect(bestFace([])).toBeNull();
  });
});

describe("averageFaceCenter", () => {
  it("averages each frame's best face center, weighted by score, normalized to the source", () => {
    const c = averageFaceCenter(
      [[face(640, 360, 1)], [face(960, 360, 1), face(100, 100, 0.55)], [], [face(320, 540, 0.5)]],
      SIZE,
    );
    // (0.5·1 + 0.75·1 + 0.25·0.5) / 2.5 = 0.55; (0.5 + 0.5 + 0.75·0.5) / 2.5 = 0.55
    expect(c?.x).toBeCloseTo(0.55, 10);
    expect(c?.y).toBeCloseTo(0.55, 10);
  });

  it("returns null without faces or with an unknown size, and clamps to 0..1", () => {
    expect(averageFaceCenter([[], []], SIZE)).toBeNull();
    expect(averageFaceCenter([[face(10, 10)]], { width: 0, height: 720 })).toBeNull();
    expect(averageFaceCenter([[face(2000, -300)]], SIZE)).toEqual({ x: 1, y: 0 });
  });
});

describe("detectFaceCenter", () => {
  function video(durationMs = 5000): VideoFrameSource & { seeks: number[]; disposed: boolean } {
    const v = {
      size: SIZE,
      durationMs,
      seeks: [] as number[],
      disposed: false,
      async frameAt(t: number) {
        v.seeks.push(t);
        return { t } as unknown as TexImageSource;
      },
      dispose() {
        v.disposed = true;
      },
    };
    return v;
  }

  it("runs the injected detector on 10 sampled frames and averages the faces", async () => {
    const v = video();
    const close = vi.fn();
    const detector: FaceDetectorLike = {
      detect: (frame) => {
        const t = (frame as unknown as { t: number }).t;
        // Face drifts right over time; frames past 4s have no face.
        return t > 4000 ? [] : [face(400 + t / 10, 300)];
      },
      close,
    };
    const center = await detectFaceCenter("reelform-media://p/cam.mp4", {
      createDetector: async () => detector,
      openVideo: async () => v,
    });
    expect(v.seeks).toEqual(faceSampleTimes(5000));
    // Frames at 250…3750ms vote: mean x = 400 + 2000/10 = 600.
    expect(center?.x).toBeCloseTo(600 / 1280, 10);
    expect(center?.y).toBeCloseTo(300 / 720, 10);
    expect(close).toHaveBeenCalledTimes(1);
    expect(v.disposed).toBe(true);
  });

  it("skips frames that fail and resolves null when detection can't start", async () => {
    const v = video(2000);
    let calls = 0;
    const flaky: FaceDetectorLike = {
      detect: () => {
        calls += 1;
        if (calls % 2 === 0) throw new Error("detector hiccup");
        return [face(640, 360)];
      },
      close: () => {},
    };
    expect(
      await detectFaceCenter("u", { createDetector: async () => flaky, openVideo: async () => v }),
    ).toEqual({ x: 0.5, y: 0.5 });

    const other = video();
    expect(
      await detectFaceCenter("u", {
        createDetector: () => Promise.reject(new Error("wasm blocked")),
        openVideo: async () => other,
      }),
    ).toBeNull();
    expect(
      await detectFaceCenter("u", {
        createDetector: async () => flaky,
        openVideo: () => Promise.reject(new Error("no video")),
      }),
    ).toBeNull();
  });
});
