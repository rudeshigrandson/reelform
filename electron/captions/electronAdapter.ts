import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { availableParallelism } from "node:os";
import * as path from "node:path";
import { app } from "electron";
import type { CaptionsProgress } from "./contracts";
import type { CaptionsDeps } from "./handlers";
import { nodeDownloadFs, nodeFetch, nodeSha256, nodeTranscribeFs } from "./nodeDeps";
import { resolveWhisperBinary } from "./runtime";
import type { SilenceSplitter, WavExtractor } from "./transcribe";
import type { SpawnFn } from "./whisperCli";

/**
 * Real deps for {@link createCaptionsHandlers}. Audio extraction and silence
 * splitting are ffmpeg jobs owned by the media module; the caller wires them.
 */
export function createElectronCaptionsDeps(opts: {
  extractWav: WavExtractor;
  splitter: SilenceSplitter;
  emit: (event: CaptionsProgress) => void;
}): CaptionsDeps {
  const tempDir = path.join(app.getPath("userData"), "tmp");
  return {
    modelsDir: path.join(app.getPath("userData"), "models"),
    join: path.join,
    isAbsolute: path.isAbsolute,
    mkdirp: async (dir) => {
      await fsp.mkdir(dir, { recursive: true });
    },
    fetch: nodeFetch,
    downloadFs: nodeDownloadFs,
    createHash: nodeSha256,
    fs: {
      ...nodeTranscribeFs,
      // mkdtemp needs the parent to exist; userData/tmp is created lazily (and removed by Clear cache).
      mkdtemp: async (prefix) => {
        await fsp.mkdir(path.dirname(prefix), { recursive: true });
        return nodeTranscribeFs.mkdtemp(prefix);
      },
    },
    // Under userData/tmp so Settings → Clear cache also removes leftover caption chunks.
    tempPrefix: path.join(tempDir, "captions-"),
    spawn: ((cmd, args) => spawn(cmd, [...args], { windowsHide: true })) as SpawnFn,
    extractWav: opts.extractWav,
    splitter: opts.splitter,
    threads: Math.max(1, Math.min(8, availableParallelism() - 1)),
    emit: opts.emit,
    resolveWhisperBinary: () =>
      resolveWhisperBinary({
        platform: process.platform,
        arch: process.arch,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        override: process.env.REELFORM_WHISPER_CLI,
        join: path.join,
        exists: existsSync,
      }),
  };
}
