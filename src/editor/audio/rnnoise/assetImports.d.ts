/**
 * Vite asset-URL imports used by the bundled wasm / worklet / model assets
 * (RNNoise, face detection). The renderer CSP blocks CDN fetches, so these
 * files ship with the app and are referenced by URL.
 */

declare module "*?url" {
  const url: string;
  export default url;
}

declare module "*?worker&url" {
  const url: string;
  export default url;
}
