import wasmUrl from "@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url";
import workletUrl from "./rnnoise.worklet.ts?worker&url";

/**
 * Bundled RNNoise assets. Imported lazily by `index.ts` so tests (and the
 * node export paths that inject their own loaders) never resolve them.
 */
export const RNNOISE_WASM_URL: string = wasmUrl;
export const RNNOISE_WORKLET_URL: string = workletUrl;
