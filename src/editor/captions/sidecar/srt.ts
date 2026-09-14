import type { Caption } from "../../inspector/captions/types";
import {
  type SidecarParseResult,
  type SidecarWarning,
  cueTimes,
  finalizeCaptions,
  splitBlocks,
  textLines,
} from "./common";
import { formatTimecode, isTimingLine, parseTimingLine } from "./timecode";

/**
 * SubRip (.srt) sidecars (ENGINEERING_SPEC §9.6).
 *
 * Serialize: 1-based index, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, text lines, blank
 * line; CRLF-free. Captions with no text after trimming are omitted.
 * Parse: tolerant of BOM, CRLF, missing indices, `.` milliseconds, cue settings;
 * basic formatting tags (`<i>`, `<b>`, `<u>`, `<font …>`, `{\an8}`) are stripped.
 * Malformed cues are skipped with a warning.
 */

const FORMAT_TAG = /<\/?(?:i|b|u|font)(?:\s[^>]*)?>|\{\\[^}]*\}/gi;

export function serializeSrt(captions: readonly Caption[]): string {
  const out: string[] = [];
  let index = 1;
  for (const c of captions) {
    const lines = textLines(c.text);
    if (lines.length === 0) continue;
    const { startMs, endMs } = cueTimes(c);
    out.push(
      String(index++),
      `${formatTimecode(startMs, ",")} --> ${formatTimecode(endMs, ",")}`,
      ...lines,
      "",
    );
  }
  return out.join("\n");
}

export function parseSrt(text: string): SidecarParseResult {
  const warnings: SidecarWarning[] = [];
  const cues: { startMs: number; endMs: number; text: string }[] = [];

  for (const block of splitBlocks(text)) {
    const timingIdx = block.lines.findIndex((l, i) => i <= 1 && isTimingLine(l));
    if (timingIdx < 0) {
      warnings.push({
        code: "missing-timing",
        line: block.line,
        message: "Cue has no timing line",
      });
      continue;
    }
    const timingLine = block.lines[timingIdx] ?? "";
    const timing = parseTimingLine(timingLine);
    if (timing === null) {
      warnings.push({
        code: "bad-timing",
        line: block.line + timingIdx,
        message: `Bad timing: ${timingLine.trim()}`,
      });
      continue;
    }
    if (timing.endMs < timing.startMs) {
      warnings.push({
        code: "end-before-start",
        line: block.line + timingIdx,
        message: "Cue ends before it starts",
      });
      continue;
    }
    const body = block.lines
      .slice(timingIdx + 1)
      .map((l) => l.replace(FORMAT_TAG, "").trim())
      .filter((l) => l.length > 0);
    if (body.length === 0) {
      warnings.push({ code: "empty-cue", line: block.line, message: "Cue has no text" });
      continue;
    }
    cues.push({ ...timing, text: body.join("\n") });
  }
  return { captions: finalizeCaptions(cues), warnings };
}
