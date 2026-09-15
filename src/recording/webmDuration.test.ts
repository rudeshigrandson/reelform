import { describe, expect, it } from "vitest";
import { encodeVint, patchWebmDuration, readVint, readWebmDurationMs } from "./webmDuration";

const bytes = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const flat: number[] = [];
  for (const p of parts) flat.push(...p);
  return new Uint8Array(flat);
};

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d];
const SEGMENT_UNKNOWN = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const TIMECODE_SCALE_1MS = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const MUXING_APP = [0x4d, 0x80, 0x84, 0x43, 0x68, 0x72, 0x6f];
const TRACKS_EMPTY = [0x16, 0x54, 0xae, 0x6b, 0x80];
const CLUSTER = [
  0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00,
];

/** MediaRecorder-shaped head: EBML, unknown-size Segment, Info without Duration, Tracks, Cluster. */
function mediaRecorderHead(infoChildren: number[] = [...TIMECODE_SCALE_1MS, ...MUXING_APP]) {
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoChildren.length, ...infoChildren];
  return bytes(EBML_HEADER, SEGMENT_UNKNOWN, info, TRACKS_EMPTY, CLUSTER);
}

/** Apply a patch to a whole "file". */
function applied(file: Uint8Array, durationMs: number): Uint8Array {
  const patch = patchWebmDuration(file, durationMs);
  if (!patch) throw new Error("not patched");
  return bytes(patch.head, file.subarray(patch.replacedBytes));
}

describe("EBML vints", () => {
  it("round-trips sizes and flags the unknown-size pattern", () => {
    for (const [value, length] of [
      [0, 1],
      [126, 1],
      [127, 2],
      [14, 8],
      [2 ** 40, 8],
    ] as const) {
      const enc = encodeVint(value, length);
      expect(enc).not.toBeNull();
      expect(readVint(enc as Uint8Array, 0)).toEqual({ length, value, unknown: false });
    }
    expect(encodeVint(127, 1)).toBeNull();
    expect(readVint(new Uint8Array(SEGMENT_UNKNOWN), 4)?.unknown).toBe(true);
  });
});

describe("patchWebmDuration", () => {
  it("inserts a float64 Duration into Info and leaves the rest of the file intact", () => {
    const file = mediaRecorderHead();
    expect(readWebmDurationMs(file)).toBeNull();
    const patch = patchWebmDuration(file, 42_180);
    expect(patch?.inPlace).toBe(false);
    const out = applied(file, 42_180);
    expect(out.length).toBe(file.length + 11);
    expect(readWebmDurationMs(out)).toBe(42_180);
    // Tracks and the first Cluster follow unchanged.
    expect(Array.from(out.subarray(out.length - TRACKS_EMPTY.length - CLUSTER.length))).toEqual([
      ...TRACKS_EMPTY,
      ...CLUSTER,
    ]);
  });

  it("overwrites an existing Duration in place (float32 and float64)", () => {
    const float32 = [0x44, 0x89, 0x84, 0, 0, 0, 0];
    const f32 = mediaRecorderHead([...TIMECODE_SCALE_1MS, ...float32]);
    const p32 = patchWebmDuration(f32, 1500);
    expect(p32?.inPlace).toBe(true);
    expect(p32?.head.length).toBe(f32.length);
    expect(readWebmDurationMs(p32?.head as Uint8Array)).toBe(1500);

    const withDuration = applied(mediaRecorderHead(), 1000);
    const again = patchWebmDuration(withDuration, 2500);
    expect(again?.inPlace).toBe(true);
    expect(readWebmDurationMs(again?.head as Uint8Array)).toBe(2500);
  });

  it("never inserts past a SeekHead (its offsets would break) but still overwrites in place", () => {
    const SEEK_HEAD_EMPTY = [0x11, 0x4d, 0x9b, 0x74, 0x80];
    const withSeek = (infoChildren: number[]) => {
      const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoChildren.length, ...infoChildren];
      return bytes(EBML_HEADER, SEGMENT_UNKNOWN, SEEK_HEAD_EMPTY, info, TRACKS_EMPTY, CLUSTER);
    };
    expect(patchWebmDuration(withSeek([...TIMECODE_SCALE_1MS]), 1000)).toBeNull();
    const float64 = [0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0];
    const patch = patchWebmDuration(withSeek([...TIMECODE_SCALE_1MS, ...float64]), 1000);
    expect(patch?.inPlace).toBe(true);
    expect(readWebmDurationMs(patch?.head as Uint8Array)).toBe(1000);
  });

  it("scales by TimecodeScale and defaults to 1ms ticks without one", () => {
    // TimecodeScale 1000 ns = µs ticks.
    const micro = mediaRecorderHead([0x2a, 0xd7, 0xb1, 0x82, 0x03, 0xe8, ...MUXING_APP]);
    const out = applied(micro, 2000);
    expect(readWebmDurationMs(out)).toBe(2000);
    const view = new DataView(out.buffer);
    // Duration element is appended at the end of Info: header(12) + segment(12) + info hdr(5) + children(13).
    expect(view.getFloat64(12 + 12 + 5 + 13 + 3)).toBe(2_000_000);

    expect(readWebmDurationMs(applied(mediaRecorderHead(MUXING_APP), 750))).toBe(750);
  });

  it("grows a known Segment size and a long-form Info size by the inserted bytes", () => {
    const children = [...TIMECODE_SCALE_1MS, ...MUXING_APP];
    const info = [0x15, 0x49, 0xa9, 0x66, 0x01, 0, 0, 0, 0, 0, 0, children.length, ...children];
    const body = [...info, ...TRACKS_EMPTY];
    const segment = [0x18, 0x53, 0x80, 0x67, 0x40 | (body.length >> 8), body.length & 0xff];
    const file = bytes(EBML_HEADER, segment, body);
    const out = applied(file, 3000);
    expect(readWebmDurationMs(out)).toBe(3000);
    expect(readVint(out, 12 + 4)).toEqual({ length: 2, value: body.length + 11, unknown: false });
    expect(readVint(out, 12 + 6 + 4)).toEqual({
      length: 8,
      value: children.length + 11,
      unknown: false,
    });
  });

  it("refuses non-WebM data, truncated heads and invalid durations", () => {
    expect(patchWebmDuration(new Uint8Array([0, 0, 0, 1]), 10)).toBeNull();
    const file = mediaRecorderHead();
    expect(patchWebmDuration(file.subarray(0, 30), 10)).toBeNull();
    expect(patchWebmDuration(file, Number.NaN)).toBeNull();
    expect(patchWebmDuration(file, -1)).toBeNull();
    // Cluster before Info: nothing to patch.
    expect(patchWebmDuration(bytes(EBML_HEADER, SEGMENT_UNKNOWN, CLUSTER), 10)).toBeNull();
  });
});
