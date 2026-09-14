import type { Word } from "../../src/editor/captions/types";
import { CaptionsError } from "./errors";

/**
 * Parser for whisper.cpp `--output-json-full` files (ENGINEERING_SPEC §9.6).
 *
 * Shape (abridged):
 * ```json
 * { "result": { "language": "en" },
 *   "transcription": [
 *     { "offsets": { "from": 0, "to": 2400 }, "text": " Hello world.",
 *       "tokens": [ { "text": "[_BEG_]", "offsets": {...} },
 *                   { "text": " Hello", "offsets": { "from": 0, "to": 600 } },
 *                   { "text": " wor", ... }, { "text": "ld", ... }, { "text": ".", ... } ] } ] }
 * ```
 * Tokens are sub-word pieces: a token starting with whitespace opens a word,
 * others glue onto the previous word. Special tokens (`[_BEG_]`, `[_TT_42]`,
 * `<|endoftext|>`) and non-speech annotations (`[BLANK_AUDIO]`, `(music)`) are
 * dropped. Offsets are milliseconds relative to the chunk's WAV.
 */

export interface WhisperParseResult {
  words: Word[];
  language: string | null;
}

interface RawOffsets {
  from: number;
  to: number;
}

const SPECIAL_TOKEN = /^\s*(\[_[^\]]*\]|<\|[^|]*\|>)\s*$/;
/** Whole-word/segment annotations whisper emits for non-speech. */
const NON_SPEECH = /^[[(*♪].*[\])*♪]$/u;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readOffsets(v: unknown): RawOffsets | null {
  if (!isRecord(v)) return null;
  const { from, to } = v;
  if (typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to: Math.max(from, to) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface Draft {
  text: string;
  t0: number;
  t1: number;
}

/** Fallback when a segment has no usable tokens: spread its words by char length. */
function wordsFromText(text: string, seg: RawOffsets): Draft[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total === 0) return [];
  const span = seg.to - seg.from;
  const out: Draft[] = [];
  let acc = 0;
  for (const p of parts) {
    const t0 = seg.from + (span * acc) / total;
    acc += p.length;
    out.push({ text: p, t0, t1: seg.from + (span * acc) / total });
  }
  return out;
}

function wordsFromTokens(tokens: readonly unknown[], seg: RawOffsets): Draft[] | null {
  const out: Draft[] = [];
  let usable = 0;
  for (const tok of tokens) {
    if (!isRecord(tok) || typeof tok.text !== "string") continue;
    const text = tok.text;
    if (text.length === 0 || SPECIAL_TOKEN.test(text)) continue;
    const off = readOffsets(tok.offsets);
    if (off === null) continue;
    usable++;
    const t0 = clamp(off.from, seg.from, seg.to);
    const t1 = clamp(off.to, t0, seg.to);
    const opensWord = /^\s/.test(text) || out.length === 0;
    const piece = text.trim();
    if (piece.length === 0) continue;
    const last = out[out.length - 1];
    if (opensWord || last === undefined) {
      out.push({ text: piece, t0, t1 });
    } else {
      last.text += piece;
      last.t1 = Math.max(last.t1, t1);
    }
  }
  return usable > 0 ? out : null;
}

/** Parse whisper JSON text. `offsetMs` shifts every timestamp (chunk start). */
export function parseWhisperJson(json: string, offsetMs = 0): WhisperParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (err) {
    throw new CaptionsError("whisper-output-invalid", "Whisper output is not valid JSON", {
      cause: String(err),
    });
  }
  if (!isRecord(doc) || !Array.isArray(doc.transcription)) {
    throw new CaptionsError("whisper-output-invalid", "Whisper output has no transcription array");
  }
  const language =
    isRecord(doc.result) && typeof doc.result.language === "string" ? doc.result.language : null;

  const words: Word[] = [];
  let floor = 0;
  for (const seg of doc.transcription) {
    if (!isRecord(seg)) continue;
    const segOff = readOffsets(seg.offsets);
    if (segOff === null) continue;
    const segText = typeof seg.text === "string" ? seg.text.trim() : "";
    if (segText !== "" && NON_SPEECH.test(segText)) continue;

    const drafts =
      (Array.isArray(seg.tokens) ? wordsFromTokens(seg.tokens, segOff) : null) ??
      wordsFromText(segText, segOff);

    for (const d of drafts) {
      if (NON_SPEECH.test(d.text) || SPECIAL_TOKEN.test(d.text)) continue;
      // Keep words monotonic: whisper occasionally overlaps segment edges.
      const t0 = Math.max(floor, Math.round(d.t0));
      const t1 = Math.max(t0, Math.round(d.t1));
      floor = t0;
      words.push({ text: d.text, t0: t0 + offsetMs, t1: t1 + offsetMs });
    }
  }
  return { words, language };
}
