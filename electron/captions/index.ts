/** Public surface of the main-process captions runtime (ENGINEERING_SPEC §9.6). */

export { MAX_CHUNK_MS, planChunks } from "./chunks";
export type { TimeSpan } from "./chunks";
export {
  CaptionSchema,
  CaptionsProgressSchema,
  ModelIdSchema,
  ModelInfoSchema,
  captionsContracts,
  captionsEvents,
} from "./contracts";
export type { CaptionsContracts, CaptionsEvents, CaptionsProgress, ModelInfo } from "./contracts";
export { downloadFile, parseContentRange, partialPathFor } from "./download";
export type {
  DownloadDeps,
  DownloadFs,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  FetchLike,
  FetchResponseLike,
  FileWriter,
  Hasher,
} from "./download";
export { CaptionsError, isCaptionsError } from "./errors";
export type { CaptionsErrorCode } from "./errors";
export { DOWNLOAD_EMIT_BYTES, createCaptionsHandlers } from "./handlers";
export type { CaptionsDeps, CaptionsHandlers } from "./handlers";
export {
  DEFAULT_MODEL_FOR_TIER,
  HF_REPO,
  HF_REVISION,
  MODEL_CATALOG,
  MODEL_IDS,
  findModel,
  isSha256Hex,
} from "./models";
export type { ModelId, ModelSpec, ModelTier } from "./models";
export { nodeDownloadFs, nodeFetch, nodeSha256, nodeTranscribeFs } from "./nodeDeps";
export { resolveWhisperBinary, whisperBinaryCandidates, whisperBinaryName } from "./runtime";
export type { RuntimeEnv } from "./runtime";
export {
  CAPTION_SEGMENT_OPTIONS,
  EXTRACT_WEIGHT,
  effectiveLanguage,
  transcribe,
} from "./transcribe";
export type {
  AudioRange,
  SilenceSplitter,
  TranscribeDeps,
  TranscribeFs,
  TranscribeProgress,
  TranscribeRequest,
  TranscribeResult,
  WavExtractor,
} from "./transcribe";
export { buildWhisperArgs, parseWhisperProgress, runWhisper } from "./whisperCli";
export type { ChildLike, SpawnFn } from "./whisperCli";
export { parseWhisperJson } from "./whisperJson";
export type { WhisperParseResult } from "./whisperJson";
