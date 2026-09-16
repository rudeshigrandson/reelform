import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import {
  CursorPackManifest,
  CURSOR_KINDS as MAC_CURSOR_KINDS,
} from "../../electron/native/mac/protocol";
import { CLICK_SOUNDS, CURSOR_STYLES } from "../editor/inspector/cursor/types";

/**
 * Ship-ready assets + packaging contract (SPEC §0, §9.1, §9.2, §9.5, §11,
 * §14.2): fonts, cursor packs, click sounds, icons, electron-builder config,
 * entitlements, CI workflows and the release scripts' pure pieces.
 */

const ROOT = join(__dirname, "../..");
const at = (...p: string[]) => join(ROOT, ...p);
const tmp = mkdtempSync(join(tmpdir(), "reelform-packaging-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Dynamic import of an untyped .mjs script (its exports are checked at runtime). */
// biome-ignore lint/suspicious/noExplicitAny: untyped build scripts, shapes asserted by the tests.
const importScript = (name: string): Promise<any> =>
  import(pathToFileURL(at("scripts", name)).href);

const runNode = (args: string[]) =>
  spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 60_000 });

// ── Fonts ───────────────────────────────────────────────────────────────────

describe("bundled fonts", () => {
  const css = readFileSync(at("src/design/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] as string);

  it("declares Figtree 400/600/700 and Caprasimo 400 with font-display swap", () => {
    const sig = faces.map((f) => {
      const family = /font-family:\s*"([^"]+)"/.exec(f)?.[1];
      const weight = /font-weight:\s*(\d+)/.exec(f)?.[1];
      expect(f).toMatch(/font-display:\s*swap/);
      return `${family}:${weight}`;
    });
    expect(sig.sort()).toEqual(["Caprasimo:400", "Figtree:400", "Figtree:600", "Figtree:700"]);
  });

  it("every src url is a local woff2 file that exists and has the wOF2 magic", () => {
    const urls = faces.flatMap((f) =>
      [...f.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] as string),
    );
    expect(urls).toHaveLength(4);
    for (const u of urls) {
      expect(u).toMatch(/^\.\/fonts\/[a-z0-9-]+\.woff2$/);
      const bytes = readFileSync(join(ROOT, "src/design", u));
      expect(bytes.subarray(0, 4).toString("ascii"), u).toBe("wOF2");
    }
  });

  it("keeps system-ui fallbacks in the font stacks", () => {
    expect(css).toMatch(/--font-body:\s*"Figtree",[^;]*system-ui[^;]*sans-serif;/);
    expect(css).toMatch(/--font-heading:\s*"Caprasimo",[^;]*system-ui[^;]*sans-serif;/);
  });
});

// ── Cursor packs ────────────────────────────────────────────────────────────

const CURSOR_KINDS = [
  "arrow",
  "ibeam",
  "hand",
  "grab",
  "resize-ew",
  "resize-ns",
  "resize-nesw",
  "resize-nwse",
] as const;
const CURSOR_PACKS = ["macos", "macos-dark", "windows", "dot"] as const;

interface PackJson {
  name: string;
  viewBox: [number, number, number, number];
  scale: number;
  hotspots: Record<string, [number, number]>;
  files: Record<string, string>;
  cursors: Record<string, { file: string; hotspot: [number, number]; size: [number, number] }>;
}

describe.each(CURSOR_PACKS)("cursor pack %s", (pack) => {
  const dir = at("public/cursors", pack);
  const json = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as PackJson;

  it("lists every cursor kind with an existing SVG", () => {
    expect(json.name.length).toBeGreaterThan(0);
    expect(Object.keys(json.hotspots).sort()).toEqual([...CURSOR_KINDS].sort());
    expect(Object.keys(json.files).sort()).toEqual([...CURSOR_KINDS].sort());
    for (const kind of CURSOR_KINDS) {
      const file = json.files[kind] as string;
      expect(file).not.toMatch(/[\\/]|\.\./);
      expect(existsSync(join(dir, file)), `${pack}/${file}`).toBe(true);
    }
  });

  it("hotspots are inside the SVG viewBox", () => {
    for (const kind of CURSOR_KINDS) {
      const svg = readFileSync(join(dir, json.files[kind] as string), "utf8");
      const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1]?.trim().split(/\s+/).map(Number);
      expect(vb, kind).toHaveLength(4);
      const [minX, minY, w, h] = vb as [number, number, number, number];
      expect([minX, minY, w, h]).toEqual(json.viewBox);
      const [x, y] = json.hotspots[kind] as [number, number];
      expect(x, `${kind} x`).toBeGreaterThanOrEqual(minX);
      expect(x, `${kind} x`).toBeLessThanOrEqual(minX + w);
      expect(y, `${kind} y`).toBeGreaterThanOrEqual(minY);
      expect(y, `${kind} y`).toBeLessThanOrEqual(minY + h);
    }
  });

  it("also matches the macOS helper's CursorPackManifest shape (scale 2, cursors{file,hotspot,size})", () => {
    const parsed = CursorPackManifest.safeParse(json);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
    expect(Object.keys(json.cursors).sort()).toEqual([...MAC_CURSOR_KINDS].sort());
    expect(json.scale).toBe(2);
    for (const kind of CURSOR_KINDS) {
      const c = json.cursors[kind];
      expect(c?.file).toBe(json.files[kind]);
      expect(c?.hotspot).toEqual(json.hotspots[kind]);
      expect(c?.size.every((n) => n > 0)).toBe(true);
    }
  });

  it("SVGs are self-contained (no external references, no scripts, no raster images)", () => {
    for (const kind of CURSOR_KINDS) {
      const svg = readFileSync(join(dir, json.files[kind] as string), "utf8");
      expect(svg).not.toMatch(/<script|<image|href="(?!#)|xlink:href/);
    }
  });
});

