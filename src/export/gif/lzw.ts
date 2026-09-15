import { ByteWriter } from "./byteWriter";

/**
 * GIF LZW encoder (gifenc / classic `compress` style, ENGINEERING_SPEC §10.6).
 *
 * Variable code size starting at `minCodeSize + 1`, growing to 12 bits; a
 * clear code is emitted first and whenever the 4096-entry table fills; the
 * stream ends with the end-of-information code. Output is the image-data
 * block body: the min-code-size byte, data sub-blocks (≤ 255 bytes each) and
 * the zero-length block terminator.
 */

const MAX_BITS = 12;
const MAX_CODES = 1 << MAX_BITS; // 4096
/** Open-addressing hash size (prime, ~80% occupancy at a full table). */
const HSIZE = 5003;

/** Min code size for a color table of `tableSize` entries (GIF requires ≥ 2). */
export function lzwMinCodeSize(tableSize: number): number {
  let bits = 1;
  while (1 << bits < tableSize) bits++;
  return Math.max(2, bits);
}

/** Packs variable-width codes LSB-first into ≤255-byte sub-blocks. */
class SubBlockBitWriter {
  private accum = 0;
  private accumBits = 0;
  private block = new Uint8Array(255);
  private blockLen = 0;

  constructor(private readonly out: ByteWriter) {}

  write(code: number, bits: number): void {
    this.accum |= code << this.accumBits;
    this.accumBits += bits;
    while (this.accumBits >= 8) {
      this.pushByte(this.accum & 0xff);
      this.accum >>>= 8;
      this.accumBits -= 8;
    }
  }

  private pushByte(b: number): void {
    this.block[this.blockLen++] = b;
    if (this.blockLen === 255) this.flushBlock();
  }

  private flushBlock(): void {
    if (this.blockLen === 0) return;
    this.out.byte(this.blockLen);
    this.out.bytes(this.block.subarray(0, this.blockLen));
    this.blockLen = 0;
  }

  end(): void {
    if (this.accumBits > 0) this.pushByte(this.accum & 0xff);
    this.accum = 0;
    this.accumBits = 0;
    this.flushBlock();
    this.out.byte(0); // block terminator
  }
}

/**
 * LZW-encode color indices into `out` (or a new writer). Every index must be
 * `< 2 ** minCodeSize`.
 */
export function lzwEncode(
  indices: ArrayLike<number>,
  minCodeSize: number,
  out: ByteWriter = new ByteWriter(indices.length + 64),
): ByteWriter {
  if (minCodeSize < 2 || minCodeSize > 8)
    throw new RangeError(`invalid LZW min code size ${minCodeSize}`);
  out.byte(minCodeSize);
  const bits = new SubBlockBitWriter(out);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const initBits = minCodeSize + 1;
  const hashKeys = new Int32Array(HSIZE).fill(-1);
  const hashCodes = new Int32Array(HSIZE);

  let nBits = initBits;
  let maxCode = (1 << nBits) - 1;
  let freeEnt = eoiCode + 1;

  const output = (code: number, clear: boolean): void => {
    bits.write(code, nBits);
    if (clear) {
      nBits = initBits;
      maxCode = (1 << nBits) - 1;
    } else if (freeEnt > maxCode && nBits < MAX_BITS) {
      nBits++;
      maxCode = nBits === MAX_BITS ? MAX_CODES : (1 << nBits) - 1;
    }
  };

  const clearTable = (): void => {
    hashKeys.fill(-1);
    freeEnt = eoiCode + 1;
    output(clearCode, true);
  };

  output(clearCode, true);
  const n = indices.length;
  if (n > 0) {
    let ent = indices[0] ?? 0;
    for (let i = 1; i < n; i++) {
      const c = indices[i] ?? 0;
      const key = (c << MAX_BITS) + ent;
      let h = ((c << 4) ^ ent) % HSIZE;
      let found = false;
      if (hashKeys[h] === key) {
        ent = hashCodes[h] ?? 0;
        found = true;
      } else if ((hashKeys[h] ?? -1) >= 0) {
        const disp = h === 0 ? 1 : HSIZE - h;
        for (;;) {
          h -= disp;
          if (h < 0) h += HSIZE;
          if (hashKeys[h] === key) {
            ent = hashCodes[h] ?? 0;
            found = true;
            break;
          }
          if ((hashKeys[h] ?? -1) < 0) break;
        }
      }
      if (found) continue;
      output(ent, false);
      ent = c;
      if (freeEnt < MAX_CODES) {
        hashCodes[h] = freeEnt++;
        hashKeys[h] = key;
      } else {
        clearTable();
      }
    }
    output(ent, false);
  }
  output(eoiCode, false);
  bits.end();
  return out;
}
