/** Public surface of the caption-segmentation module (ENGINEERING_SPEC §9.6). */

export type {
  Caption,
  ResolvedSegmentOptions,
  SegmentOptions,
  Word,
} from "./types.js";
export { endsSentence, segmentCaptions } from "./segment.js";
export { wrapText, wrapWords } from "./wrap.js";
export type { WrapResult } from "./wrap.js";