it("every non-custom cursor style in the Cursor tab has a pack (minimal-dot → dot)", () => {
  const folder = (style: string) => (style === "minimal-dot" ? "dot" : style);
  for (const style of CURSOR_STYLES.filter((s) => s !== "custom")) {
    expect(existsSync(at("public/cursors", folder(style), "pack.json")), style).toBe(true);
  }
});

// ── Click sounds ────────────────────────────────────────────────────────────

const SOUND_PACKS = ["soft", "mechanical", "pop"] as const;

function parseWav(buf: Buffer) {
  return {
    riff: buf.toString("ascii", 0, 4),
    riffSize: buf.readUInt32LE(4),
    wave: buf.toString("ascii", 8, 12),
    fmt: buf.toString("ascii", 12, 16),
    fmtSize: buf.readUInt32LE(16),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    byteRate: buf.readUInt32LE(28),
    blockAlign: buf.readUInt16LE(32),
    bits: buf.readUInt16LE(34),
    data: buf.toString("ascii", 36, 40),
    dataSize: buf.readUInt32LE(40),
  };
}

describe.each(SOUND_PACKS)("click sound %s", (pack) => {
  const buf = readFileSync(at("public/sounds", pack, "click.wav"));
  const h = parseWav(buf);

  it("is 48 kHz mono PCM16 with a consistent RIFF header", () => {
    expect(h).toMatchObject({
      riff: "RIFF",
      wave: "WAVE",
      fmt: "fmt ",
      fmtSize: 16,
      format: 1,
      channels: 1,
      sampleRate: 48_000,
      byteRate: 96_000,
      blockAlign: 2,
      bits: 16,
      data: "data",
    });
    expect(h.dataSize).toBe(buf.length - 44);
    expect(h.riffSize).toBe(buf.length - 8);
    expect(h.dataSize % 2).toBe(0);
  });

  it("is shorter than 150 ms, audible, not clipped, and ends at silence", () => {
    const samples = h.dataSize / 2;
    const ms = (samples / 48_000) * 1000;
    expect(ms).toBeGreaterThan(20);
    expect(ms).toBeLessThan(150);
    let peak = 0;
    let clipped = 0;
    for (let i = 0; i < samples; i++) {
      const v = Math.abs(buf.readInt16LE(44 + i * 2));
      peak = Math.max(peak, v);
      if (v >= 32767) clipped++;
    }
    expect(peak).toBeGreaterThan(3000);
    expect(clipped).toBeLessThan(samples * 0.01);
    expect(Math.abs(buf.readInt16LE(buf.length - 2))).toBeLessThan(50);
  });
});

it("every bundled click-sound option in the Cursor tab has a file", () => {
  for (const s of CLICK_SOUNDS.filter((c) => c !== "none" && c !== "custom")) {
    expect(existsSync(at("public/sounds", s, "click.wav")), s).toBe(true);
  }
});

// ── Icons ───────────────────────────────────────────────────────────────────

interface DecodedPng {
  width: number;
  height: number;
  pixels: Buffer;
}

/** Strict PNG reader for our encoder's output: validates signature, chunk CRCs and IHDR. */
function decodePng(buf: Buffer, crc32: (b: Uint8Array) => number): DecodedPng {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  const types: string[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    expect(crc, `${type} crc`).toBe(crc32(buf.subarray(off + 4, off + 8 + len)));
    types.push(type);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[10], data[11], data[12]]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  expect(types[0]).toBe("IHDR");
  expect(types.at(-1)).toBe("IEND");
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe((width * 4 + 1) * height);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    expect(raw[row], "filter byte").toBe(0);
    raw.copy(pixels, y * width * 4, row + 1, row + 1 + width * 4);
  }
  return { width, height, pixels };
}

