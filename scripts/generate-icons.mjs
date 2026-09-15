#!/usr/bin/env node
/**
 * Deterministic app + tray icon generation (PLAN §4 App, SPEC §11 "Tray/menu
 * bar: template icon; red dot while recording"). A tiny pure-JS PNG encoder
 * (node:zlib) rasterizes shapes described with signed distance functions, with
 * 4×4 supersampled anti-aliasing. Outputs are committed.
 *
 *   build/icon.png                   1024×1024 app icon (electron-builder converts to icns/ico)
 *   build/icons/<size>x<size>.png    16…1024 (Linux icon set)
 *   build/tray/trayTemplate.png      16×16  black + alpha (macOS template image)
 *   build/tray/trayTemplate@2x.png   32×32
 *   build/tray/trayRecording.png     16×16  template glyph + red recording dot
 *   build/tray/trayRecording@2x.png  32×32
 *
 * Usage: node scripts/generate-icons.mjs [--out <buildDir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// ── PNG encoder ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode straight-alpha RGBA8 pixels (Uint8Array, width*height*4) as PNG. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, row + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Rasterizer ──────────────────────────────────────────────────────────────

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Signed distance to a rounded box centred at (cx, cy) in unit space. */
function sdRoundBox(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

/** Signed distance to a triangle (a, b, c) — iq's formula. */
function sdTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const [e0x, e0y] = [bx - ax, by - ay];
  const [e1x, e1y] = [cx - bx, cy - by];
  const [e2x, e2y] = [ax - cx, ay - cy];
  const [v0x, v0y] = [px - ax, py - ay];
  const [v1x, v1y] = [px - bx, py - by];
  const [v2x, v2y] = [px - cx, py - cy];
  const proj = (vx, vy, ex, ey) => {
    const t = clamp01((vx * ex + vy * ey) / (ex * ex + ey * ey));
    return [vx - ex * t, vy - ey * t];
  };
  const [p0x, p0y] = proj(v0x, v0y, e0x, e0y);
  const [p1x, p1y] = proj(v1x, v1y, e1x, e1y);
  const [p2x, p2y] = proj(v2x, v2y, e2x, e2y);
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d = Math.min(p0x * p0x + p0y * p0y, p1x * p1x + p1y * p1y, p2x * p2x + p2y * p2y);
  const sx = Math.min(
    s * (v0x * e0y - v0y * e0x),
    s * (v1x * e1y - v1y * e1x),
    s * (v2x * e2y - v2y * e2x),
  );
  return -Math.sqrt(d) * Math.sign(sx);
}

/**
 * Render `size`² pixels. `paint(x, y)` receives unit coords (0–1) and returns
 * straight RGBA in 0–1 or null for transparent. 4×4 supersampling.
 */
