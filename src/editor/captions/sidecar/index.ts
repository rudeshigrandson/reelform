import type { Caption } from "../../inspector/captions/types";
import type { SidecarParseResult } from "./common";
import { parseSrt, serializeSrt } from "./srt";
import { parseVtt, serializeVtt } from "./vtt";

/** SRT / WebVTT sidecar import + export (ENGINEERING_SPEC §9.6). */

export type SidecarFormat = "srt" | "vtt";

export type { SidecarParseResult, SidecarWarning, SidecarWarningCode } from "./common";
export { parseSrt, serializeSrt } from "./srt";
export { escapeVttText, parseVtt, serializeVtt, unescapeVttText } from "./vtt";
export { formatTimecode, parseTimecode, parseTimingLine } from "./timecode";

/** Guess the format from a file name, falling back to sniffing the content. */
export function detectSidecarFormat(text: string, fileName?: string | undefined): SidecarFormat {
  const ext = fileName?.toLowerCase().match(/\.(srt|vtt)$/)?.[1];
  if (ext === "srt" || ext === "vtt") return ext;
  return /^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(text) ? "vtt" : "srt";
}

export function parseSidecar(
  text: string,
  format?: SidecarFormat | undefined,
  fileName?: string | undefined,
): SidecarParseResult {
  const fmt = format ?? detectSidecarFormat(text, fileName);
  return fmt === "vtt" ? parseVtt(text) : parseSrt(text);
}

export function serializeSidecar(captions: readonly Caption[], format: SidecarFormat): string {
  return format === "vtt" ? serializeVtt(captions) : serializeSrt(captions);
}
