/** Growable little-endian byte buffer used by the GIF writer and LZW packer. */
export class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 4096) {
    this.buf = new Uint8Array(Math.max(16, initialCapacity));
  }

  get length(): number {
    return this.len;
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  }

  bytes(src: ArrayLike<number>): void {
    this.ensure(src.length);
    if (src instanceof Uint8Array) this.buf.set(src, this.len);
    else for (let i = 0; i < src.length; i++) this.buf[this.len + i] = (src[i] ?? 0) & 0xff;
    this.len += src.length;
  }

  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  /** Copy of the written bytes. */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
