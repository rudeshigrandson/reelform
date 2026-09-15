/**
 * Locates the bundled whisper.cpp `whisper-cli` binary (ENGINEERING_SPEC §9.6).
 *
 * Layout produced by `scripts/build-whisper-runtime.mjs` and shipped as an
 * electron-builder extra resource:
 *   <resources>/whisper/<platform>-<arch>/whisper-cli[.exe]
 *   <resources>/whisper/<platform>-<arch>/whisper-cli-vulkan[.exe]   (optional, Windows)
 * In development the same tree lives under `<appPath>/resources/whisper`.
 * An explicit override (env `REELFORM_WHISPER_CLI`) wins when it exists.
 */

export interface RuntimeEnv {
  platform: string;
  arch: string;
  /** `process.resourcesPath` in a packaged app. */
  resourcesPath: string;
  /** `app.getAppPath()`; used for the dev layout. */
  appPath: string;
  isPackaged: boolean;
  /** Explicit binary path override, if any. */
  override?: string | undefined;
  /** Prefer the Vulkan build when present. Default false. */
  preferGpu?: boolean | undefined;
  join(...parts: string[]): string;
  exists(path: string): boolean;
}

export function whisperBinaryName(platform: string, variant: "cpu" | "vulkan" = "cpu"): string {
  const base = variant === "vulkan" ? "whisper-cli-vulkan" : "whisper-cli";
  return platform === "win32" ? `${base}.exe` : base;
}

/** Candidate paths in priority order. */
export function whisperBinaryCandidates(env: RuntimeEnv): string[] {
  const out: string[] = [];
  if (env.override) out.push(env.override);
  const roots = env.isPackaged
    ? [env.join(env.resourcesPath, "whisper")]
    : [env.join(env.appPath, "resources", "whisper"), env.join(env.resourcesPath, "whisper")];
  const target = `${env.platform}-${env.arch}`;
  const names =
    env.preferGpu && env.platform === "win32"
      ? [whisperBinaryName(env.platform, "vulkan"), whisperBinaryName(env.platform)]
      : [whisperBinaryName(env.platform)];
  for (const root of roots) {
    for (const name of names) out.push(env.join(root, target, name));
  }
  return out;
}

/** First existing candidate, or null when the runtime is missing. */
export function resolveWhisperBinary(env: RuntimeEnv): string | null {
  return whisperBinaryCandidates(env).find((p) => env.exists(p)) ?? null;
}
