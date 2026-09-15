/**
 * Tiny GIF89a decoder used only by tests to round-trip our encoder output.
 * Written independently of the encoder in the canonical giflib style.
 */

export interface DecodedFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  indices: Uint8Array;
  /** Effective palette for this frame (local or global). */
  palette: Uint8Array;
  hasLocalPalette: boolean;
  delayCs: number;
  disposal: number;
  transparentIndex: number | null;
  minCodeSize: number;
  maxSubBlockLength: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  globalPalette: Uint8Array | null;
  /** NETSCAPE2.0 loop count (0 = forever), null when absent. */
  loopCount: number | null;
  frames: DecodedFrame[];
  /** Fully composited RGBA canvas after each frame (disposal applied before the next). */
  composites: Uint8Array[];
}

/** Decode the body of an image-data block (already de-sub-blocked). */
export function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const firstChar = new Uint8Array(4096);
  const lengths = new Int32Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    firstChar[i] = i;
    lengths[i] = 1;
  }
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let pos = 0;
  let bitPos = 0;
  const totalBits = data.length * 8;
  const stack = new Uint8Array(4097);

  const readCode = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[bitPos >> 3] ?? 0;
      if ((byte >> (bitPos & 7)) & 1) code |= 1 << i;
      bitPos++;
    }
    return code;
  };

  while (bitPos + codeSize <= totalBits) {
    const code = readCode();
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) throw new Error(`bad first code ${code}`);
      if (pos < pixelCount) out[pos++] = code;
      prev = code;
      continue;
    }
    let cur: number;
    let first: number;
    if (code < next) {
      cur = code;
      first = firstChar[code] ?? 0;
    } else if (code === next) {
      cur = prev;
      first = firstChar[prev] ?? 0;
    } else {
      throw new Error(`bad code ${code} (next ${next})`);
    }
    // unwind `cur`
    let sp = 0;
    if (code === next) stack[sp++] = first;
    let c = cur;
    while (c >= clear) {
      stack[sp++] = suffix[c] ?? 0;
      c = prefix[c] ?? 0;
    }
    stack[sp++] = c;
    while (sp > 0) {
      const v = stack[--sp] ?? 0;
      if (pos < pixelCount) out[pos++] = v;
    }
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      firstChar[next] = firstChar[prev] ?? 0;
      lengths[next] = (lengths[prev] ?? 0) + 1;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  if (pos !== pixelCount) throw new Error(`decoded ${pos} of ${pixelCount} pixels`);
  return out;
}

export function decodeGif(bytes: Uint8Array): DecodedGif {
  let p = 0;
  const u8 = (): number => {
    if (p >= bytes.length) throw new Error("unexpected end of GIF");
    return bytes[p++] ?? 0;
  };
  const u16 = (): number => u8() | (u8() << 8);
  const ascii = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(u8());
    return s;
  };
  const readSubBlocks = (): { data: Uint8Array; maxLen: number } => {
    const parts: number[] = [];
    let maxLen = 0;
    for (;;) {
      const len = u8();
      if (len === 0) break;
      maxLen = Math.max(maxLen, len);
      for (let i = 0; i < len; i++) parts.push(u8());
    }
    return { data: Uint8Array.from(parts), maxLen };
  };

  if (ascii(6) !== "GIF89a") throw new Error("not GIF89a");
  const width = u16();
  const height = u16();
  const packed = u8();
  u8(); // background index
  u8(); // aspect
  let globalPalette: Uint8Array | null = null;
  if (packed & 0x80) {
    const size = 1 << ((packed & 7) + 1);
    globalPalette = bytes.slice(p, p + size * 3);
    p += size * 3;
  }

  let loopCount: number | null = null;
  const frames: DecodedFrame[] = [];
  const composites: Uint8Array[] = [];
  const canvas = new Uint8Array(width * height * 4);
  let gce = { delayCs: 0, disposal: 0, transparentIndex: null as number | null };
  let prevFrame: DecodedFrame | null = null;

  for (;;) {
    const intro = u8();
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        if (u8() !== 4) throw new Error("bad GCE size");
        const flags = u8();
        const delayCs = u16();
        const ti = u8();
        if (u8() !== 0) throw new Error("bad GCE terminator");
        gce = { delayCs, disposal: (flags >> 2) & 7, transparentIndex: flags & 1 ? ti : null };
      } else if (label === 0xff) {
        const size = u8();
        const id = ascii(size);
        const { data } = readSubBlocks();
        if (id === "NETSCAPE2.0" && data[0] === 1)
          loopCount = (data[1] ?? 0) | ((data[2] ?? 0) << 8);
      } else {
        readSubBlocks();
      }
      continue;
    }
    if (intro !== 0x2c) throw new Error(`unknown block 0x${intro.toString(16)}`);

    // apply previous frame disposal
    if (prevFrame && prevFrame.disposal === 2) {
      for (let y = 0; y < prevFrame.height; y++)
        for (let x = 0; x < prevFrame.width; x++) {
          const o = ((prevFrame.top + y) * width + prevFrame.left + x) * 4;
          canvas.fill(0, o, o + 4);
        }
    }

    const left = u16();
    const top = u16();
    const w = u16();
    const h = u16();
    const ipacked = u8();
    if (ipacked & 0x40) throw new Error("interlace unsupported");
    let palette = globalPalette;
    const hasLocalPalette = (ipacked & 0x80) !== 0;
    if (hasLocalPalette) {
      const size = 1 << ((ipacked & 7) + 1);
      palette = bytes.slice(p, p + size * 3);
      p += size * 3;
    }
    if (!palette) throw new Error("frame without palette");
    const minCodeSize = u8();
    const { data, maxLen } = readSubBlocks();
    const indices = lzwDecode(data, minCodeSize, w * h);
    const frame: DecodedFrame = {
      left,
      top,
      width: w,
      height: h,
      indices,
      palette,
      hasLocalPalette,
      delayCs: gce.delayCs,
      disposal: gce.disposal,
      transparentIndex: gce.transparentIndex,
      minCodeSize,
      maxSubBlockLength: maxLen,
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const idx = indices[y * w + x] ?? 0;
        if (idx === gce.transparentIndex) continue;
        const o = ((top + y) * width + left + x) * 4;
        canvas[o] = palette[idx * 3] ?? 0;
        canvas[o + 1] = palette[idx * 3 + 1] ?? 0;
        canvas[o + 2] = palette[idx * 3 + 2] ?? 0;
        canvas[o + 3] = 255;
      }
    frames.push(frame);
    composites.push(canvas.slice());
    prevFrame = frame;
    gce = { delayCs: 0, disposal: 0, transparentIndex: null };
  }
  return { width, height, globalPalette, loopCount, frames, composites };
}
