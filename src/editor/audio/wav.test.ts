import { WAV_HEADER_BYTES, encodeWavPcm16 } from "./wav";

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

describe("encodeWavPcm16", () => {
  it("writes an exact 44-byte PCM16 stereo header", () => {
    const l = Float32Array.of(0, 1, -1);
    const r = Float32Array.of(0.5, -0.5, 2);
    const bytes = encodeWavPcm16([l, r], 48_000);
    const v = new DataView(bytes.buffer);
    expect(bytes.length).toBe(WAV_HEADER_BYTES + 3 * 4);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 12);
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(ascii(bytes, 12, 4)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48_000);
    expect(v.getUint32(28, true)).toBe(192_000);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(12);
    // First header bytes literally.
    expect(Array.from(bytes.subarray(0, 12))).toEqual([
      0x52, 0x49, 0x46, 0x46, 0x30, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
  });

  it("interleaves, clamps and scales samples", () => {
    const bytes = encodeWavPcm16(
      [Float32Array.of(0, 1, -1), Float32Array.of(0.5, -0.5, 2)],
      48_000,
    );
    const v = new DataView(bytes.buffer);
    const s = (i: number) => v.getInt16(WAV_HEADER_BYTES + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5)]).toEqual([0, 16384, 32767, -16384, -32768, 32767]);
  });

  it("mono, NaN, mismatched lengths, empty data", () => {
    const mono = encodeWavPcm16([Float32Array.of(Number.NaN)], 44_100);
    expect(new DataView(mono.buffer).getUint16(22, true)).toBe(1);
    expect(new DataView(mono.buffer).getInt16(44, true)).toBe(0);
    expect(encodeWavPcm16([new Float32Array(5), new Float32Array(3)], 8000).length).toBe(44 + 12);
    expect(encodeWavPcm16([new Float32Array(0)], 8000).length).toBe(44);
    expect(() => encodeWavPcm16([], 48_000)).toThrow();
    expect(() => encodeWavPcm16([new Float32Array(1)], 44_100.5)).toThrow();
  });
});
