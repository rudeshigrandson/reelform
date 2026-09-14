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
 * WebVTT (.vtt) sidecars (ENGINEERING_SPEC §9.6).
 *
 * Serialize: `WEBVTT` header, cues `HH:MM:SS.mmm --> HH:MM:SS.mmm`, text with
 * `&`, `<`, `>` escaped and `-->` defused. Parse: tolerant of BOM, CRLF, missing
 * hours, cue identifiers and cue settings (ignored); skips NOTE/STYLE/REGION
 * blocks; strips cue markup (`<c>`, `<v Name>`, inline timestamps) and decodes
 * entities. A missing header is a warning, not a failure.
 */

export function escapeVttText(line: string): string {
  return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: "\u00A0",
  lrm: "\u200E",
  rlm: "\u200F",
  quot: '"',
  apos: "'",
};

export function unescapeVttText(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) {
        const cp = Number.parseInt(name.slice(2), 16);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
      }
      if (name.startsWith("#")) {
        const cp = Number.parseInt(name.slice(1), 10);
        return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

export function serializeVtt(captions: readonly Caption[]): string {
  const out: string[] = ["WEBVTT", ""];
  for (const c of captions) {
    // Text lines containing "-->" would be read as timing lines; the escaped `&gt;` avoids that.
    const lines = textLines(c.text).map(escapeVttText);
    if (lines.length === 0) continue;
    const { startMs, endMs } = cueTimes(c);
    out.push(`${formatTimecode(startMs, ".")} --> ${formatTimecode(endMs, ".")}`, ...lines, "");
  }
  return out.join("\n");
}

const NON_CUE_BLOCK = /^(NOTE|STYLE|REGION)(\s|$)/;

export function parseVtt(text: string): SidecarParseResult {
  const warnings: SidecarWarning[] = [];
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  const blocks = splitBlocks(text);

  const first = blocks[0];
  if (first && /^WEBVTT(?:[ \t].*)?$/.test(first.lines[0] ?? "")) {
    // Header block: any following header lines belong to it too.
    blocks.shift();
  } else {
    warnings.push({ code: "missing-header", line: 1, message: "File does not start with WEBVTT" });
  }

  for (const block of blocks) {
    const head = block.lines[0] ?? "";
    if (NON_CUE_BLOCK.test(head) && !isTimingLine(head)) continue;
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
      .map((l) => unescapeVttText(l).trim())
      .filter((l) => l.length > 0);
    if (body.length === 0) {
      warnings.push({ code: "empty-cue", line: block.line, message: "Cue has no text" });
      continue;
    }
    cues.push({ ...timing, text: body.join("\n") });
  }
  return { captions: finalizeCaptions(cues), warnings };
}