describe("icons", async () => {
  const icons = await importScript("generate-icons.mjs");
  const targets = icons.iconTargets() as Record<string, { size: number }>;

  it("includes the app icon, the Linux icon set and all four tray images", () => {
    expect(Object.keys(targets)).toEqual(
      expect.arrayContaining([
        "icon.png",
        "icons/16x16.png",
        "icons/512x512.png",
        "icons/1024x1024.png",
        "tray/trayTemplate.png",
        "tray/trayTemplate@2x.png",
        "tray/trayRecording.png",
        "tray/trayRecording@2x.png",
      ]),
    );
  });

  it.each(Object.entries(targets))("%s has a valid PNG signature, CRCs and IHDR dims", (rel, t) => {
    const png = decodePng(readFileSync(at("build", rel)), icons.crc32);
    expect([png.width, png.height]).toEqual([t.size, t.size]);
  });

  it("tray template is pure black + alpha (macOS template image) and the recording variant has a red dot", () => {
    for (const rel of ["tray/trayTemplate.png", "tray/trayTemplate@2x.png"]) {
      const { pixels } = decodePng(readFileSync(at("build", rel)), icons.crc32);
      let opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i + 3] as number) === 0) continue;
        opaque++;
        expect([pixels[i], pixels[i + 1], pixels[i + 2]], rel).toEqual([0, 0, 0]);
      }
      expect(opaque).toBeGreaterThan(0);
    }
    const { pixels } = decodePng(
      readFileSync(at("build", "tray/trayRecording@2x.png")),
      icons.crc32,
    );
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        (pixels[i + 3] as number) > 200 &&
        (pixels[i] as number) > 200 &&
        (pixels[i + 1] as number) < 120
      )
        red++;
    }
    expect(red).toBeGreaterThan(20);
  });

  it("recording tray variant (non-template) has no dark pixels that would vanish on a dark menu bar", () => {
    for (const rel of ["tray/trayRecording.png", "tray/trayRecording@2x.png"]) {
      const { pixels } = decodePng(readFileSync(at("build", rel)), icons.crc32);
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i + 3] as number) < 128) continue;
        const luma =
          0.2126 * (pixels[i] as number) +
          0.7152 * (pixels[i + 1] as number) +
          0.0722 * (pixels[i + 2] as number);
        expect(luma, rel).toBeGreaterThan(60);
      }
    }
  });

  it("app icon has transparent corners and an opaque centre", () => {
    const { width, pixels } = decodePng(readFileSync(at("build/icons/256x256.png")), icons.crc32);
    expect(pixels[3]).toBe(0);
    expect(pixels[(128 * width + 128) * 4 + 3]).toBe(255);
  });

  it("encodePng round-trips arbitrary pixels (edge: 1×1 and non-square)", () => {
    for (const [w, h] of [
      [1, 1],
      [3, 2],
    ] as const) {
      const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256);
      const decoded = decodePng(icons.encodePng(w, h, rgba), icons.crc32);
      expect([decoded.width, decoded.height]).toEqual([w, h]);
      expect([...decoded.pixels]).toEqual([...rgba]);
    }
  });

  it("crc32 matches the reference value", () => {
    expect(icons.crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("regenerating reproduces the committed pixels", { timeout: 60_000 }, () => {
    const out = join(tmp, "icons");
    const r = runNode(["scripts/generate-icons.mjs", "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    for (const rel of Object.keys(targets)) {
      const a = decodePng(readFileSync(join(out, rel)), icons.crc32);
      const b = decodePng(readFileSync(at("build", rel)), icons.crc32);
      expect(a.pixels.equals(b.pixels), rel).toBe(true);
    }
  });
});

describe("deterministic generators", () => {
  it("click sounds regenerate byte-identically", { timeout: 30_000 }, () => {
    const out = join(tmp, "sounds");
    const r = runNode(["scripts/generate-click-sounds.mjs", "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    for (const p of SOUND_PACKS) {
      expect(
        readFileSync(join(out, p, "click.wav")).equals(
          readFileSync(at("public/sounds", p, "click.wav")),
        ),
        p,
      ).toBe(true);
    }
  });

  it("cursor packs regenerate byte-identically", { timeout: 30_000 }, () => {
    const out = join(tmp, "cursors");
    const r = runNode(["scripts/generate-cursor-packs.mjs", "--out", out]);
    expect(r.status, r.stderr).toBe(0);
    for (const p of CURSOR_PACKS) {
      const committed = readdirSync(at("public/cursors", p)).sort();
      expect(readdirSync(join(out, p)).sort()).toEqual(committed);
      for (const f of committed) {
        const fresh = readFileSync(join(out, p, f));
        const saved = readFileSync(at("public/cursors", p, f));
        // pack.json is committed Biome-formatted, so compare it structurally.
        if (f.endsWith(".json")) {
          expect(JSON.parse(fresh.toString("utf8")), `${p}/${f}`).toEqual(
            JSON.parse(saved.toString("utf8")),
          );
        } else {
          expect(fresh.equals(saved), `${p}/${f}`).toBe(true);
        }
      }
    }
  });
});

// ── electron-builder config ─────────────────────────────────────────────────

/**
 * Parse the JSON5 subset the config is written in: `//` + block comments and
 * trailing commas. Comment markers inside strings are preserved.
 */
function parseJson5Subset(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) throw new Error("unterminated block comment");
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

describe("parseJson5Subset", () => {
  it("handles comments, trailing commas and comment-like text inside strings", () => {
    expect(parseJson5Subset('{\n// c\n"a": "http://x", /* b */ "b": [1, 2,],\n}')).toEqual({
      a: "http://x",
      b: [1, 2],
    });
    expect(parseJson5Subset('{"q": "say \\"//hi\\""}')).toEqual({ q: 'say "//hi"' });
    expect(() => parseJson5Subset('{"a": 1 /* open')).toThrow();
  });
});

describe("electron-builder.json5", () => {
  // biome-ignore lint/suspicious/noExplicitAny: loosely-typed third-party config, fields asserted below.
  const cfg = parseJson5Subset(readFileSync(at("electron-builder.json5"), "utf8")) as any;

  it("identifies the app and packs the built bundles into asar", () => {
    expect(cfg.appId).toMatch(/^[a-z0-9]+(\.[a-z0-9]+)+$/);
    expect(cfg.productName).toBe("Reelform");
    expect(cfg.directories.buildResources).toBe("build");
    expect(cfg.files).toEqual(expect.arrayContaining(["dist/**/*", "dist-electron/**/*"]));
    expect(cfg.asar).toBe(true);
    expect(cfg.asarUnpack).toEqual(expect.arrayContaining(["node_modules/ffmpeg-static/**"]));
    const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
    expect(cfg.extraMetadata.main).toBe(pkg.main);
  });

  it("mac: universal dmg, hardened runtime, entitlements, notarize, usage strings, package UTI", () => {
    const mac = cfg.mac;
    expect(mac.target).toEqual(expect.arrayContaining([{ target: "dmg", arch: ["universal"] }]));
    expect(mac.hardenedRuntime).toBe(true);
    expect(mac.notarize).toBe(true);
    for (const f of [mac.entitlements, mac.entitlementsInherit, mac.icon])
      expect(existsSync(at(f)), f).toBe(true);
    for (const key of [
      "NSCameraUsageDescription",
      "NSMicrophoneUsageDescription",
      "NSScreenCaptureUsageDescription",
      "NSInputMonitoringUsageDescription",
    ]) {
      expect(typeof mac.extendInfo[key], key).toBe("string");
      expect(mac.extendInfo[key].length).toBeGreaterThan(10);
    }
    const uti = mac.extendInfo.UTExportedTypeDeclarations[0];
    expect(uti.UTTypeConformsTo).toContain("com.apple.package");
    expect(uti.UTTypeTagSpecification["public.filename-extension"]).toEqual(["reelform"]);
  });

  it("native helpers land at <resources>/bin/<platform>-<arch> (what capture verifies)", () => {
    const bin = (list: { from: string; to: string; filter: string[] }[]) =>
      list.find((r) => r.from === "electron/native/bin");
    expect(bin(cfg.mac.extraResources)).toEqual({
      from: "electron/native/bin",
      to: "bin",
      filter: ["darwin-*/**/*"],
    });
    expect(bin(cfg.win.extraResources)?.to).toBe("bin");
    // whisper-cli path matches electron/captions/runtime.ts: <resources>/whisper/<platform>-<arch>.
    for (const os of ["mac", "win", "linux"]) {
      expect(
        cfg[os].extraResources.some((r: { to: string }) => r.to === "whisper"),
        os,
      ).toBe(true);
    }
    expect(readFileSync(at("electron/captions/runtime.ts"), "utf8")).toContain('"whisper"');
  });

  it("win nsis with a publisherName placeholder; linux AppImage", () => {
    expect(cfg.win.target[0].target).toBe("nsis");
    expect(cfg.win.signtoolOptions.publisherName.length).toBe(1);
    expect(cfg.linux.target[0].target).toBe("AppImage");
    expect(existsSync(at(cfg.linux.icon))).toBe(true);
  });

  it(".reelform association and reelform:// protocol match electron/windows/launchArgs.ts", () => {
    const launchArgs = readFileSync(at("electron/windows/launchArgs.ts"), "utf8");
    expect(launchArgs).toContain('PROJECT_EXTENSION = ".reelform"');
    expect(launchArgs).toContain("reelform://");
    expect(cfg.fileAssociations[0]).toMatchObject({ ext: "reelform", isPackage: true });
    expect(cfg.protocols[0].schemes).toEqual(["reelform"]);
  });

  it("publishes to GitHub as a draft with update files for Stable and Beta channels", () => {
    expect(cfg.publish[0]).toMatchObject({ provider: "github", releaseType: "draft" });
    expect(cfg.generateUpdatesFilesForAllChannels).toBe(true);
  });

  it("validates against the installed electron-builder configuration schema", () => {
    const require = createRequire(at("package.json"));
    // biome-ignore lint/suspicious/noExplicitAny: ajv is a transitive dependency without local typings in scope.
    const Ajv: any = require("ajv");
    const schema = JSON.parse(
      readFileSync(require.resolve("app-builder-lib/scheme.json"), "utf8"),
    ) as object;
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    const ok = validate(cfg);
    expect(ok, JSON.stringify(validate.errors?.slice(0, 5))).toBe(true);
    // Sanity: the schema rejects unknown keys, so a pass is meaningful.
    expect(validate({ ...cfg, notARealOption: true })).toBe(false);
  });

  it("afterPack hook exists and mac.signIgnore covers only the helper bin dir", () => {
    expect(existsSync(at(cfg.afterPack))).toBe(true);
    const ignores = (cfg.mac.signIgnore as string[]).map((r) => new RegExp(r));
    const hit = (p: string) => ignores.some((r) => r.test(p));
    expect(hit("/x/Reelform.app/Contents/Resources/bin/darwin-arm64/reelform-sck")).toBe(true);
    expect(hit("/x/Reelform.app/Contents/Resources/whisper/darwin-arm64/whisper-cli")).toBe(false);
    expect(hit("/x/Reelform.app/Contents/Frameworks/Electron Framework.framework")).toBe(false);
  });

  it("ships LICENSE, NOTICE.md and THIRD_PARTY_LICENSES.txt into <resources>/licenses on every OS", () => {
    const expected = [
      { from: "LICENSE", to: "licenses/LICENSE" },
      { from: "NOTICE.md", to: "licenses/NOTICE.md" },
      { from: "THIRD_PARTY_LICENSES.txt", to: "licenses/THIRD_PARTY_LICENSES.txt" },
    ];
    for (const os of ["mac", "win", "linux"]) {
      expect(cfg[os].extraResources, os).toEqual(expect.arrayContaining(expected));
      // ffmpeg + whisper folders (with their LICENSE.txt / SOURCE.txt) ship everywhere.
      for (const to of ["ffmpeg", "whisper"]) {
        expect(
          cfg[os].extraResources.some((r: { to: string }) => r.to === to),
          `${os} ${to}`,
        ).toBe(true);
      }
    }
    for (const { from } of expected.slice(0, 2)) expect(existsSync(at(from)), from).toBe(true);
  });

  it("contains no inline secrets", () => {
    const text = readFileSync(at("electron-builder.json5"), "utf8");
    expect(text).not.toMatch(/"(password|cscKeyPassword|appleIdPassword|token)"\s*:/i);
  });
});

describe("entitlements", () => {
  it.each(["build/entitlements.mac.plist", "build/entitlements.mac.inherit.plist"])(
    "%s is a plist granting JIT, camera and microphone",
    (rel) => {
      const text = readFileSync(at(rel), "utf8");
      expect(text.startsWith("<?xml")).toBe(true);
      expect(text).toMatch(/<plist version="1.0">[\s\S]*<\/plist>/);
      for (const key of [
        "com.apple.security.cs.allow-jit",
        "com.apple.security.device.camera",
        "com.apple.security.device.audio-input",
      ]) {
        expect(text).toMatch(new RegExp(`<key>${key.replaceAll(".", "\\.")}</key>\\s*<true/>`));
      }
      // Balanced <key>/<value> pairs inside <dict>.
      const keys = (text.match(/<key>/g) ?? []).length;
      const values = (text.match(/<true\/>|<false\/>/g) ?? []).length;
      expect(keys).toBe(values);
    },
  );
});

// ── Release scripts ─────────────────────────────────────────────────────────

describe("build-native-helpers manifest", async () => {
  const native = await importScript("build-native-helpers.mjs");

  it("writes the HelperManifest shape electron/capture verifies", () => {
    const dir = join(tmp, "bin-darwin-arm64");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "reelform-sck"), "sck");
    writeFileSync(join(dir, "reelform-cursor-monitor"), "cursor");
    const manifest = native.buildManifest(dir, native.MAC_PRODUCTS, "1.2.3");
    expect(manifest).toEqual({
      version: "1.2.3",
      files: {
        "reelform-cursor-monitor": { sha256: createHash("sha256").update("cursor").digest("hex") },
        "reelform-sck": { sha256: createHash("sha256").update("sck").digest("hex") },
      },
    });
    // Same regex as electron/capture/manifest.ts HelperManifest.
    for (const f of Object.values(manifest.files) as { sha256: string }[]) {
      expect(f.sha256).toMatch(/^[0-9a-fA-F]{64}$/);
    }
    // Product names match what the capture backend spawns.
    expect(readFileSync(at("electron/capture/sckBackend.ts"), "utf8")).toContain('"reelform-sck"');
  });
});

describe("after-pack hook (helper manifests survive code signing)", () => {
  const require = createRequire(at("package.json"));
  // biome-ignore lint/suspicious/noExplicitAny: untyped CommonJS hook, shapes asserted by the tests.
  const hook: any = require(at("scripts/after-pack.cjs"));
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  const makeBin = (name: string) => {
    const bin = join(tmp, name, "resources", "bin");
    const dir = join(bin, "win32-x64");
    rmSync(join(tmp, name), { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "reelform-wgc.exe"), "unsigned");
    writeFileSync(join(dir, "reelform-hw-probe.exe"), "probe");
    writeFileSync(join(dir, "stray.txt"), "not listed");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        version: "1.0.0",
        files: {
          "reelform-wgc.exe": { sha256: sha("unsigned") },
          "reelform-hw-probe.exe": { sha256: sha("probe") },
        },
      }),
    );
    return { root: join(tmp, name), bin, dir };
  };

  it("re-hashes signed binaries, keeps version and the listed set", () => {
    const { bin, dir } = makeBin("rehash");
    writeFileSync(join(dir, "reelform-wgc.exe"), "signed bytes");
    expect(hook.rewriteHelperManifests(bin)).toEqual([join(dir, "manifest.json")]);
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).toEqual({
      version: "1.0.0",
      files: {
        "reelform-hw-probe.exe": { sha256: sha("probe") },
        "reelform-wgc.exe": { sha256: sha("signed bytes") },
      },
    });
  });

  it("fails loudly when a listed helper is missing, and ignores a missing bin dir", () => {
    const { bin, dir } = makeBin("missing");
    rmSync(join(dir, "reelform-hw-probe.exe"));
    expect(() => hook.rewriteHelperManifests(bin)).toThrow(/missing/);
    expect(hook.rewriteHelperManifests(join(tmp, "nope"))).toEqual([]);
  });

  it("runs end-to-end for a Windows pack context", async () => {
    const { root, dir } = makeBin("win-e2e");
    writeFileSync(join(dir, "reelform-wgc.exe"), "authenticode-signed");
    await hook({
      appOutDir: root,
      electronPlatformName: "win32",
      packager: { appInfo: { productFilename: "Reelform" } },
    });
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(m.files["reelform-wgc.exe"].sha256).toBe(sha("authenticode-signed"));
  });

  it("skips the per-arch temp apps of a universal mac build", async () => {
    expect(hook.isUniversalIntermediate("/r/mac-universal-x64-temp")).toBe(true);
    expect(hook.isUniversalIntermediate("/r/mac-universal-arm64-temp/")).toBe(true);
    expect(hook.isUniversalIntermediate("/r/mac-universal")).toBe(false);
    const appOutDir = join(tmp, "mac-universal-arm64-temp");
    const dir = join(appOutDir, "Reelform.app/Contents/Resources/bin/darwin-arm64");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "reelform-sck"), "changed");
    const manifest = JSON.stringify({ files: { "reelform-sck": { sha256: sha("orig") } } });
    writeFileSync(join(dir, "manifest.json"), manifest);
    await hook({
      appOutDir,
      electronPlatformName: "darwin",
      packager: { appInfo: { productFilename: "Reelform" } },
    });
    expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(manifest);
  });

  it("codesign args: hardened runtime, timestamp, inherited entitlements, optional keychain", () => {
    const args: string[] = hook.codesignArgs("/a/reelform-sck", "ABC123", null);
    expect(args.slice(0, 4)).toEqual(["--force", "--options", "runtime", "--timestamp"]);
    expect(args[5]).toBe(at("build/entitlements.mac.inherit.plist"));
    expect(args.at(-1)).toBe("/a/reelform-sck");
    expect(args).not.toContain("--keychain");
    expect(hook.codesignArgs("/a/x", "ABC", "/k.keychain")).toContain("/k.keychain");
  });
});

