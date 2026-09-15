#!/usr/bin/env node
/**
 * Download pinned static ffmpeg + ffprobe builds for packaging
 * (ENGINEERING_SPEC §0: ffmpeg/ffprobe bundled for fallbacks/transcodes).
 *
 *   resources/ffmpeg/<platform>-<arch>/ffmpeg[.exe]
 *   resources/ffmpeg/<platform>-<arch>/ffprobe[.exe]
 *   resources/ffmpeg/<platform>-<arch>/manifest.json
 *
 * Every archive is downloaded from a versioned, immutable URL and verified
 * against a pinned sha256 BEFORE it is extracted. A target whose pins are
 * `null` is refused rather than trusting whatever a URL serves today. Use
 * `--print-hash` to download and print a hash without installing anything.
 *
 * All pins are FFmpeg 9.0.1 GPL-3.0 static builds (see NOTICE.md). They run
 * as separate processes; Reelform does not link against them.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.mjs [--target darwin-arm64] [--print-hash]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const FFMPEG_VERSION = "9.0.1";

const RIEDL = "https://ffmpeg.martin-riedl.de/download";

/**
 * One entry per downloadable archive. `tool: "both"` = one archive holds
 * ffmpeg and ffprobe. `sha256: null` = not pinned (the target is refused).
 */
