#!/usr/bin/env node
/**
 * Build the whisper.cpp `whisper-cli` runtime (ENGINEERING_SPEC §9.6):
 * clone a pinned tag, configure with per-platform CMake flags, build Release,
 * and stage the binary where electron/captions/runtime.ts looks for it:
 *
 *   resources/whisper/<platform>-<arch>/whisper-cli[.exe]
 *   resources/whisper/<platform>-<arch>/whisper-cli-vulkan[.exe]   (Windows, --vulkan)
 *
 * Flags: static libs (no dylib/dll to ship), Metal on macOS (embedded shader
 * library), CUDA off by default on Windows (CPU build + optional Vulkan build),
 * OpenMP on where the toolchain has it (not Apple clang).
 *
 * Usage: node scripts/build-whisper-runtime.mjs [--arch arm64|x64] [--vulkan] [--jobs 8]
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Pinned upstream. Bump deliberately; captions JSON parsing is tested against this output. */
export const WHISPER_REPO = "https://github.com/ggml-org/whisper.cpp.git";
export const WHISPER_TAG = "v1.7.6";

/** CMake cache flags for a platform/arch/variant (pure; unit-tested). */
export function cmakeFlags({ platform, arch, variant = "cpu" }) {
  const flags = [
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_SDL2=OFF",
    "-DWHISPER_CURL=OFF",
    // Portable CPU baseline: the binary runs on every machine of the arch.
    "-DGGML_NATIVE=OFF",
  ];
  if (platform === "darwin") {
    flags.push(
      "-DWHISPER_METAL=ON", // spec spelling (older tags)
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DWHISPER_OPENMP=OFF",
      "-DGGML_OPENMP=OFF", // Apple clang has no OpenMP
      `-DCMAKE_OSX_ARCHITECTURES=${arch === "x64" ? "x86_64" : "arm64"}`,
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
    );
  } else {
    flags.push("-DWHISPER_OPENMP=ON", "-DGGML_OPENMP=ON", "-DGGML_CUDA=OFF");
    flags.push(variant === "vulkan" ? "-DGGML_VULKAN=ON" : "-DGGML_VULKAN=OFF");
  }
  if (platform === "win32") flags.push("-A", arch === "arm64" ? "ARM64" : "x64");
  return flags;
}

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function main() {
  const platform = process.platform;
  const arch = arg("--arch", process.arch);
  const jobs = arg("--jobs", String(Math.max(1, cpus().length)));
  const variants =
    process.argv.includes("--vulkan") && platform !== "darwin" ? ["cpu", "vulkan"] : ["cpu"];
  const exe = platform === "win32" ? ".exe" : "";

  const src = join(ROOT, ".cache", `whisper.cpp-${WHISPER_TAG}`);
  if (!existsSync(join(src, "CMakeLists.txt"))) {
    mkdirSync(dirname(src), { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", WHISPER_TAG, WHISPER_REPO, src], ROOT);
  }

  const out = join(ROOT, "resources", "whisper", `${platform}-${arch}`);
  mkdirSync(out, { recursive: true });
  for (const variant of variants) {
    const build = join(src, `build-${platform}-${arch}-${variant}`);
    run("cmake", ["-S", src, "-B", build, ...cmakeFlags({ platform, arch, variant })], src);
    run(
      "cmake",
      ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j", jobs],
      src,
    );
    const candidates = [
      join(build, "bin", `whisper-cli${exe}`),
      join(build, "bin", "Release", `whisper-cli${exe}`),
    ];
    const built = candidates.find((p) => existsSync(p));
    if (!built) throw new Error(`whisper-cli not found in ${candidates.join(" or ")}`);
    const name = variant === "vulkan" ? `whisper-cli-vulkan${exe}` : `whisper-cli${exe}`;
    copyFileSync(built, join(out, name));
    if (!exe) chmodSync(join(out, name), 0o755);
    console.log(`staged ${join(out, name)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`build-whisper-runtime: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
