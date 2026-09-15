import type { ByteWriter } from "./byteWriter";
import { lzwEncode, lzwMinCodeSize } from "./lzw";
import { colorTableBits } from "./palette";

/** GIF89a block writers. All tables must already be power-of-two sized. */

export const GIF_TRAILER = 0x3b;
/** Bytes of a graphic control extension block. */
export const GCE_BYTES = 8;

/** Disposal methods (GIF89a §23). */
export const Disposal = {
  none: 0,
  keep: 1,
  restoreBackground: 2,
} as const;
export type DisposalMethod = (typeof Disposal)[keyof typeof Disposal];

function tableBitsOf(table: Uint8Array): number {
  const entries = table.length / 3;
  const bits = colorTableBits(entries);
  if (entries !== 1 << bits || bits > 8)
    throw new RangeError(`color table must be 2..256 (pow2), got ${entries}`);
  return bits;
}

/** Header, logical screen descriptor, optional global table and loop extension. */
export function writeHeader(
  w: ByteWriter,
  opts: { width: number; height: number; globalTable: Uint8Array | null; loop: boolean },
): void {
  w.ascii("GIF89a");
  w.u16(opts.width);
  w.u16(opts.height);
  if (opts.globalTable) {
    const bits = tableBitsOf(opts.globalTable);
    // GCT flag | color resolution 8 bits | not sorted | table size
    w.byte(0x80 | (7 << 4) | (bits - 1));
  } else {
    w.byte(7 << 4);
  }
  w.byte(0); // background color index
  w.byte(0); // pixel aspect ratio
  if (opts.globalTable) w.bytes(opts.globalTable);
  if (opts.loop) {
    w.byte(0x21);
    w.byte(0xff);
    w.byte(11);
    w.ascii("NETSCAPE2.0");
    w.byte(3);
    w.byte(1);
    w.u16(0); // loop forever
    w.byte(0);
  }
}

export function writeGraphicControl(
  w: ByteWriter,
  opts: { delayCs: number; disposal: DisposalMethod; transparentIndex: number | null },
): void {
  w.byte(0x21);
  w.byte(0xf9);
  w.byte(4);
  w.byte((opts.disposal << 2) | (opts.transparentIndex !== null ? 1 : 0));
  w.u16(Math.max(0, Math.min(0xffff, Math.round(opts.delayCs))));
  w.byte(opts.transparentIndex ?? 0);
  w.byte(0);
}

/** Image descriptor + optional local color table + LZW image data. */
export function writeImage(
  w: ByteWriter,
  opts: {
    left: number;
    top: number;
    width: number;
    height: number;
    indices: Uint8Array;
    localTable: Uint8Array | null;
    /** Entries in the table that applies to this frame (local or global). */
    tableEntries: number;
  },
): void {
  if (opts.indices.length !== opts.width * opts.height)
    throw new RangeError("indices size mismatch");
  w.byte(0x2c);
  w.u16(opts.left);
  w.u16(opts.top);
  w.u16(opts.width);
  w.u16(opts.height);
  if (opts.localTable) {
    const bits = tableBitsOf(opts.localTable);
    w.byte(0x80 | (bits - 1));
    w.bytes(opts.localTable);
  } else {
    w.byte(0);
  }
  lzwEncode(opts.indices, lzwMinCodeSize(opts.tableEntries), w);
}