export const PINS = {
  "darwin-arm64": [
    {
      tool: "ffmpeg",
      url: `${RIEDL}/macos/arm64/1787073674_9.0.1/ffmpeg.zip`,
      // Publisher checksum: ${RIEDL}/macos/arm64/1787073674_9.0.1/ffmpeg.zip.sha256
      sha256: "8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
    {
      tool: "ffprobe",
      url: `${RIEDL}/macos/arm64/1787073674_9.0.1/ffprobe.zip`,
      // Publisher checksum: ${RIEDL}/macos/arm64/1787073674_9.0.1/ffprobe.zip.sha256
      sha256: "102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
  ],
  "darwin-x64": [
    {
      tool: "ffmpeg",
      url: `${RIEDL}/macos/amd64/1787081194_9.0.1/ffmpeg.zip`,
      // Publisher checksum: ${RIEDL}/macos/amd64/1787081194_9.0.1/ffmpeg.zip.sha256
      // (re-verified against a download on 2026-09-15)
      sha256: "5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
    {
      tool: "ffprobe",
      url: `${RIEDL}/macos/amd64/1787081194_9.0.1/ffprobe.zip`,
      // Publisher checksum: ${RIEDL}/macos/amd64/1787081194_9.0.1/ffprobe.zip.sha256
      // (re-verified against a download on 2026-09-15)
      sha256: "34511bbcf1988ad2886023bf5ace4f44cf62e6defeb3d194d6f7619e5b061f7f",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
  ],
  "win32-x64": [
    {
      tool: "both",
      url: "https://github.com/GyanD/codexffmpeg/releases/download/9.0.1/ffmpeg-9.0.1-essentials_build.zip",
      // GitHub release asset digest (api.github.com/repos/GyanD/codexffmpeg/releases/tags/9.0.1),
      // re-computed from a download on 2026-09-15.
      sha256: "fec81ae03971d9dd4be3ebe02e263bd2ec1d789483f931bdba5f5715e65da2e9",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
  ],
  "win32-arm64": [
    {
      tool: "both",
      // Last autobuild of the month: BtbN keeps these for two years (README).
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-winarm64-gpl-9.0.zip",
      // Publisher checksum: .../autobuild-2026-08-31-13-27/checksums.sha256
      // (re-computed from a download on 2026-09-15)
      sha256: "7e6142ae4d04b35123eba48d91bb2c559ef43b49a6b3857f7324bbcf7266d18b",
      archive: "zip",
      license: "GPL-3.0-or-later",
    },
  ],
  "linux-x64": [
    {
      tool: "both",
      // Not martin-riedl.de: its Linux build is configured --enable-nonfree and
      // is not redistributable. Last autobuild of the month (kept two years).
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n9.0.1-11-ge47273f4d9-linux64-gpl-9.0.tar.xz",
      // Publisher checksum: .../autobuild-2026-08-31-13-27/checksums.sha256
      // (re-computed from a download on 2026-09-15)
      sha256: "182c1b509720e939bb47bfb47dc29cc0c298640401128e3dce8627d10707eb5a",
      archive: "tar.xz",
      license: "GPL-3.0-or-later",
    },
  ],
};

const ARCHIVES = new Set(["zip", "tar.xz", "tar.gz"]);

export class UnpinnedError extends Error {
  constructor(target, missing) {
    super(
      `ffmpeg for ${target} is not pinned (${missing}). Record a vetted archive URL and its sha256 in PINS in scripts/fetch-ffmpeg.mjs (use --print-hash to compute it). Refusing to download an unverified binary.`,
    );
    this.code = "FFMPEG_UNPINNED";
  }
}

/** Throws UnpinnedError unless every archive for `target` has url + sha256. */
export function assertPinned(target, { requireHash = true, pins = PINS } = {}) {
  const entries = pins[target];
  if (!entries)
    throw new Error(`unknown ffmpeg target ${target}; known: ${Object.keys(pins).join(", ")}`);
  for (const e of entries) {
    if (!e.url) throw new UnpinnedError(target, `${e.tool}: url`);
    if (!/^https:\/\//.test(e.url)) throw new Error(`${target} ${e.tool}: url must be https`);
    if (!ARCHIVES.has(e.archive))
      throw new Error(`${target} ${e.tool}: unsupported archive ${e.archive}`);
    if (requireHash && !/^[0-9a-f]{64}$/.test(e.sha256 ?? ""))
      throw new UnpinnedError(target, `${e.tool}: sha256`);
  }
  return entries;
}

export function verifySha256(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  return checkDigest(actual, expected);
}

function checkDigest(actual, expected) {
  if (actual !== expected.toLowerCase()) {
    const err = new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
    err.code = "FFMPEG_CHECKSUM_MISMATCH";
    throw err;
  }
  return actual;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/** Throws FFMPEG_CHECKSUM_MISMATCH unless the file on disk hashes to `expected`. */
export async function verifySha256File(path, expected) {
  return checkDigest(await sha256File(path), expected);
}

/**
 * Extraction command for an archive, using only system tools: bsdtar (macOS,
 * Windows 10+ `tar.exe`) reads zip and tar.*; GNU tar on Linux cannot read
 * zip, so use `unzip` there.
 */
export function extractCommand(kind, archivePath, dest, platform = process.platform) {
  if (!ARCHIVES.has(kind)) throw new Error(`unsupported archive ${kind}`);
  if (kind === "zip" && platform === "linux")
    return ["unzip", ["-q", "-o", archivePath, "-d", dest]];
  return ["tar", ["-xf", archivePath, "-C", dest]];
}

/** Tools an archive entry provides. */
export function toolsIn(entry) {
  return entry.tool === "both" ? ["ffmpeg", "ffprobe"] : [entry.tool];
}

/** manifest.json written next to the staged binaries. */
export function buildManifest({ target, entries, files, fetchedAt }) {
  return {
    target,
    ffmpegVersion: FFMPEG_VERSION,
    fetchedAt,
    sources: entries.map((e) => ({
      tools: toolsIn(e),
      url: e.url,
      sha256: e.sha256,
      license: e.license ?? null,
    })),
    files,
  };
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extract(archivePath, kind, dest) {
  const [cmd, args] = extractCommand(kind, archivePath, dest);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.error)
    throw new Error(`extracting ${archivePath}: ${cmd} unavailable (${r.error.message})`);
  if (r.status !== 0) throw new Error(`extracting ${archivePath} failed (${cmd} exit ${r.status})`);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry === name) return p;
  }
  return null;
}

async function main() {
  const ti = process.argv.indexOf("--target");
  const target =
    ti > 0 && process.argv[ti + 1] ? process.argv[ti + 1] : `${process.platform}-${process.arch}`;
  const printHash = process.argv.includes("--print-hash");
  const entries = assertPinned(target, { requireHash: !printHash });
  const exe = target.startsWith("win32") ? ".exe" : "";
  const out = join(ROOT, "resources", "ffmpeg", target);
  const work = mkdtempSync(join(tmpdir(), "reelform-ffmpeg-"));
  try {
    for (const [i, e] of entries.entries()) {
      const archive = join(work, `${i}-${e.tool}.${e.archive}`);
      console.log(`fetch-ffmpeg: ${target} ${e.tool} <- ${e.url}`);
      await download(e.url, archive);
      if (printHash) {
        console.log(`${target} ${e.tool} sha256=${await sha256File(archive)}`);
        continue;
      }
      // Verify before anything reads the archive's contents.
      await verifySha256File(archive, e.sha256);
      const dir = join(work, `${i}-${e.tool}`);
      mkdirSync(dir, { recursive: true });
      extract(archive, e.archive, dir);
      mkdirSync(out, { recursive: true });
      for (const tool of toolsIn(e)) {
        const found = findFile(dir, `${tool}${exe}`);
        if (!found) throw new Error(`${tool}${exe} not found in ${e.url}`);
        copyFileSync(found, join(out, `${tool}${exe}`));
        if (!exe) chmodSync(join(out, `${tool}${exe}`), 0o755);
      }
    }
    if (printHash) return;
    const files = {};
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const p = join(out, `${tool}${exe}`);
      if (!existsSync(p)) throw new Error(`${tool} missing after fetch for ${target}`);
      files[`${tool}${exe}`] = { sha256: await sha256File(p), size: statSync(p).size };
    }
    const manifest = buildManifest({
      target,
      entries,
      files,
      fetchedAt: new Date().toISOString(),
    });
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`ffmpeg ${FFMPEG_VERSION} + ffprobe installed into ${out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`fetch-ffmpeg: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