export function rasterize(size, paint) {
  const out = new Uint8Array(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = paint((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          if (!c) continue;
          // Accumulate premultiplied.
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      out[i + 3] = Math.round(alpha * 255);
      if (a > 0) {
        out[i] = Math.round((r / a) * 255);
        out[i + 1] = Math.round((g / a) * 255);
        out[i + 2] = Math.round((b / a) * 255);
      }
    }
  }
  return out;
}

const hex = (h, alpha = 1) => [
  Number.parseInt(h.slice(1, 3), 16) / 255,
  Number.parseInt(h.slice(3, 5), 16) / 255,
  Number.parseInt(h.slice(5, 7), 16) / 255,
  alpha,
];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ── Artwork ─────────────────────────────────────────────────────────────────

/**
 * App icon: warm clay squircle-ish tile (macOS grid: 824/1024 body), a
 * cream "screen" frame with a play triangle, and a record dot badge.
 */
export function paintAppIcon(x, y) {
  const body = sdRoundBox(x, y, 0.5, 0.5, 0.402, 0.402, 0.18);
  if (body > 0) {
    // Soft drop shadow below the tile.
    const sh = sdRoundBox(x, y, 0.5, 0.52, 0.402, 0.402, 0.18);
    const s = clamp01(1 - sh / 0.03);
    return sh < 0.03 ? [0, 0, 0, 0.25 * s * s] : null;
  }
  // Diagonal clay gradient.
  let c = mix(hex("#f6a06b"), hex("#8c491a"), clamp01((x + y - 0.2) / 1.6));
  // Screen frame.
  const screenOuter = sdRoundBox(x, y, 0.5, 0.48, 0.26, 0.19, 0.05);
  const screenInner = sdRoundBox(x, y, 0.5, 0.48, 0.225, 0.155, 0.025);
  if (screenOuter < 0 && screenInner >= 0) c = hex("#fff2eb");
  if (screenInner < 0) c = hex("#2e2b25");
  // Play triangle inside the screen.
  if (sdTriangle(x, y, [0.46, 0.4], [0.46, 0.56], [0.585, 0.48]) < 0) c = hex("#fff2eb");
  // Stand.
  if (sdRoundBox(x, y, 0.5, 0.715, 0.09, 0.018, 0.018) < 0) c = hex("#fff2eb");
  // Record badge (top-right).
  const ring = sdCircle(x, y, 0.735, 0.285, 0.085);
  if (ring < 0) c = hex("#fff2eb");
  if (sdCircle(x, y, 0.735, 0.285, 0.058) < 0) c = hex("#e5484d");
  return c;
}

/** Tray glyph: rounded-rect screen outline + play triangle (template = black + alpha). */
function trayGlyph(x, y) {
  const outer = sdRoundBox(x, y, 0.5, 0.5, 0.44, 0.34, 0.12);
  const inner = sdRoundBox(x, y, 0.5, 0.5, 0.33, 0.23, 0.05);
  if (outer < 0 && inner >= 0) return true;
  return sdTriangle(x, y, [0.41, 0.34], [0.41, 0.66], [0.65, 0.5]) < 0;
}

export function paintTrayTemplate(x, y) {
  return trayGlyph(x, y) ? [0, 0, 0, 1] : null;
}

/**
 * Recording variant: glyph with a knocked-out red dot at the bottom-right.
 * It cannot be a template image (it has colour), so the glyph is drawn in the
 * record red too — a black glyph would vanish on a dark menu bar / taskbar.
 */
export function paintTrayRecording(x, y) {
  const dot = sdCircle(x, y, 0.78, 0.78, 0.2);
  if (dot < 0) return hex("#e5484d");
  if (dot < 0.08) return null; // knock-out ring separates dot from glyph
  return trayGlyph(x, y) ? hex("#e5484d") : null;
}

export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** Every output file: relative path → { size, paint }. */
export function iconTargets() {
  const t = { "icon.png": { size: 1024, paint: paintAppIcon } };
  for (const s of ICON_SIZES) t[`icons/${s}x${s}.png`] = { size: s, paint: paintAppIcon };
  t["tray/trayTemplate.png"] = { size: 16, paint: paintTrayTemplate };
  t["tray/trayTemplate@2x.png"] = { size: 32, paint: paintTrayTemplate };
  t["tray/trayRecording.png"] = { size: 16, paint: paintTrayRecording };
  t["tray/trayRecording@2x.png"] = { size: 32, paint: paintTrayRecording };
  return t;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outIdx = process.argv.indexOf("--out");
  const outDir =
    outIdx > 0 && process.argv[outIdx + 1]
      ? resolve(process.argv[outIdx + 1])
      : join(root, "build");
  const cache = new Map();
  for (const [rel, { size, paint }] of Object.entries(iconTargets())) {
    const key = `${paint.name}:${size}`;
    let png = cache.get(key);
    if (!png) {
      png = encodePng(size, size, rasterize(size, paint));
      cache.set(key, png);
    }
    const file = join(outDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    console.log(`${rel}  ${size}×${size}  ${png.length} bytes`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
