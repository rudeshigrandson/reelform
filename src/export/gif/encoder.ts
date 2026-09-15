import { ByteWriter } from "./byteWriter";
import { type ColorLookup, createColorLookup } from "./colorLookup";
import { type Rect, quantizeRect } from "./dither";
import {
  Disposal,
  type DisposalMethod,
  GCE_BYTES,
  GIF_TRAILER,
  writeGraphicControl,
  writeHeader,
  writeImage,
} from "./gifWriter";
import { ColorHistogram, clampColors, medianCut, toColorTable } from "./palette";
import { type SizeEstimate, estimateGifSize, gifDelayCs } from "./timing";
import { GIF_MAX_DIMENSION, type GifEncoderOptions, type Palette, type RgbaFrame } from "./types";

/**
 * Streaming GIF89a encoder (ENGINEERING_SPEC §10.6).
 *
 * - Global palette: median cut over frames passed to `addSample` (the caller
 *   sends a ~10% sample, see `sampleFrameIndices`) or, if none, the first frame.
 *   `adaptivePalette` builds a local table per frame from its changed pixels.
 * - Frame differencing: a pixel is emitted as the reserved transparent index
 *   when its RGB equals the previous input frame, or when its quantized color
 *   already equals what is on screen. Sub-frames are cropped to the bounding
 *   box of non-transparent pixels; frames with no change extend the previous
 *   frame's delay instead (one frame is buffered for that reason).
 * - `addFrame` / `finish` return byte chunks ready to append to the file.
 */

interface PendingFrame {
  body: Uint8Array;
  delayCs: number;
  disposal: DisposalMethod;
  transparentIndex: number | null;
}

const MAX_DELAY_CS = 0xffff;

export class GifEncoder {
  readonly width: number;
  readonly height: number;
  private readonly opts: GifEncoderOptions;
  private readonly colors: number;
  private readonly frameDiff: boolean;
  private readonly alpha: boolean;
  private readonly adaptive: boolean;
  private readonly reserveTransparent: boolean;

  private readonly sampleHist = new ColorHistogram();
  private globalLookup: ColorLookup | null = null;
  private globalEntries = 0;
  private headerBytes: Uint8Array | null = null;
  private headerFlushed = false;

  private prevRaw: Uint8Array | null = null;
  private displayed: Uint8Array | null = null;
  private pending: PendingFrame | null = null;
  private finished = false;

  private _framesAdded = 0;
  private _encodedBytes = 0;
  private _firstFrameBytes = 0;
  private _bytesEmitted = 0;

  constructor(options: GifEncoderOptions) {
    const { width, height } = options;
    for (const [k, v] of [
      ["width", width],
      ["height", height],
    ] as const)
      if (!Number.isInteger(v) || v < 1 || v > GIF_MAX_DIMENSION)
        throw new RangeError(`GIF ${k} must be an integer in 1..${GIF_MAX_DIMENSION}, got ${v}`);
    this.width = width;
    this.height = height;
    this.opts = options;
    this.colors = clampColors(options.colors);
    this.alpha = options.alpha === true;
    this.frameDiff = (options.frameDiff ?? true) && !this.alpha;
    this.adaptive = options.adaptivePalette === true;
    this.reserveTransparent = this.frameDiff || this.alpha;
  }

  get framesAdded(): number {
    return this._framesAdded;
  }
  /** Bytes returned in chunks so far. */
  get bytesEmitted(): number {
    return this._bytesEmitted;
  }
  /** Header + every encoded frame (including the buffered one). */
  get encodedBytes(): number {
    return this._encodedBytes;
  }

  /** Colors available for image content (table size minus the transparent slot). */
  get paletteColors(): number {
    return this.colors - (this.reserveTransparent ? 1 : 0);
  }

  estimate(totalFrames: number | undefined = this.opts.totalFrames): SizeEstimate | null {
    return estimateGifSize({
      headerBytes: this.headerBytes?.length ?? 0,
      firstFrameBytes: this._firstFrameBytes,
      encodedBytes: this._encodedBytes,
      framesEncoded: this._framesAdded,
      totalFrames,
      fps: this.opts.fps,
    });
  }

  /** Feed a palette sample frame. Only meaningful before the first `addFrame` in global mode. */
  addSample(frame: RgbaFrame): void {
    this.checkFrame(frame);
    if (this.adaptive || this.globalLookup) return;
    this.sampleHist.addFrame(frame, { skipTransparent: this.alpha });
  }