describe("fetch-ffmpeg", async () => {
  const ffmpeg = await importScript("fetch-ffmpeg.mjs");

  it("pins every packaged target to a versioned https archive with a real sha256", () => {
    const tools = new Map<string, Set<string>>();
    for (const target of ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"]) {
      const entries = ffmpeg.assertPinned(target) as {
        tool: string;
        url: string;
        license: string;
      }[];
      const have = new Set<string>();
      for (const e of entries) {
        expect(e.url, target).not.toMatch(/latest/i);
        expect(e.url, target).toContain(ffmpeg.FFMPEG_VERSION);
        expect(e.license, target).toMatch(/^(L?GPL)-/);
        for (const t of ffmpeg.toolsIn(e)) have.add(t);
      }
      tools.set(target, have);
    }
    for (const [target, have] of tools)
      expect([...have].sort(), target).toEqual(["ffmpeg", "ffprobe"]);
    for (const [target, entries] of Object.entries(ffmpeg.PINS) as [
      string,
      { sha256: string | null }[],
    ][]) {
      for (const e of entries)
        expect(e.sha256 === null || /^[0-9a-f]{64}$/.test(e.sha256), target).toBe(true);
    }
  });

  it("refuses unpinned targets with a clear error", () => {
    const pins = {
      "linux-x64": [{ tool: "both", url: "https://x/a.tar.xz", sha256: null, archive: "tar.xz" }],
    };
    expect(() => ffmpeg.assertPinned("linux-x64", { pins })).toThrow(/not pinned/);
    expect(() => ffmpeg.assertPinned("linux-x64", { pins, requireHash: false })).not.toThrow();
    const noUrl = { t: [{ tool: "ffmpeg", url: null, sha256: null, archive: "zip" }] };
    expect(() => ffmpeg.assertPinned("t", { pins: noUrl })).toThrow(
      /not pinned.*Refusing to download an unverified binary/,
    );
    const http = {
      t: [{ tool: "ffmpeg", url: "http://x/a.zip", sha256: "0".repeat(64), archive: "zip" }],
    };
    expect(() => ffmpeg.assertPinned("t", { pins: http })).toThrow(/https/);
    expect(() => ffmpeg.assertPinned("plan9-mips")).toThrow(/unknown ffmpeg target/);
  });

  it("CLI exits non-zero without downloading for an unknown target", () => {
    const r = runNode(["scripts/fetch-ffmpeg.mjs", "--target", "plan9-mips"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown ffmpeg target plan9-mips/);
  });

  it("extracts zip with bsdtar or unzip (Linux) and tar.xz with tar", () => {
    expect(ffmpeg.extractCommand("zip", "/a.zip", "/d", "darwin")).toEqual([
      "tar",
      ["-xf", "/a.zip", "-C", "/d"],
    ]);
    expect(ffmpeg.extractCommand("zip", "/a.zip", "/d", "win32")[0]).toBe("tar");
    expect(ffmpeg.extractCommand("zip", "/a.zip", "/d", "linux")).toEqual([
      "unzip",
      ["-q", "-o", "/a.zip", "-d", "/d"],
    ]);
    expect(ffmpeg.extractCommand("tar.xz", "/a.tar.xz", "/d", "linux")).toEqual([
      "tar",
      ["-xf", "/a.tar.xz", "-C", "/d"],
    ]);
    expect(() => ffmpeg.extractCommand("rar", "/a", "/d")).toThrow(/unsupported/);
  });

  it("verifySha256File rejects a tampered archive before extraction", async () => {
    const p = join(tmpdir(), `reelform-ffmpeg-test-${process.pid}.zip`);
    writeFileSync(p, "archive");
    try {
      const hex = createHash("sha256").update("archive").digest("hex");
      await expect(ffmpeg.verifySha256File(p, hex)).resolves.toBe(hex);
      await expect(ffmpeg.verifySha256File(p, "f".repeat(64))).rejects.toThrow(/sha256 mismatch/);
    } finally {
      rmSync(p, { force: true });
    }
  });

  it("manifest records version, sources, licenses and staged file hashes", () => {
    const m = ffmpeg.buildManifest({
      target: "win32-x64",
      entries: ffmpeg.PINS["win32-x64"],
      files: { "ffmpeg.exe": { sha256: "a".repeat(64), size: 1 } },
      fetchedAt: "2026-09-15T00:00:00.000Z",
    });
    expect(m.ffmpegVersion).toBe(ffmpeg.FFMPEG_VERSION);
    expect(m.sources[0].tools).toEqual(["ffmpeg", "ffprobe"]);
    expect(m.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.sources[0].license).toMatch(/GPL/);
    expect(m.files["ffmpeg.exe"].size).toBe(1);
  });

  it("every pin maps to a builder with source + build-script URLs (GPL source offer)", () => {
    for (const [target, entries] of Object.entries(ffmpeg.PINS) as [string, { url: string }[]][]) {
      for (const e of entries) {
        const b = ffmpeg.builderFor(e.url);
        expect(b.source, target).toMatch(/^https:\/\//);
        expect(b.buildScripts, target).toMatch(/^https:\/\//);
      }
    }
    const btbn = ffmpeg.builderFor(ffmpeg.PINS["linux-x64"][0].url);
    expect(btbn.source).toBe("https://github.com/FFmpeg/FFmpeg/commit/e47273f4d9");
    expect(btbn.buildScripts).toContain("/tree/autobuild-2026-08-31-13-27");
    expect(() => ffmpeg.builderFor("https://example.com/ffmpeg.zip")).toThrow(/source-offer/);
  });

  it("writes the GPLv3 text and a written source offer next to the binaries", () => {
    const out = join(tmp, "ffmpeg-licenses");
    const project = {
      name: "reelform",
      repository: "https://github.com/rudeshigrandson/reelform",
      issues: "https://github.com/rudeshigrandson/reelform/issues",
      contact: "dev@example.com",
    };
    const written = ffmpeg.writeLicenseFiles(out, {
      target: "win32-x64",
      entries: ffmpeg.PINS["win32-x64"],
      project,
    });
    expect(written).toEqual(["LICENSE.txt", "SOURCE.txt"]);
    const license = readFileSync(join(out, "LICENSE.txt"), "utf8");
    expect(license).toBe(readFileSync(at("scripts/licenses/GPL-3.0.txt"), "utf8"));
    const source = readFileSync(join(out, "SOURCE.txt"), "utf8");
    for (const s of [
      `ffmpeg-${ffmpeg.FFMPEG_VERSION}.tar.xz`,
      `n${ffmpeg.FFMPEG_VERSION}`,
      ffmpeg.PINS["win32-x64"][0].url,
      ffmpeg.PINS["win32-x64"][0].sha256,
      "three years",
      "dev@example.com",
      project.issues,
      "scripts/fetch-ffmpeg.mjs",
    ])
      expect(source).toContain(s);
    expect(() =>
      ffmpeg.writeLicenseFiles(out, {
        target: "win32-x64",
        entries: [],
        project,
        gplText: "MIT License",
      }),
    ).toThrow(/GPLv3/);
  });

  it("vendors the verbatim GNU GPLv3 text", () => {
    const text = readFileSync(at("scripts/licenses/GPL-3.0.txt"));
    // sha256 of https://www.gnu.org/licenses/gpl-3.0.txt
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
    );
  });

  it("verifySha256 accepts matching bytes (case-insensitive) and rejects mismatches", () => {
    const bytes = Buffer.from("ffmpeg");
    const hex = createHash("sha256").update(bytes).digest("hex");
    expect(ffmpeg.verifySha256(bytes, hex.toUpperCase())).toBe(hex);
    expect(() => ffmpeg.verifySha256(bytes, "0".repeat(64))).toThrow(/sha256 mismatch/);
  });
});

describe("build-whisper-runtime flags (SPEC §9.6)", async () => {
  const whisper = await importScript("build-whisper-runtime.mjs");

  it("pins a tag", () => {
    expect(whisper.WHISPER_TAG).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("mac: Metal on, OpenMP off, per-arch OSX architectures, static", () => {
    const f: string[] = whisper.cmakeFlags({ platform: "darwin", arch: "x64" });
    expect(f).toEqual(
      expect.arrayContaining([
        "-DWHISPER_METAL=ON",
        "-DGGML_METAL=ON",
        "-DCMAKE_OSX_ARCHITECTURES=x86_64",
        "-DBUILD_SHARED_LIBS=OFF",
      ]),
    );
    expect(f).not.toContain("-DGGML_CUDA=OFF");
  });

  it("writes whisper.cpp + model MIT licenses and a source notice with the exact build flags", () => {
    const out = join(tmp, "whisper-licenses");
    const project = {
      name: "reelform",
      repository: "https://github.com/rudeshigrandson/reelform",
      issues: "https://github.com/rudeshigrandson/reelform/issues",
      contact: null,
    };
    whisper.writeWhisperLicenseFiles(out, {
      target: "win32-x64",
      variants: ["cpu", "vulkan"],
      project,
    });
    const license = readFileSync(join(out, "LICENSE.txt"), "utf8");
    expect(license).toContain("Copyright (c) 2023-2024 The ggml authors");
    expect(license).toContain("Copyright (c) 2022 OpenAI");
    const source = readFileSync(join(out, "SOURCE.txt"), "utf8");
    expect(source).toContain(`https://github.com/ggml-org/whisper.cpp/tree/${whisper.WHISPER_TAG}`);
    expect(source).toContain(`${project.repository}/blob/main/scripts/build-whisper-runtime.mjs`);
    expect(source).toContain("cpu: cmake");
    expect(source).toContain("-DGGML_VULKAN=ON");
    expect(() =>
      whisper.buildWhisperLicense({ runtimeText: "GPL", modelText: "MIT License" }),
    ).toThrow(/not MIT/);
  });

  it("win: CUDA off by default, OpenMP on, Vulkan only for the vulkan variant", () => {
    const cpu: string[] = whisper.cmakeFlags({ platform: "win32", arch: "x64" });
    expect(cpu).toEqual(
      expect.arrayContaining(["-DGGML_CUDA=OFF", "-DWHISPER_OPENMP=ON", "-DGGML_VULKAN=OFF"]),
    );
    expect(cpu.slice(-2)).toEqual(["-A", "x64"]);
    expect(whisper.cmakeFlags({ platform: "win32", arch: "x64", variant: "vulkan" })).toContain(
      "-DGGML_VULKAN=ON",
    );
    expect(whisper.cmakeFlags({ platform: "linux", arch: "x64" })).not.toContain("-A");
  });
});

// ── Third-party license notices ─────────────────────────────────────────────

describe("generate-licenses", async () => {
  const gen = await importScript("generate-licenses.mjs");
  const project = await importScript("licenses/project.mjs");

  /** Fake install: root → a (→ c@2 nested, d hoisted), b (optional missing e). */
  function fakeTree() {
    const root = mkdtempSync(join(tmp, "licenses-tree-"));
    const pkg = (dir: string, json: object, files: Record<string, string> = {}) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify(json));
      for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    };
    pkg(root, {
      name: "app",
      version: "1.0.0",
      dependencies: { a: "1", b: "1" },
      devDependencies: { devonly: "1" },
      repository: { url: "git+https://github.com/x/app.git" },
    });
    const nm = join(root, "node_modules");
    pkg(
      join(nm, "a"),
      { name: "a", version: "1.0.0", license: "MIT", dependencies: { c: "2", d: "1" } },
      {
        LICENSE: "MIT a",
      },
    );
    pkg(
      join(nm, "a", "node_modules", "c"),
      { name: "c", version: "2.0.0", license: "ISC" },
      { "LICENSE.md": "ISC c2" },
    );
    pkg(join(nm, "c"), { name: "c", version: "1.0.0", license: "ISC" });
    pkg(
      join(nm, "d"),
      { name: "d", version: "1.0.0", licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] },
      {
        COPYING: "dual",
        NOTICE: "notice d",
      },
    );
    pkg(join(nm, "b"), {
      name: "b",
      version: "3.1.0",
      license: { type: "BSD-3-Clause" },
      optionalDependencies: { e: "1" },
      repository: "git+ssh://git@github.com/x/b.git",
    });
    pkg(join(nm, "devonly"), { name: "devonly", version: "9.9.9", license: "MIT" });
    return root;
  }

  it("walks production deps transitively with Node resolution, skipping dev and missing optional deps", () => {
    const root = fakeTree();
    const pkgs = gen.collectProductionPackages(root) as {
      name: string;
      version: string;
      license: string;
      licenseFiles: string[];
    }[];
    expect(pkgs.map((p) => `${p.name}@${p.version}`)).toEqual([
      "a@1.0.0",
      "b@3.1.0",
      "c@2.0.0",
      "d@1.0.0",
    ]);
    const byName = Object.fromEntries(pkgs.map((p) => [p.name, p]));
    expect(byName.b?.license).toBe("BSD-3-Clause");
    expect(byName.d?.license).toBe("(MIT OR Apache-2.0)");
    expect(byName.d?.licenseFiles).toEqual(["COPYING", "NOTICE"]);
    expect(byName.c?.licenseFiles).toEqual(["LICENSE.md"]);
  });

  it("fails loudly when a required dependency is not installed", () => {
    const root = fakeTree();
    rmSync(join(root, "node_modules", "d"), { recursive: true });
    expect(() => gen.collectProductionPackages(root)).toThrow(
      /d \(required by a@1.0.0\) is not installed/,
    );
  });

  it("renders bundled components and every package with its license text", () => {
    const root = fakeTree();
    const text: string = gen.renderThirdPartyLicenses({
      project: project.projectInfo(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))),
      packages: gen.collectProductionPackages(root),
      bundled: gen.bundledComponents(ROOT),
    });
    for (const s of [
      "Source: https://github.com/x/app",
      "FFmpeg / FFprobe 9.0.1",
      "GNU GENERAL PUBLIC LICENSE",
      "whisper.cpp v1.7.6",
      "Copyright (c) 2022 OpenAI",
      "Electron",
      "a 1.0.0",
      "MIT a",
      "--- COPYING ---\ndual",
      "(No license file in the package; declared license: BSD-3-Clause.)",
    ])
      expect(text).toContain(s);
    expect(text).not.toContain("devonly");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("normalizes repository URLs and reads project facts from package.json", () => {
    expect(project.normalizeRepoUrl("git+https://github.com/a/b.git")).toBe(
      "https://github.com/a/b",
    );
    expect(project.normalizeRepoUrl("git@github.com:a/b.git")).toBe("https://github.com/a/b");
    expect(project.normalizeRepoUrl(undefined)).toBeNull();
    const info = project.projectInfo();
    const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
    expect(`${info.repository}.git`).toBe(pkg.repository.url);
    expect(info.issues).toBe(`${info.repository}/issues`);
    expect(() => project.projectInfo({ name: "x" })).toThrow(/repository/);
  });

  it("NOTICE.md covers every bundled/runtime component and reconciles OpenScreen", () => {
    const notice = readFileSync(at("NOTICE.md"), "utf8");
    for (const s of [
      "mediabunny",
      "MPL-2.0",
      "whisper.cpp",
      "Whisper model",
      "Electron",
      "Chromium",
      "FFmpeg",
      "THIRD_PARTY_LICENSES.txt",
      "SOURCE.txt",
    ])
      expect(notice, s).toContain(s);
    expect(notice).toMatch(/no OpenScreen (source )?code/i);
  });
});

// ── CI workflows ────────────────────────────────────────────────────────────

describe("GitHub workflows", () => {
  it("ci.yml runs install, lint, typecheck, tests and build on all three OSes", () => {
    const ci = readFileSync(at(".github/workflows/ci.yml"), "utf8");
    for (const os of ["macos-14", "windows-latest", "ubuntu-22.04"]) expect(ci).toContain(os);
    for (const step of ["npm ci", "biome", "tsc --noEmit", "vitest run", "vite build"])
      expect(ci).toContain(step);
    expect(ci).not.toMatch(/\t/);
  });

  it("build.yml runs on tags and builds helpers, whisper and per-OS packages as a draft", () => {
    const build = readFileSync(at(".github/workflows/build.yml"), "utf8");
    expect(build).toMatch(/tags:\s*\["v\*"\]/);
    for (const s of [
      "build-native-helpers.mjs",
      "build-whisper-runtime.mjs",
      "fetch-ffmpeg.mjs",
      "electron-builder --${{ matrix.platform }}",
      "secrets.APPLE_API_KEY_ID",
      "secrets.WIN_CSC_LINK",
    ]) {
      expect(build).toContain(s);
    }
    expect(build).not.toMatch(/\t/);
  });
});
