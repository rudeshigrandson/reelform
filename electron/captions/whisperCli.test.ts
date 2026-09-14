import { describe, expect, it } from "vitest";
import { isCaptionsError } from "./errors";
import { fakeSpawn } from "./testUtils";
import { buildWhisperArgs, parseWhisperProgress, runWhisper } from "./whisperCli";

describe("buildWhisperArgs", () => {
  it("requests full JSON output with progress", () => {
    const args = buildWhisperArgs({
      modelPath: "/m.bin",
      wavPath: "/a.wav",
      outBase: "/t/c0",
      language: "auto",
      threads: 4,
    });
    expect(args).toEqual([
      "-m",
      "/m.bin",
      "-f",
      "/a.wav",
      "-l",
      "auto",
      "--output-json-full",
      "-of",
      "/t/c0",
      "--print-progress",
      "-t",
      "4",
    ]);
  });

  it("omits invalid thread counts", () => {
    for (const threads of [0, -1, 1.5, undefined]) {
      expect(
        buildWhisperArgs({ modelPath: "m", wavPath: "w", outBase: "o", language: "en", threads }),
      ).not.toContain("-t");
    }
  });
});

describe("parseWhisperProgress", () => {
  it("reads the latest percentage in a chunk", () => {
    expect(parseWhisperProgress("whisper_print_progress_callback: progress =  45%")).toBe(0.45);
    expect(parseWhisperProgress("progress = 5%\nprogress = 10%\n")).toBe(0.1);
    expect(parseWhisperProgress("whisper_init_from_file: loading model")).toBeNull();
  });
});

describe("runWhisper", () => {
  it("resolves on exit 0 and forwards progress", async () => {
    const { spawn, calls } = fakeSpawn((_args, child) => {
      child.emit("stderr", "progress = 50%\n");
      child.emit("stderr", new TextEncoder().encode("progress = 100%\n"));
      child.emit("close", 0, null);
    });
    const seen: number[] = [];
    await runWhisper(spawn, { bin: "/w", args: ["-x"], onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([0.5, 1]);
    expect(calls[0]).toMatchObject({ bin: "/w", args: ["-x"] });
  });

  it("rejects with whisper-failed and a stderr tail on non-zero exit", async () => {
    const { spawn } = fakeSpawn((_a, child) => {
      child.emit("stderr", "error: failed to open model\n");
      child.emit("close", 2, null);
    });
    try {
      await runWhisper(spawn, { bin: "/w", args: [] });
      expect.unreachable();
    } catch (err) {
      expect(isCaptionsError(err, "whisper-failed")).toBe(true);
      expect((err as { details: { stderr: string } }).details.stderr).toContain(
        "failed to open model",
      );
    }
  });

  it("maps spawn errors and throwing spawn to whisper-failed", async () => {
    const { spawn } = fakeSpawn((_a, child) => child.emit("error", new Error("ENOENT")));
    await expect(runWhisper(spawn, { bin: "/w", args: [] })).rejects.toMatchObject({
      code: "whisper-failed",
    });
    const throwing = () => {
      throw new Error("EACCES");
    };
    await expect(runWhisper(throwing, { bin: "/w", args: [] })).rejects.toMatchObject({
      code: "whisper-failed",
    });
  });

  it("kills the child and rejects cancelled on abort", async () => {
    const controller = new AbortController();
    const { spawn, calls } = fakeSpawn(() => controller.abort());
    await expect(
      runWhisper(spawn, { bin: "/w", args: [], signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(calls[0]?.child.killed).toBe("SIGTERM");
    await expect(
      runWhisper(spawn, { bin: "/w", args: [], signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
  });
});
