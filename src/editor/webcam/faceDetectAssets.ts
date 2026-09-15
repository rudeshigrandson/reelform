import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import modelUrl from "./models/blaze_face_short_range.tflite?url";

/**
 * Bundled face-detection assets (ENGINEERING_SPEC §9.4). The renderer CSP
 * blocks CDN fetches, so the MediaPipe wasm runtime and the BlazeFace
 * short-range model ship with the app. Imported lazily by `faceDetect.ts`.
 */
export const FACE_WASM_LOADER_URL: string = wasmLoaderUrl;
export const FACE_WASM_BINARY_URL: string = wasmBinaryUrl;
export const FACE_MODEL_URL: string = modelUrl;
