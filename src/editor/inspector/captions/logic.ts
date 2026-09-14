import type { Caption, Word } from "./types";

/**
 * Pure caption-list editing + serialization (design guide S18, ENGINEERING_SPEC §9.6).
 *
 * Invariant for every list these functions return (given a valid input list):
 * sorted by `startMs`, each caption `startMs < endMs`, no overlap
 * (`prev.endMs <= next.startMs`), ids unique. Deterministic — no clocks/randomness.
 */

const tokens = (text: string): string[] => text.split(/\s+/u).filter((t) => t.length > 0);

/** True when the list is sorted, non-overlapping, positive-duration, with unique ids. */
export function isValidCaptionList(captions: readonly Caption[]): boolean {
  const ids = new Set<string>();
  let prevEnd = -Infinity;
  for (const c of captions) {
    if (ids.has(c.id)) return false;
    ids.add(c.id);
    if (!(c.startMs < c.endMs)) return false;
    if (c.startMs < prevEnd) return false;
    prevEnd = c.endMs;
  }
  return true;
}

/** `base` if unused, else `base-2`, `base-3`, … */
export function uniqueId(captions: readonly Caption[], base: string): string {
  const taken = new Set(captions.map((c) => c.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export interface SplitResult {
  captions: Caption[];
  /** Id of the new second half (focus target, caret at 0). */
  newId: string;
}

/**
 * Split caption `id` at text `cursor` (Enter). Time splits proportionally to
 * the caret's character position, nudged to a word gap when word timings
 * align with the text. Returns null when the split would leave an empty half
 * or a zero-length caption.
 */
export function splitCaption(captions: readonly Caption[], id: string, cursor: number): SplitResult | null {
  const index = captions.findIndex((c) => c.id === id);
  const cap = captions[index];
  if (!cap) return null;
  const len = cap.text.length;
  if (cursor <= 0 || cursor >= len) return null;
  const leftText = cap.text.slice(0, cursor).trimEnd();
  const rightText = cap.text.slice(cursor).trimStart();
  if (leftText.length === 0 || rightText.length === 0) return null;
  const duration = cap.endMs - cap.startMs;
  if (duration < 2) return null;

  let splitMs = Math.round(cap.startMs + (duration * cursor) / len);
  let leftWords: readonly Word[] = [];
  let rightWords: readonly Word[] = [];
  if (cap.words.length > 0 && cap.words.length === tokens(cap.text).length) {
    const leftCount = Math.min(tokens(leftText).length, cap.words.length);
    leftWords = cap.words.slice(0, leftCount);
    rightWords = cap.words.slice(leftCount);
    const lastLeft = leftWords[leftWords.length - 1];
    const firstRight = rightWords[0];
    if (lastLeft && firstRight && lastLeft.t1 <= firstRight.t0) {
      splitMs = Math.min(Math.max(splitMs, lastLeft.t1), firstRight.t0);
    }
  } else if (cap.words.length > 0) {
    leftWords = cap.words.filter((w) => (w.t0 + w.t1) / 2 < splitMs);
    rightWords = cap.words.filter((w) => (w.t0 + w.t1) / 2 >= splitMs);
  }
  splitMs = Math.min(Math.max(splitMs, cap.startMs + 1), cap.endMs - 1);

  const newId = uniqueId(captions, `${cap.id}-split`);
  const left: Caption = { id: cap.id, startMs: cap.startMs, endMs: splitMs, text: leftText, words: leftWords };
  const right: Caption = { id: newId, startMs: splitMs, endMs: cap.endMs, text: rightText, words: rightWords };
  const next = [...captions];
  next.splice(index, 1, left, right);
  return { captions: next, newId };
}

export interface MergeResult {
  captions: Caption[];
  /** Id of the merged caption (the previous one). */
  mergedId: string;
  /** Caret position at the join point inside the merged text. */
  cursor: number;
}

/** Merge caption `id` into its predecessor (Backspace at caret 0). Null for the first row. */
export function mergeWithPrevious(captions: readonly Caption[], id: string): MergeResult | null {
  const index = captions.findIndex((c) => c.id === id);
  const cur = captions[index];
  const prev = captions[index - 1];
  if (!cur || !prev) return null;
  const sep = prev.text === "" || cur.text === "" || /\s$/u.test(prev.text) ? "" : " ";
  const merged: Caption = {
    id: prev.id,
    startMs: prev.startMs,
    endMs: Math.max(prev.endMs, cur.endMs),
    text: prev.text + sep + cur.text,
    words: [...prev.words, ...cur.words],
  };
  const next = [...captions];
  next.splice(index - 1, 2, merged);
  return { captions: next, mergedId: prev.id, cursor: prev.text.length + sep.length };
}

export interface AddCaptionOptions {
  /** Desired length; shortened to fit before the next caption. Default 2000. */
  durationMs?: number | undefined;
  /** Project duration; the caption never extends past it. */
  maxMs?: number | undefined;
  /** Smallest gap worth inserting into. Default 100. */
  minDurationMs?: number | undefined;
}

export interface AddResult {
  captions: Caption[];
  id: string;
}

/**
 * Insert an empty caption starting at the playhead without overlapping
 * neighbors. Null when the playhead is inside a caption or the gap is too small.
 */
export function addCaptionAt(captions: readonly Caption[], atMs: number, options: AddCaptionOptions = {}): AddResult | null {
  const duration = options.durationMs ?? 2000;
  const minDuration = Math.max(1, options.minDurationMs ?? 100);
  const start = Math.max(0, Math.round(atMs));
  if (captions.some((c) => start >= c.startMs && start < c.endMs)) return null;
  const nextIndex = captions.findIndex((c) => c.startMs > start);
  const nextCap = nextIndex === -1 ? undefined : captions[nextIndex];
  const end = Math.min(start + duration, nextCap?.startMs ?? Infinity, options.maxMs ?? Infinity);
  if (end - start < minDuration) return null;
  const id = uniqueId(captions, `cap-${start}`);
  const added: Caption = { id, startMs: start, endMs: end, text: "", words: [] };
  const next = [...captions];
  next.splice(nextIndex === -1 ? next.length : nextIndex, 0, added);
  return { captions: next, id };
}

/**
 * Replace a caption's text. Word timings are kept (re-texted in place) when the
 * token count is unchanged, otherwise dropped — word retiming is v1.1.
 */
export function updateCaptionText(captions: readonly Caption[], id: string, text: string): Caption[] {
  return captions.map((c) => {
    if (c.id !== id) return c;
    const toks = tokens(text);
    const words: readonly Word[] =
      c.words.length > 0 && c.words.length === toks.length
        ? c.words.map((w, i) => ({ ...w, text: toks[i] ?? w.text }))
        : [];
    return { ...c, text, words };
  });
}

/** Case-insensitive substring filter; blank query returns everything. */
export function filterCaptions(captions: readonly Caption[], query: string): Caption[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [...captions];
  return captions.filter((c) => c.text.replace(/\s+/gu, " ").toLocaleLowerCase().includes(q));
}

/** Caption under the playhead (half-open range), if any. */
export function findActiveCaption(captions: readonly Caption[], ms: number): Caption | undefined {
  return captions.find((c) => ms >= c.startMs && ms < c.endMs);
}

// ── Timecodes ────────────────────────────────────────────────────────────────

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function splitMs(ms: number): { h: number; m: number; s: number; milli: number } {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    milli: total % 1000,
  };
}

/** SRT timestamp `HH:MM:SS,mmm`. */
export function formatSrtTimestamp(ms: number): string {
  const t = splitMs(ms);
  return `${pad(t.h, 2)}:${pad(t.m, 2)}:${pad(t.s, 2)},${pad(t.milli, 3)}`;
}

/** WebVTT timestamp `HH:MM:SS.mmm`. */
export function formatVttTimestamp(ms: number): string {
  const t = splitMs(ms);
  return `${pad(t.h, 2)}:${pad(t.m, 2)}:${pad(t.s, 2)}.${pad(t.milli, 3)}`;
}

/** Progress clock `MM:SS` (`H:MM:SS` from one hour). */
export function formatClock(ms: number): string {
  const t = splitMs(Math.floor(Math.max(0, ms) / 1000) * 1000);
  return t.h > 0 ? `${t.h}:${pad(t.m, 2)}:${pad(t.s, 2)}` : `${pad(t.m, 2)}:${pad(t.s, 2)}`;
}

/** Row timecode `MM:SS.t` (tenths; `H:MM:SS.t` from one hour). */
export function formatCueTime(ms: number): string {
  const t = splitMs(Math.floor(Math.max(0, ms) / 100) * 100);
  const base = t.h > 0 ? `${t.h}:${pad(t.m, 2)}:${pad(t.s, 2)}` : `${pad(t.m, 2)}:${pad(t.s, 2)}`;
  return `${base}.${Math.floor(t.milli / 100)}`;
}

// ── Sidecar export ───────────────────────────────────────────────────────────

/** Trim lines and drop blank ones — a blank line would terminate the cue. */
function cueLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const exportable = (captions: readonly Caption[]): Caption[] =>
  [...captions]
    .filter((c) => cueLines(c.text).length > 0 && c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs);

/** SubRip: sequential 1-based cues, `-->` in text defused, blank captions skipped. */
export function toSrt(captions: readonly Caption[]): string {
  return exportable(captions)
    .map((c, i) => {
      const body = cueLines(c.text).map((l) => l.replaceAll("-->", "->")).join("\n");
      return `${i + 1}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}\n${body}\n`;
    })
    .join("\n");
}

const escapeVtt = (line: string): string => line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** WebVTT: `WEBVTT` header, numbered cues, `& < >` escaped, blank captions skipped. */
export function toVtt(captions: readonly Caption[]): string {
  const cues = exportable(captions).map((c, i) => {
    const body = cueLines(c.text).map(escapeVtt).join("\n");
    return `${i + 1}\n${formatVttTimestamp(c.startMs)} --> ${formatVttTimestamp(c.endMs)}\n${body}\n`;
  });
  return cues.length === 0 ? "WEBVTT\n" : `WEBVTT\n\n${cues.join("\n")}`;
}
