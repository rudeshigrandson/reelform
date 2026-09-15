#!/usr/bin/env node
/**
 * Build the native capture helpers and write the sha256 manifest that
 * electron/capture/manifest.ts verifies before spawning a helper
 * (ENGINEERING_SPEC §5.5 / §13):
 *
 *   electron/native/bin/<platform>-<arch>/<binary>
 *   electron/native/bin/<platform>-<arch>/manifest.json
 *     { "version": "<package.json version>", "files": { "<binary>": { "sha256": "<hex>" } } }
 *
 * macOS: `swift build -c release --arch <arch>` per arch (arm64, x64) from
 *        electron/native/mac → bin/darwin-arm64, bin/darwin-x64.
 * Windows: CMake presets in electron/native/win (configure, build Release,
 *        install) → bin/win32-<arch>.
 * Linux: no native helpers in 1.0 (Electron backend; PipeWire helper is 1.1).
 *
 * Usage: node scripts/build-native-helpers.mjs [--arch arm64,x64]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "electron", "native", "bin");

export const MAC_PRODUCTS = ["reelform-sck", "reelform-cursor-monitor"];
/** swift `--arch` spelling for a Node `process.arch`. */
const SWIFT_ARCH = { arm64: "arm64", x64: "x86_64" };

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function capture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Manifest in the exact shape of `HelperManifest` (electron/capture/manifest.ts). */
export function buildManifest(dir, names, version) {
  const files = {};
  for (const name of [...names].sort()) files[name] = { sha256: sha256File(join(dir, name)) };
  return { version, files };
}

function writeManifest(dir, names) {
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const manifest = buildManifest(dir, names, version);
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${join(dir, "manifest.json")} (${names.length} files)`);
}

function parseArchs(defaults) {
  const i = process.argv.indexOf("--arch");
  const raw = i > 0 ? process.argv[i + 1] : undefined;
  return raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : defaults;
}

function buildMac() {
  const pkg = join(ROOT, "electron", "native", "mac");
  for (const arch of parseArchs(["arm64", "x64"])) {
    const swiftArch = SWIFT_ARCH[arch];
    if (!swiftArch) throw new Error(`unsupported mac arch: ${arch}`);
    run("swift", ["build", "-c", "release", "--arch", swiftArch], pkg);
    const binPath = capture(
      "swift",
      ["build", "-c", "release", "--arch", swiftArch, "--show-bin-path"],
      pkg,
    );
    const out = join(BIN, `darwin-${arch}`);
    mkdirSync(out, { recursive: true });
    for (const name of MAC_PRODUCTS) {
      const src = join(binPath, name);
      if (!existsSync(src)) throw new Error(`expected build product missing: ${src}`);
      copyFileSync(src, join(out, name));
      chmodSync(join(out, name), 0o755);
    }
    writeManifest(out, MAC_PRODUCTS);
  }
}

function buildWin() {
  const src = join(ROOT, "electron", "native", "win");
  for (const arch of parseArchs(["x64"])) {
    const preset = `windows-${arch}`;
    run("cmake", ["--preset", preset], src);
    run("cmake", ["--build", "--preset", `${preset}-release`], src);
    // CMakePresets installDir = electron/native/bin; install() adds win32-<arch>/.
    run("cmake", ["--install", join("build", preset), "--config", "Release"], src);
    const out = join(BIN, `win32-${arch}`);
    const exes = readdirSync(out).filter(
      (f) => f.endsWith(".exe") && statSync(join(out, f)).isFile(),
    );
    if (exes.length === 0) throw new Error(`no helper executables installed into ${out}`);
    writeManifest(out, exes);
  }
}

function main() {
  if (process.platform === "darwin") buildMac();
  else if (process.platform === "win32") buildWin();
  else console.log(`no native helpers for ${process.platform} in 1.0 (Electron capture backend)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`build-native-helpers: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
