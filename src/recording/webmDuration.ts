/**
 * MediaRecorder WebM files carry no `Duration` in their `Segment > Info`, so
 * players cannot seek them and report an unknown length (§5.2). This pure EBML
 * patcher writes the duration into the file head:
 *
 * - an existing `Duration` (float32/float64) is overwritten in place;
 * - otherwise a float64 `Duration` element is appended to `Info`, the `Info`
 *   size is re-encoded, and a known `Segment` size is grown by the same delta
 *   (MediaRecorder writes an unknown-size Segment, which needs no update).
 *
 * Only the head is touched: the caller reads the first bytes of the file (see
 * {@link WEBM_HEAD_BYTES}) and writes back the result, which is either the same
 * length (in-place) or longer by the inserted element (the rest of the file
 * follows unchanged). No dependency on a WebM library.
 */

/** Bytes to read from the start of a file; `Info` sits well within it. */
export const WEBM_HEAD_BYTES = 64 * 1024;

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_CUES = 0x1c53bb6b;
const DEFAULT_TIMECODE_SCALE = 1_000_000;

export interface WebmDurationPatch {
  /** Replacement for the first `replacedBytes` bytes of the file. */
  head: Uint8Array;
  /** How many bytes of the original head `head` replaces. */
  replacedBytes: number;
  /** `true` when an existing Duration was overwritten (same length). */
  inPlace: boolean;
}

interface Vint {
  /** Encoded length in bytes. */
  length: number;
  value: number;
  /** All value bits set: "unknown size". */
  unknown: boolean;
}

/** EBML element id (marker bits kept), 1–4 bytes. */
function readId(buf: Uint8Array, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > buf.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + (buf[pos + i] ?? 0);
  return { length, value, unknown: false };
}

/** EBML data size (marker bit stripped), 1–8 bytes. */
export function readVint(buf: Uint8Array, pos: number): Vint | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i] ?? 0;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { length, value, unknown: allOnes };
}

/** Encode a data size as a vint of exactly `length` bytes; `null` when it does not fit. */
export function encodeVint(value: number, length: number): Uint8Array | null {
  if (!Number.isSafeInteger(value) || value < 0 || length < 1 || length > 8) return null;
  // 7 value bits per byte; the all-ones pattern is reserved for "unknown".
  if (value >= 2 ** (7 * length) - 1) return null;
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (length - 1));
  return out;
}

function minimalVintLength(value: number): number {
  let length = 1;
  while (length < 8 && value >= 2 ** (7 * length) - 1) length++;
  return length;
}

function readUint(buf: Uint8Array, pos: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + (buf[pos + i] ?? 0);
  return v;
}

interface Element {
  id: number;
  /** Offset of the element id. */
  start: number;
  sizeLength: number;
  size: Vint;
  dataStart: number;
}

function readElement(buf: Uint8Array, pos: number): Element | null {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  return {
    id: id.value,
    start: pos,
    sizeLength: size.length,
    size,
    dataStart: pos + id.length + size.length,
  };
}

/**
 * Patch `Segment > Info > Duration` in a WebM head to `durationMs`. Returns
 * `null` when the head is not a WebM with a complete `Info` element.
 */
