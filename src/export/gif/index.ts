export { ByteWriter } from "./byteWriter";
export {
  createGifEncoderClient,
  type GifEncoderClient,
  type GifEncoderClientDeps,
  type GifWorkerLike,
} from "./client";
export { type ColorLookup, createColorLookup } from "./colorLookup";
export { bayerSpread, type QuantizeOptions, quantizeRect, type Rect } from "./dither";
export { GifEncoder } from "./encoder";
export {
  Disposal,
  type DisposalMethod,
  writeGraphicControl,
  writeHeader,
  writeImage,
} from "./gifWriter";
export { lzwEncode, lzwMinCodeSize } from "./lzw";
export {
  buildPalette,
  ColorHistogram,
  clampColors,
  colorTableBits,
  medianCut,
  sampleFrameIndices,
  toColorTable,
} from "./palette";
export {
  type GifChunkMessage,
  type GifDoneMessage,
  type GifErrorMessage,
  type GifProgressMessage,
  type GifWorkerRequest,
  type GifWorkerResponse,
  gifEncoderOptionsSchema,
  gifWorkerRequestSchema,
} from "./protocol";
export {
  ESTIMATE_WINDOW_MS,
  estimateGifSize,
  gifDelayCs,
  gifFrameCount,
  gifFrameTimeMs,
  gifOutputSize,
  type SizeEstimate,
  type SizeEstimateInput,
} from "./timing";
export * from "./types";
export { createGifWorkerHost, type GifWorkerHost, type GifWorkerPost } from "./workerHost";
