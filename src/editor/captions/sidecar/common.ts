import type { Caption } from "../../inspector/captions/types";

/** Shared helpers for SRT/WebVTT parsing and serialization. */

export type SidecarWarningCode =
  | "missing-header"
  | "missing-timing"
  | "bad-timing"
  | "end-before-start"
  | "empty-cue";

export interface SidecarWarning {
  code: SidecarWarningCode;
  /** 1-based line number of the offending cue block. */
  line: number;
  message: string;
}

export interface SidecarParseResult {
  captions: Caption[];
  warnings: SidecarWarning[];
}

export interface Block {
  /** 1-based line number of the first line. */
  line: number;
  lines: string[];
}

/** Strip a UTF-8 BOM, normalise CRLF/CR, split into blank-line separated blocks. */
export function splitBlocks(text: string): Block[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;
  lines.forEach((raw, i) => {
    if (raw.trim() === "") {
      current = null;
      return;
    }
    if (current === null) {
      current = { line: i + 1, lines: [] };
      blocks.push(current);
    }
    current.lines.push(raw);
  });
  return blocks;
}

/** Caption text as serialisable lines: trimmed, no blank lines (they end a cue). */
export function textLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Order by start (stable) and assign deterministic ids. */
export function finalizeCaptions(
  cues: readonly { startMs: number; endMs: number; text: string }[],
): Caption[] {
  return cues
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startMs - b.c.startMs || a.i - b.i)
    .map(({ c }, i) => ({
      id: `cap-${i}`,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      words: [],
    }));
}

/** Clamp serialised times: non-negative integers with end ≥ start. */
export function cueTimes(c: Pick<Caption, "startMs" | "endMs">): {
  startMs: number;
  endMs: number;
} {
  const startMs = Number.isFinite(c.startMs) ? Math.max(0, Math.round(c.startMs)) : 0;
  const rawEnd = Number.isFinite(c.endMs) ? Math.round(c.endMs) : startMs;
  return { startMs, endMs: Math.max(startMs, rawEnd) };
}