export function patchWebmDuration(head: Uint8Array, durationMs: number): WebmDurationPatch | null {
  if (!(durationMs >= 0) || !Number.isFinite(durationMs)) return null;
  const ebml = readElement(head, 0);
  if (!ebml || ebml.id !== ID_EBML || ebml.size.unknown) return null;
  const segment = readElement(head, ebml.dataStart + ebml.size.value);
  if (!segment || segment.id !== ID_SEGMENT) return null;

  // Find Info among the Segment's first children (before any Cluster).
  let info: Element | null = null;
  /** A SeekHead / Cues stores Segment offsets that an insertion would invalidate. */
  let hasPositions = false;
  for (let pos = segment.dataStart; pos < head.length; ) {
    const el = readElement(head, pos);
    if (!el || el.size.unknown || el.id === ID_CLUSTER) return null;
    if (el.id === ID_SEEK_HEAD || el.id === ID_CUES) hasPositions = true;
    if (el.id === ID_INFO) {
      info = el;
      break;
    }
    pos = el.dataStart + el.size.value;
  }
  if (!info) return null;
  const infoEnd = info.dataStart + info.size.value;
  if (infoEnd > head.length) return null;

  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  let duration: Element | null = null;
  for (let pos = info.dataStart; pos < infoEnd; ) {
    const el = readElement(head, pos);
    if (!el || el.size.unknown || el.dataStart + el.size.value > infoEnd) return null;
    if (el.id === ID_TIMECODE_SCALE && el.size.value >= 1 && el.size.value <= 8) {
      timecodeScale = readUint(head, el.dataStart, el.size.value) || DEFAULT_TIMECODE_SCALE;
    } else if (el.id === ID_DURATION) {
      duration = el;
    }
    pos = el.dataStart + el.size.value;
  }
  const ticks = (durationMs * 1_000_000) / timecodeScale;

  if (duration && (duration.size.value === 4 || duration.size.value === 8)) {
    const out = head.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    if (duration.size.value === 4) view.setFloat32(duration.dataStart, ticks);
    else view.setFloat64(duration.dataStart, ticks);
    return { head: out, replacedBytes: head.length, inPlace: true };
  }
  if (duration) return null; // Malformed Duration size; leave the file alone.
  // Growing the head would shift every element a SeekHead / Cues points at.
  if (hasPositions) return null;

  const element = new Uint8Array(11);
  element[0] = 0x44;
  element[1] = 0x89;
  element[2] = 0x88; // size 8
  new DataView(element.buffer).setFloat64(3, ticks);

  const newInfoSize = info.size.value + element.length;
  const infoSizeVint = encodeVint(
    newInfoSize,
    Math.max(info.sizeLength, minimalVintLength(newInfoSize)),
  );
  if (!infoSizeVint) return null;
  const delta = element.length + (infoSizeVint.length - info.sizeLength);

  let segmentSizeVint: Uint8Array | null = null;
  if (!segment.size.unknown) {
    segmentSizeVint = encodeVint(segment.size.value + delta, segment.sizeLength);
    if (!segmentSizeVint) return null;
  }

  const infoSizePos = info.dataStart - info.sizeLength;
  const out = new Uint8Array(infoEnd + delta);
  out.set(head.subarray(0, infoSizePos), 0);
  if (segmentSizeVint) out.set(segmentSizeVint, segment.dataStart - segment.sizeLength);
  out.set(infoSizeVint, infoSizePos);
  out.set(head.subarray(info.dataStart, infoEnd), infoSizePos + infoSizeVint.length);
  out.set(element, infoSizePos + infoSizeVint.length + info.size.value);
  return { head: out, replacedBytes: infoEnd, inPlace: false };
}

/** Read the Duration (ms) a WebM head declares, or `null`. For tests and diagnostics. */
export function readWebmDurationMs(head: Uint8Array): number | null {
  const ebml = readElement(head, 0);
  if (!ebml || ebml.id !== ID_EBML) return null;
  const segment = readElement(head, ebml.dataStart + ebml.size.value);
  if (!segment || segment.id !== ID_SEGMENT) return null;
  for (let pos = segment.dataStart; pos < head.length; ) {
    const el = readElement(head, pos);
    if (!el || el.size.unknown || el.id === ID_CLUSTER) return null;
    if (el.id === ID_INFO) {
      const end = el.dataStart + el.size.value;
      let scale = DEFAULT_TIMECODE_SCALE;
      let ticks: number | null = null;
      for (let p = el.dataStart; p < end; ) {
        const c = readElement(head, p);
        if (!c) return null;
        const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
        if (c.id === ID_TIMECODE_SCALE) scale = readUint(head, c.dataStart, c.size.value);
        if (c.id === ID_DURATION) {
          ticks = c.size.value === 4 ? view.getFloat32(c.dataStart) : view.getFloat64(c.dataStart);
        }
        p = c.dataStart + c.size.value;
      }
      return ticks === null ? null : (ticks * scale) / 1_000_000;
    }
    pos = el.dataStart + el.size.value;
  }
  return null;
}
