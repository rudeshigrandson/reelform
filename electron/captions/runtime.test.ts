import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { HF_REVISION, MODEL_CATALOG, isSha256Hex } from "./models";
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
      expect(m.url).toBe(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/${HF_REVISION}/${m.fileName}`,
      );
      expect(isSha256Hex(m.sha256)).toBe(true);
      expect(m.sizeBytes).toBeGreaterThan(0);
    }
    expect(HF_REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length);
    expect(MODEL_CATALOG.map((m) => m.tier)).toEqual(["fast", "balanced", "balanced", "accurate"]);
  });

  it("pins the exact Hub LFS sha256 and byte size of each file (SPEC §9.6)", () => {
    expect(HF_REVISION).toBe("5359861c739e955e79d9a303bcbc70fb988958b1");
    expect(
      MODEL_CATALOG.map(({ fileName, sha256, sizeBytes, displaySize }) => ({
        fileName,
        sha256,
        sizeBytes,
        displaySize,
      })),
    ).toEqual([
      {
        fileName: "ggml-tiny.en-q5_1.bin",
        sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b",
        sizeBytes: 32_166_155,
        displaySize: "32 MB",
      },
      {
        fileName: "ggml-base-q5_1.bin",
        sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
        sizeBytes: 59_707_625,
        displaySize: "60 MB",
      },
      {
        fileName: "ggml-small-q5_1.bin",
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        sizeBytes: 190_085_487,
        displaySize: "190 MB",
      },
      {
        fileName: "ggml-medium-q5_0.bin",
        sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
        sizeBytes: 539_212_467,
        displaySize: "540 MB",
      },
    ]);
  });
});
