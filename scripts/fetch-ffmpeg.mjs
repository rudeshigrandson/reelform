#!/usr/bin/env node
/**
 * Download pinned static ffmpeg + ffprobe builds for packaging
 * (ENGINEERING_SPEC §0: ffmpeg/ffprobe bundled for fallbacks/transcodes).
 *
 *   resources/ffmpeg/<platform>-<arch>/ffmpeg[.exe]
 *   resources/ffmpeg/<platform>-<arch>/ffprobe[.exe]
 *
 * Every archive is verified against a pinned sha256 before extraction. The
 * pins below are intentionally `null` until a release engineer downloads a
 * vetted build and records its hash — the script refuses to run with an
 * unpinned target rather than trusting whatever the URL serves today. Use
 * `--print-hash` to download and print a hash without installing anything.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.mjs [--target darwin-arm64] [--print-hash]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
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
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One entry per downloadable archive. `sha256: null` = not yet pinned.
 * TODO(release): choose vetted, versioned (not "latest") URLs and pin hashes.
 */
export const PINS = {
  "darwin-arm64": [
    { tool: "ffmpeg", url: null, sha256: null, archive: "zip" },
    { tool: "ffprobe", url: null, sha256: null, archive: "zip" },
  ],
  "darwin-x64": [
    { tool: "ffmpeg", url: null, sha256: null, archive: "zip" },
    { tool: "ffprobe", url: null, sha256: null, archive: "zip" },
  ],
  "win32-x64": [{ tool: "both", url: null, sha256: null, archive: "zip" }],
  "win32-arm64": [{ tool: "both", url: null, sha256: null, archive: "zip" }],
  "linux-x64": [{ tool: "both", url: null, sha256: null, archive: "tar.xz" }],
};

export class UnpinnedError extends Error {
  constructor(target, missing) {
    super(
      `ffmpeg for ${target} is not pinned (${missing}). Record a vetted archive URL and its sha256 in PINS in scripts/fetch-ffmpeg.mjs (use --print-hash to compute it). Refusing to download an unverified binary.`,
    );
    this.code = "FFMPEG_UNPINNED";
  }
}

/** Throws UnpinnedError unless every archive for `target` has url + sha256. */
export function assertPinned(target, { requireHash = true } = {}) {
  const entries = PINS[target];
  if (!entries)
    throw new Error(`unknown ffmpeg target ${target}; known: ${Object.keys(PINS).join(", ")}`);
  for (const e of entries) {
    if (!e.url) throw new UnpinnedError(target, `${e.tool}: url`);
    if (requireHash && !/^[0-9a-f]{64}$/.test(e.sha256 ?? ""))
      throw new UnpinnedError(target, `${e.tool}: sha256`);
  }
  return entries;
}

export function verifySha256(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected.toLowerCase()) {
    const err = new Error(`sha256 mismatch: expected ${expected}, got ${actual}`);
    err.code = "FFMPEG_CHECKSUM_MISMATCH";
    throw err;
  }
  return actual;
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function extract(archivePath, kind, dest) {
  // bsdtar (macOS, Windows 10+) reads zip; GNU tar handles .tar.xz on Linux.
  const args =
    kind === "zip" && process.platform === "linux"
      ? ["unzip", ["-o", archivePath, "-d", dest]]
      : ["tar", ["-xf", archivePath, "-C", dest]];
  const r = spawnSync(args[0], args[1], { stdio: "inherit", shell: false });
  if (r.status !== 0) throw new Error(`extracting ${archivePath} failed`);
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
    for (const e of entries) {
      const bytes = await download(e.url);
      if (printHash) {
        console.log(
          `${target} ${e.tool} sha256=${createHash("sha256").update(bytes).digest("hex")}`,
        );
        continue;
      }
      verifySha256(bytes, e.sha256);
      const archive = join(work, `${e.tool}.${e.archive}`);
      writeFileSync(archive, bytes);
      const dir = join(work, e.tool);
      mkdirSync(dir, { recursive: true });
      extract(archive, e.archive, dir);
      mkdirSync(out, { recursive: true });
      for (const tool of e.tool === "both" ? ["ffmpeg", "ffprobe"] : [e.tool]) {
        const found = findFile(dir, `${tool}${exe}`);
        if (!found) throw new Error(`${tool}${exe} not found in ${e.url}`);
        copyFileSync(found, join(out, `${tool}${exe}`));
        if (!exe) chmodSync(join(out, `${tool}${exe}`), 0o755);
      }
    }
    if (!printHash) {
      for (const tool of ["ffmpeg", "ffprobe"]) {
        if (!existsSync(join(out, `${tool}${exe}`)))
          throw new Error(`${tool} missing after fetch for ${target}`);
      }
      console.log(`ffmpeg + ffprobe installed into ${out}`);
    }
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
