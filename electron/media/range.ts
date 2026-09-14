/**
 * HTTP `Range` header parsing for the media protocol (RFC 9110 §14.1.2).
 *
 * Only a single byte range is honoured — `<video>` and mediabunny's fetch reader
 * never send multi-range requests. A syntactically invalid or multi-range header
 * is ignored (served as a full 200), exactly as the RFC allows.
 */

export type RangeResult =
  /** No usable Range header: serve the whole entity. */
  | { kind: "none" }
  /** Inclusive byte range, already clamped to the entity size. */
  | { kind: "range"; start: number; end: number }
  /** Well-formed but no byte of it exists → 416. */
  | { kind: "unsatisfiable" };

const NONE: RangeResult = { kind: "none" };
const UNSATISFIABLE: RangeResult = { kind: "unsatisfiable" };
const SPEC = /^(\d*)-(\d*)$/;

/** Parse `Range: bytes=…` against an entity of `size` bytes. */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (header == null) return NONE;
  const total = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  const trimmed = header.trim();
  const eq = trimmed.indexOf("=");
  if (eq < 0 || trimmed.slice(0, eq).trim().toLowerCase() !== "bytes") return NONE;
  const set = trimmed.slice(eq + 1).trim();
  if (set.includes(",")) return NONE;
  const m = SPEC.exec(set);
  if (!m) return NONE;
  const [, first = "", last = ""] = m;

  if (first === "" && last === "") return NONE;
  if (first === "") {
    // Suffix range: the final N bytes.
    const n = Number(last);
    if (!Number.isSafeInteger(n)) return NONE;
    if (n === 0 || total === 0) return UNSATISFIABLE;
    return { kind: "range", start: Math.max(0, total - n), end: total - 1 };
  }

  const start = Number(first);
  if (!Number.isSafeInteger(start)) return NONE;
  if (last === "") {
    return start >= total ? UNSATISFIABLE : { kind: "range", start, end: total - 1 };
  }
  const endRaw = Number(last);
  if (!Number.isSafeInteger(endRaw) || endRaw < start) return NONE;
  if (start >= total) return UNSATISFIABLE;
  return { kind: "range", start, end: Math.min(endRaw, total - 1) };
}
