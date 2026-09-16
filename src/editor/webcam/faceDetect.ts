/**
 * "Center on face" for the webcam crop (ENGINEERING_SPEC §9.4): sample 10
 * frames from the webcam video, run face detection on each, and average the
 * face centers, normalized to the source frame (0..1). Resolves null when no
 * face is found or detection can't run, so the crop modal falls back to center.
 *
 * The detector and the frame source are injected; the defaults use
 * `@mediapipe/tasks-vision` (BlazeFace short range, bundled locally) and an
 * offscreen <video>.
 */

export const FACE_SAMPLE_COUNT = 10;
/** Faces below this confidence are ignored. */
export const MIN_FACE_SCORE = 0.5;
const METADATA_TIMEOUT_MS = 10_000;
const SEEK_TIMEOUT_MS = 5_000;

export interface Size {
  width: number;
  height: number;
}

/** A detected face in frame pixels. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 confidence. */
  score: number;
}

export interface FaceDetectorLike {
  detect(frame: TexImageSource): FaceBox[];
  close(): void;
}

export interface VideoFrameSource {
  size: Size;
  durationMs: number;
  /** Seek and return a drawable frame at `tMs`. */
  frameAt(tMs: number): Promise<TexImageSource>;
  dispose(): void;
}

export interface FaceDetectDeps {
  createDetector?: (() => Promise<FaceDetectorLike>) | undefined;
  openVideo?: ((url: string) => Promise<VideoFrameSource>) | undefined;
  sampleCount?: number | undefined;
}

/** Evenly spaced sample times, each in the middle of its slice of the video. */
export function faceSampleTimes(durationMs: number, count = FACE_SAMPLE_COUNT): number[] {
  const n = Math.max(1, Math.floor(count));
  if (!(durationMs > 0)) return [0];
  return Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * durationMs);
}

/** The most confident face in a frame (ties → larger box), or null. */
export function bestFace(faces: readonly FaceBox[]): FaceBox | null {
  let best: FaceBox | null = null;
  for (const f of faces) {
    if (!(f.score >= MIN_FACE_SCORE) || !(f.width > 0) || !(f.height > 0)) continue;
    if (
      best === null ||
      f.score > best.score ||
      (f.score === best.score && f.width * f.height > best.width * best.height)
    ) {
      best = f;
    }
  }
  return best;
}

/**
 * Score-weighted mean of each frame's best face center, normalized to `size`
 * and clamped to 0..1. Null when no frame has a face.
 */
export function averageFaceCenter(
  frames: readonly (readonly FaceBox[])[],
  size: Size,
): { x: number; y: number } | null {
  if (!(size.width > 0) || !(size.height > 0)) return null;
  let sx = 0;
  let sy = 0;
  let w = 0;
  for (const faces of frames) {
    const f = bestFace(faces);
    if (!f) continue;
    const cx = (f.x + f.width / 2) / size.width;
    const cy = (f.y + f.height / 2) / size.height;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    sx += cx * f.score;
    sy += cy * f.score;
    w += f.score;
  }
  if (w <= 0) return null;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp01(sx / w), y: clamp01(sy / w) };
}

export async function detectFaceCenter(
  webcamUrl: string,
  deps: FaceDetectDeps = {},
): Promise<{ x: number; y: number } | null> {
  const createDetector = deps.createDetector ?? createMediaPipeFaceDetector;
  const openVideo = deps.openVideo ?? openOffscreenVideo;
  let detector: FaceDetectorLike | null = null;
  let video: VideoFrameSource | null = null;
  try {
    [detector, video] = await Promise.all([createDetector(), openVideo(webcamUrl)]);
    const frames: FaceBox[][] = [];
    for (const t of faceSampleTimes(video.durationMs, deps.sampleCount)) {
      try {
        frames.push(detector.detect(await video.frameAt(t)));
      } catch {
        // A frame that fails to seek or detect just doesn't vote.
      }
    }
    return averageFaceCenter(frames, video.size);
  } catch {
    return null;
  } finally {
    detector?.close();
    video?.dispose();
  }
}

// ── Defaults ─────────────────────────────────────────────────────────────────

async function createMediaPipeFaceDetector(): Promise<FaceDetectorLike> {
  const [vision, assets] = await Promise.all([
    import("@mediapipe/tasks-vision"),
    import("./faceDetectAssets"),
  ]);
  const detector = await vision.FaceDetector.createFromOptions(
    { wasmLoaderPath: assets.FACE_WASM_LOADER_URL, wasmBinaryPath: assets.FACE_WASM_BINARY_URL },
    {
      baseOptions: { modelAssetPath: assets.FACE_MODEL_URL, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: MIN_FACE_SCORE,
    },
  );
  return {
    detect(frame) {
      return detector.detect(frame).detections.flatMap((d) =>
        d.boundingBox
          ? [
              {
                x: d.boundingBox.originX,
                y: d.boundingBox.originY,
                width: d.boundingBox.width,
                height: d.boundingBox.height,
                score: d.categories[0]?.score ?? 0,
              },
            ]
          : [],
      );
    },
    close() {
      detector.close();
    },
  };
}

function once(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("The webcam video couldn't be read."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener("error", fail);
  });
}

async function openOffscreenVideo(url: string): Promise<VideoFrameSource> {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  const loaded = once(el, "loadeddata", METADATA_TIMEOUT_MS);
  el.src = url;
  el.load();
  await loaded;
  const dispose = () => {
    el.removeAttribute("src");
    el.load();
  };
  return {
    size: { width: el.videoWidth, height: el.videoHeight },
    durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
    async frameAt(tMs) {
      const target = Math.max(0, tMs / 1000);
      if (Math.abs(el.currentTime - target) > 1e-3) {
        const seeked = once(el, "seeked", SEEK_TIMEOUT_MS);
        el.currentTime = target;
        await seeked;
      }
      return el;
    },
    dispose,
  };
}
