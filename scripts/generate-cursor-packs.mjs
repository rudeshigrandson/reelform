#!/usr/bin/env node
/**
 * Cursor style packs (ENGINEERING_SPEC §6.6 / §9.2). Original, hand-authored
 * vector artwork — no OS cursor art is copied. Each glyph is drawn on a 64×64
 * viewBox (the @2x equivalent of a 32 pt cursor), so a pack renders crisply at
 * any cursor size.
 *
 *   public/cursors/<pack>/<kind>.svg
 *   public/cursors/<pack>/pack.json
 *
 * pack.json carries the workstream shape `{ name, hotspots, files }` and the
 * `{ scale, cursors }` shape of the macOS helper's `CursorPackManifest`
 * (electron/native/mac/protocol.ts), so either reader accepts it. Hotspots are
 * in viewBox units (= @2x pixels).
 *
 * Usage: node scripts/generate-cursor-packs.mjs [--out <dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VIEWBOX = 64;
export const CURSOR_KINDS = [
  "arrow",
  "ibeam",
  "hand",
  "grab",
  "resize-ew",
  "resize-ns",
  "resize-nesw",
  "resize-nwse",
];

/** Glyph geometry shared by the outline packs. `fill`/`stroke` are swapped per pack. */
const GLYPHS = {
  arrow: {
    hotspot: [12, 8],
    body: '<path d="M12 8 L12 50 L22.5 40 L29.5 55.5 L37 52.2 L30.2 37.2 L44.5 37.2 Z" stroke-linejoin="round"/>',
  },
  ibeam: {
    hotspot: [32, 32],
    body: '<path d="M24 12 H29 Q32 12 32 15 Q32 12 35 12 H40 V16 H36 Q34 16 34 18 V46 Q34 48 36 48 H40 V52 H35 Q32 52 32 49 Q32 52 29 52 H24 V48 H28 Q30 48 30 46 V18 Q30 16 28 16 H24 Z" stroke-linejoin="round"/>',
  },
  hand: {
    hotspot: [27, 10],
    body: '<path d="M23 30 V14 Q23 9 27 9 Q31 9 31 14 V27 L31 24 Q31 20 35 20 Q39 20 39 24 V28 Q39 24 43 24 Q47 24 47 28 V31 Q47 28 50.5 28 Q54 28 54 32 V42 Q54 56 40 56 H33 Q25 56 20 49 L11 37 Q9 33.5 12 31.5 Q15 29.5 18 32 Z" stroke-linejoin="round"/>',
  },
  grab: {
    hotspot: [32, 30],
    body: '<path d="M16 32 V27 Q16 23 20 23 Q24 23 24 27 V24 Q24 20 28 20 Q32 20 32 24 V23 Q32 19 36 19 Q40 19 40 23 V25 Q40 21 44 21 Q48 21 48 25 V42 Q48 55 36 55 H30 Q22 55 18 48 L13 39 Q11 35 14 33.5 Q16 32.5 16 32 Z" stroke-linejoin="round"/>',
  },
  "resize-ew": {
    hotspot: [32, 32],
    body: '<path d="M6 32 L18 20 V27 H46 V20 L58 32 L46 44 V37 H18 V44 Z" stroke-linejoin="round"/>',
  },
  "resize-ns": {
    hotspot: [32, 32],
    body: '<path d="M32 6 L44 18 H37 V46 H44 L32 58 L20 46 H27 V18 H20 Z" stroke-linejoin="round"/>',
  },
  "resize-nesw": {
    hotspot: [32, 32],
    body: '<path d="M32 6 L44 18 H37 V46 H44 L32 58 L20 46 H27 V18 H20 Z" stroke-linejoin="round" transform="rotate(45 32 32)"/>',
  },
  "resize-nwse": {
    hotspot: [32, 32],
    body: '<path d="M32 6 L44 18 H37 V46 H44 L32 58 L20 46 H27 V18 H20 Z" stroke-linejoin="round" transform="rotate(-45 32 32)"/>',
  },
};

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX}" height="${VIEWBOX}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">${inner}</svg>\n`;

/** Soft drop shadow shared by the outline packs (pure SVG filter, no raster). */
const SHADOW =
  '<defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.35"/></filter></defs>';

function outlinePack(fill, stroke, strokeWidth) {
  const files = {};
  for (const kind of CURSOR_KINDS) {
    const g = GLYPHS[kind];
    files[kind] = svg(
      `${SHADOW}<g filter="url(#s)" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${g.body}</g>`,
    );
  }
  return files;
}

/** "Dot": a single soft disc for every cursor type (hotspot at centre). */
function dotPack() {
  const files = {};
  for (const kind of CURSOR_KINDS) {
    files[kind] = svg(
      '<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e8e8e8"/></radialGradient></defs>' +
        '<circle cx="32" cy="32" r="14" fill="#000000" fill-opacity="0.18"/>' +
        '<circle cx="32" cy="32" r="11" fill="url(#g)" stroke="#1c1c1c" stroke-opacity="0.55" stroke-width="2"/>',
    );
  }
  return files;
}

export const PACKS = {
  macos: { name: "macOS", art: () => outlinePack("#111111", "#ffffff", 3.5), dot: false },
  "macos-dark": {
    name: "macOS Dark",
    art: () => outlinePack("#ffffff", "#111111", 3.5),
    dot: false,
  },
  windows: { name: "Windows", art: () => outlinePack("#ffffff", "#000000", 2.5), dot: false },
  dot: { name: "Dot", art: dotPack, dot: true },
};

export function buildPack(id) {
  const def = PACKS[id];
  const svgs = def.art();
  const hotspots = {};
  const files = {};
  const cursors = {};
  for (const kind of CURSOR_KINDS) {
    const hotspot = def.dot ? [32, 32] : GLYPHS[kind].hotspot;
    const file = `${kind}.svg`;
    hotspots[kind] = hotspot;
    files[kind] = file;
    cursors[kind] = { file, hotspot, size: [VIEWBOX, VIEWBOX] };
  }
  const manifest = {
    name: def.name,
    viewBox: [0, 0, VIEWBOX, VIEWBOX],
    scale: 2,
    hotspots,
    files,
    cursors,
  };
  return { manifest, svgs };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outIdx = process.argv.indexOf("--out");
  const outDir =
    outIdx > 0 && process.argv[outIdx + 1]
      ? resolve(process.argv[outIdx + 1])
      : join(root, "public", "cursors");
  for (const id of Object.keys(PACKS)) {
    const dir = join(outDir, id);
    mkdirSync(dir, { recursive: true });
    const { manifest, svgs } = buildPack(id);
    for (const [kind, text] of Object.entries(svgs)) writeFileSync(join(dir, `${kind}.svg`), text);
    writeFileSync(join(dir, "pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`cursors/${id}: ${Object.keys(svgs).length} glyphs`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