  addFrame(frame: RgbaFrame): Uint8Array[] {
    this.checkFrame(frame);
    const chunks: Uint8Array[] = [];
    if (!this.headerBytes) this.prepareHeader(frame);
    const index = this._framesAdded++;
    const delayCs = gifDelayCs(index, this.opts.fps);

    const { width: w, height: h } = this;
    const data = frame.data;
    const full: Rect = { x: 0, y: 0, width: w, height: h };
    let rect = full;
    let include: Uint8Array | undefined;

    if (this.frameDiff && this.prevRaw) {
      const prev = this.prevRaw;
      include = new Uint8Array(w * h);
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const o = p * 4;
          if (data[o] !== prev[o] || data[o + 1] !== prev[o + 1] || data[o + 2] !== prev[o + 2]) {
            include[p] = 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      if (maxX < 0) {
        this.extendDelay(delayCs, chunks);
        return chunks;
      }
      rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    let lookup: ColorLookup;
    let entries: number;
    let localTable: Uint8Array | null = null;
    if (this.adaptive) {
      const hist = new ColorHistogram();
      hist.addFrame(frame, { skipTransparent: this.alpha, mask: include, rect });
      const palette = medianCut(hist, this.paletteColors);
      lookup = createColorLookup(palette);
      entries = palette.count + (this.reserveTransparent ? 1 : 0);
      localTable = toColorTable(palette, entries);
    } else {
      lookup = this.globalLookup as ColorLookup;
      entries = this.globalEntries;
    }
    const transparentIndex = this.reserveTransparent ? lookup.palette.count : null;

    let indices = quantizeRect({
      frame,
      rect,
      lookup,
      dither: this.opts.dither,
      include,
      skipIndex: transparentIndex ?? 0,
      alphaTransparent: this.alpha,
    });

    if (this.frameDiff && this.displayed && transparentIndex !== null) {
      const cropped = this.dropAlreadyDisplayed(indices, rect, lookup.palette, transparentIndex);
      if (!cropped) {
        this.storeRaw(data);
        this.extendDelay(delayCs, chunks);
        return chunks;
      }
      ({ indices, rect } = cropped);
    }

    if (this.frameDiff) {
      this.storeRaw(data);
      this.paintDisplayed(indices, rect, lookup.palette, transparentIndex);
    }

    const body = new ByteWriter(indices.length / 2 + 1024);
    writeImage(body, {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      indices,
      localTable,
      tableEntries: entries,
    });
    const bytes = body.toBytes();
    if (index === 0) this._firstFrameBytes = GCE_BYTES + bytes.length;
    this._encodedBytes += GCE_BYTES + bytes.length;

    this.flushPending(chunks);
    this.pending = {
      body: bytes,
      delayCs,
      disposal: this.alpha ? Disposal.restoreBackground : Disposal.keep,
      transparentIndex,
    };
    return chunks;
  }

  /** Flush the buffered frame and write the trailer. */
  finish(): Uint8Array[] {
    if (this.finished) throw new Error("GIF encoder already finished");
    if (this._framesAdded === 0) throw new Error("GIF has no frames");
    this.finished = true;
    const chunks: Uint8Array[] = [];
    this.flushPending(chunks, true);
    return chunks;
  }

  private checkFrame(frame: RgbaFrame): void {
    if (this.finished) throw new Error("GIF encoder already finished");
    if (frame.width !== this.width || frame.height !== this.height)
      throw new RangeError(
        `frame ${frame.width}x${frame.height} does not match GIF ${this.width}x${this.height}`,
      );
    if (frame.data.length < this.width * this.height * 4)
      throw new RangeError("frame data too short");
  }

  private prepareHeader(firstFrame: RgbaFrame): void {
    let globalTable: Uint8Array | null = null;
    if (!this.adaptive) {
      if (this.sampleHist.total === 0)
        this.sampleHist.addFrame(firstFrame, { skipTransparent: this.alpha });
      const palette = medianCut(this.sampleHist, this.paletteColors);
      this.globalLookup = createColorLookup(palette);
      this.globalEntries = palette.count + (this.reserveTransparent ? 1 : 0);
      globalTable = toColorTable(palette, this.globalEntries);
    }
    const w = new ByteWriter(1024);
    writeHeader(w, { width: this.width, height: this.height, globalTable, loop: this.opts.loop });
    this.headerBytes = w.toBytes();
    this._encodedBytes = this.headerBytes.length;
  }

  /** Mark pixels whose quantized color is already on screen transparent; crop to what's left. */
  private dropAlreadyDisplayed(
    indices: Uint8Array,
    rect: Rect,
    palette: Palette,
    transparentIndex: number,
  ): { indices: Uint8Array; rect: Rect } | null {
    const displayed = this.displayed as Uint8Array;
    const { rgb } = palette;
    let minX = rect.width;
    let minY = rect.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < rect.height; y++)
      for (let x = 0; x < rect.width; x++) {
        const i = y * rect.width + x;
        const idx = indices[i] ?? 0;
        if (idx === transparentIndex) continue;
        const d = ((rect.y + y) * this.width + rect.x + x) * 3;
        if (
          rgb[idx * 3] === displayed[d] &&
          rgb[idx * 3 + 1] === displayed[d + 1] &&
          rgb[idx * 3 + 2] === displayed[d + 2]
        ) {
          indices[i] = transparentIndex;
          continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    if (maxX < 0) return null;
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    if (cw === rect.width && ch === rect.height) return { indices, rect };
    const out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const src = (minY + y) * rect.width + minX;
      out.set(indices.subarray(src, src + cw), y * cw);
    }
    return { indices: out, rect: { x: rect.x + minX, y: rect.y + minY, width: cw, height: ch } };
  }

  private storeRaw(data: Uint8Array | Uint8ClampedArray): void {
    const n = this.width * this.height * 4;
    if (!this.prevRaw) this.prevRaw = new Uint8Array(n);
    this.prevRaw.set(data.subarray(0, n));
  }

  private paintDisplayed(
    indices: Uint8Array,
    rect: Rect,
    palette: Palette,
    transparentIndex: number | null,
  ): void {
    if (!this.displayed) this.displayed = new Uint8Array(this.width * this.height * 3);
    const displayed = this.displayed;
    const { rgb } = palette;
    for (let y = 0; y < rect.height; y++)
      for (let x = 0; x < rect.width; x++) {
        const idx = indices[y * rect.width + x] ?? 0;
        if (idx === transparentIndex) continue;
        const d = ((rect.y + y) * this.width + rect.x + x) * 3;
        displayed[d] = rgb[idx * 3] ?? 0;
        displayed[d + 1] = rgb[idx * 3 + 1] ?? 0;
        displayed[d + 2] = rgb[idx * 3 + 2] ?? 0;
      }
  }

  /** An unchanged frame lengthens the buffered frame (or adds a 1×1 transparent frame at the u16 cap). */
  private extendDelay(delayCs: number, chunks: Uint8Array[]): void {
    const pending = this.pending as PendingFrame;
    if (pending.delayCs + delayCs <= MAX_DELAY_CS) {
      pending.delayCs += delayCs;
      return;
    }
    const t = this.globalLookup ? this.globalLookup.palette.count : 1;
    const entries = this.adaptive ? 2 : this.globalEntries;
    const body = new ByteWriter(64);
    writeImage(body, {
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      indices: Uint8Array.of(t),
      localTable: this.adaptive ? new Uint8Array(6) : null,
      tableEntries: entries,
    });
    const bytes = body.toBytes();
    this._encodedBytes += GCE_BYTES + bytes.length;
    this.flushPending(chunks);
    this.pending = { body: bytes, delayCs, disposal: Disposal.keep, transparentIndex: t };
  }

  private flushPending(chunks: Uint8Array[], withTrailer = false): void {
    const pending = this.pending;
    const w = new ByteWriter((pending?.body.length ?? 0) + (this.headerFlushed ? 16 : 1024));
    if (!this.headerFlushed && this.headerBytes) {
      w.bytes(this.headerBytes);
      this.headerFlushed = true;
    }
    if (pending) {
      writeGraphicControl(w, pending);
      w.bytes(pending.body);
      this.pending = null;
    }
    if (withTrailer) w.byte(GIF_TRAILER);
    if (w.length === 0) return;
    const chunk = w.toBytes();
    this._bytesEmitted += chunk.length;
    chunks.push(chunk);
  }
}
