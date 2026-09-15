import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, isSha256Hex } from "./models";
import {
  type RuntimeEnv,
  resolveWhisperBinary,
  whisperBinaryCandidates,
  whisperBinaryName,
} from "./runtime";

const env = (over: Partial<RuntimeEnv>, existing: string[] = []): RuntimeEnv => ({
  platform: "darwin",
  arch: "arm64",
  resourcesPath: "/App/Contents/Resources",
  appPath: "/dev/reelform",
  isPackaged: true,
  join: posix.join,
  exists: (p) => existing.includes(p),
  ...over,
});

describe("whisper runtime resolver", () => {
  it("names the binary per platform", () => {
    expect(whisperBinaryName("darwin")).toBe("whisper-cli");
    expect(whisperBinaryName("linux")).toBe("whisper-cli");
    expect(whisperBinaryName("win32")).toBe("whisper-cli.exe");
    expect(whisperBinaryName("win32", "vulkan")).toBe("whisper-cli-vulkan.exe");
  });

  it("finds the packaged binary under resources/whisper/<platform>-<arch>", () => {
    const p = "/App/Contents/Resources/whisper/darwin-arm64/whisper-cli";
    expect(resolveWhisperBinary(env({}, [p]))).toBe(p);
  });

  it("uses the dev layout when not packaged", () => {
    const p = "/dev/reelform/resources/whisper/linux-x64/whisper-cli";
    expect(
      resolveWhisperBinary(env({ isPackaged: false, platform: "linux", arch: "x64" }, [p])),
    ).toBe(p);
  });

  it("prefers an existing override", () => {
    const packaged = "/App/Contents/Resources/whisper/darwin-arm64/whisper-cli";
    expect(
      resolveWhisperBinary(env({ override: "/opt/whisper-cli" }, ["/opt/whisper-cli", packaged])),
    ).toBe("/opt/whisper-cli");
    // Missing override falls through.
    expect(resolveWhisperBinary(env({ override: "/nope" }, [packaged]))).toBe(packaged);
  });

  it("on Windows prefers the Vulkan build only when asked and present", () => {
    const base = { platform: "win32", arch: "x64", resourcesPath: "C:\\R", join: win32.join };
    const cpu = "C:\\R\\whisper\\win32-x64\\whisper-cli.exe";
    const gpu = "C:\\R\\whisper\\win32-x64\\whisper-cli-vulkan.exe";
    expect(resolveWhisperBinary(env({ ...base, preferGpu: true }, [cpu, gpu]))).toBe(gpu);
    expect(resolveWhisperBinary(env({ ...base, preferGpu: true }, [cpu]))).toBe(cpu);
    expect(resolveWhisperBinary(env(base, [cpu, gpu]))).toBe(cpu);
    expect(whisperBinaryCandidates(env({ ...base, preferGpu: false }))).not.toContain(gpu);
  });

  it("returns null when nothing exists", () => {
    expect(resolveWhisperBinary(env({}))).toBeNull();
  });
});

describe("model catalog", () => {
  it("pins every model to a revisioned Hugging Face URL with a sha256", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.url).toMatch(
        /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\//,
      );
      expect(m.url.endsWith(`/${m.fileName}`)).toBe(true);
      if (m.sha256 !== null) expect(isSha256Hex(m.sha256)).toBe(true);
      expect(m.sizeBytes).toBeGreaterThan(0);
    }
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length);
    expect(MODEL_CATALOG.map((m) => m.tier)).toEqual(["fast", "balanced", "balanced", "accurate"]);
  });
});
