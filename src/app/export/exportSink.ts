import type { RequestOf, ResponseOf } from "@contracts";
import type { ExportSink, ExportSinkBeginInfo } from "../../export/engine/muxer";
import { invoke } from "../ipc";

/**
 * Renderer `ExportSink` over the main-process file sink (`export:begin`,
 * `export:writeChunk` with absolute `position`, `export:finish`,
 * `export:cancel`). Writes are serialized in call order and their bytes are
 * copied on entry so a muxer reusing its buffer can't corrupt a queued write.
 */

type ExportChannel = "export:begin" | "export:writeChunk" | "export:finish" | "export:cancel";

export interface ExportIpc {
  begin(req: RequestOf<"export:begin">): Promise<ResponseOf<"export:begin">>;
  writeChunk(req: RequestOf<"export:writeChunk">): Promise<ResponseOf<"export:writeChunk">>;
  finish(req: RequestOf<"export:finish">): Promise<ResponseOf<"export:finish">>;
  cancel(req: RequestOf<"export:cancel">): Promise<ResponseOf<"export:cancel">>;
}

/** Error with a stable `code`, mirroring IPC errors. */
export class ExportFlowError extends Error {
  override name = "ExportFlowError";
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** `ExportIpc` over the preload bridge; outside Electron every call fails with `NOT_BRIDGED`. */
export function ipcExportTransport(): ExportIpc {
  const call = async <K extends ExportChannel>(
    channel: K,
    payload: RequestOf<K>,
  ): Promise<ResponseOf<K>> => {
    const res = await invoke(channel, payload);
    if (res === null) throw new ExportFlowError("NOT_BRIDGED", "Export needs the desktop app");
    return res;
  };
  return {
    begin: (req) => call("export:begin", req),
    writeChunk: (req) => call("export:writeChunk", req),
    finish: (req) => call("export:finish", req),
    cancel: (req) => call("export:cancel", req),
  };
}

/** Begin info for non-video files written through the same sink (GIF, sidecars). */
export interface FileSinkBeginInfo {
  container: "gif" | "srt" | "vtt" | "wav";
}

export type SinkBeginInfo = ExportSinkBeginInfo | FileSinkBeginInfo;

export interface IpcExportSinkOptions {
  ipc: ExportIpc;
  projectId: string;
  /** Absolute folder; omitted → the project's exports folder (main decides). */
  destinationDir?: string | null | undefined;
  /** Final file name; main makes it unique on collision. */
  finalName: string;
}

export type SinkState = "new" | "open" | "finished" | "cancelled" | "failed";

export class IpcExportSink implements ExportSink {
  state: SinkState = "new";
  exportId: string | null = null;
  tempPath: string | null = null;
  /** File size reported by main (furthest byte written). */
  size = 0;
  path: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private cancelling: Promise<void> | null = null;
  /** True once main opened a temp file for this sink (a later re-begin is allowed). */
  private opened = false;

  constructor(private readonly opts: IpcExportSinkOptions) {}

  private reopen(): void {
    this.state = "new";
    this.exportId = null;
    this.tempPath = null;
    this.size = 0;
    this.path = null;
    this.chain = Promise.resolve();
    this.failure = null;
    this.cancelling = null;
    this.opened = false;
  }

  async begin(info?: SinkBeginInfo | undefined): Promise<void> {
    // The engine restarts a failed hardware attempt on the software encoder
    // with the SAME sink (begin → cancel → begin → finish): a sink that was
    // opened and then discarded may begin a fresh temp file.
    if ((this.state === "cancelled" || this.state === "failed") && this.opened) {
      await this.cancelling?.catch(() => undefined);
      this.reopen();
    }
    if (this.state !== "new") {
      throw new ExportFlowError("SINK_STATE", `sink already ${this.state}`);
    }
    const config: RequestOf<"export:begin">["config"] = { ...(info ?? {}) };
    if (this.opts.destinationDir) config.destinationDir = this.opts.destinationDir;
    this.state = "open";
    try {
      const res = await this.opts.ipc.begin({ projectId: this.opts.projectId, config });
      this.exportId = res.exportId;
      this.tempPath = res.tempPath;
      this.opened = true;
    } catch (e) {
      this.state = "failed";
      this.failure = e;
      throw e;
    }
    // cancel() raced with begin: discard what main just opened.
    if (this.cancelling) await this.sendCancel();
  }

  writeChunk(chunk: Uint8Array, position?: number | undefined): Promise<void> {
    if (this.state !== "open" || this.exportId === null) {
      return Promise.reject(
        this.failure ?? new ExportFlowError("SINK_STATE", `cannot write: sink ${this.state}`),
      );
    }
    const exportId = this.exportId;
    const copy = chunk.slice();
    const run = this.chain.then(async () => {
      if (this.failure !== null) throw this.failure;
      if (this.state !== "open") throw new ExportFlowError("SINK_STATE", "sink closed");
      try {
        const res = await this.opts.ipc.writeChunk({
          exportId,
          chunk: copy.buffer as ArrayBuffer,
          ...(position === undefined ? {} : { position }),
        });
        this.size = Math.max(this.size, res.size);
      } catch (e) {
        this.failure ??= e;
        throw e;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async finish(): Promise<{ path: string }> {
    if (this.state !== "open" || this.exportId === null) {
      throw this.failure ?? new ExportFlowError("SINK_STATE", `cannot finish: sink ${this.state}`);
    }
    await this.chain;
    if (this.failure !== null) throw this.failure;
    try {
      const { path } = await this.opts.ipc.finish({
        exportId: this.exportId,
        finalName: this.opts.finalName,
      });
      this.state = "finished";
      this.path = path;
      return { path };
    } catch (e) {
      this.state = "failed";
      this.failure ??= e;
      throw e;
    }
  }

  /** Idempotent; a no-op after finish. Waits for queued writes, then deletes the temp file. */
  cancel(): Promise<void> {
    if (this.cancelling) return this.cancelling;
    if (this.state === "finished" || this.state === "cancelled") return Promise.resolve();
    const wasNew = this.state === "new";
    this.state = "cancelled";
    this.cancelling = wasNew ? Promise.resolve() : this.chain.then(() => this.sendCancel());
    return this.cancelling;
  }

  private async sendCancel(): Promise<void> {
    if (this.exportId === null) return;
    const exportId = this.exportId;
    this.state = "cancelled";
    await this.opts.ipc.cancel({ exportId }).catch(() => undefined);
  }
}

/**
 * Stream a file next to an export through the same channels: `write` appends
 * chunks in order (e.g. a WAV header then one chunk per render block), so the
 * whole file is never held in memory.
 */
export async function streamFileViaSink(
  opts: IpcExportSinkOptions,
  container: FileSinkBeginInfo["container"],
  write: (append: (bytes: Uint8Array) => Promise<void>) => Promise<void>,
): Promise<string> {
  const sink = new IpcExportSink(opts);
  try {
    await sink.begin({ container });
    await write(async (bytes) => {
      if (bytes.byteLength > 0) await sink.writeChunk(bytes);
    });
    return (await sink.finish()).path;
  } catch (e) {
    await sink.cancel();
    throw e;
  }
}

/** Write a small file (sidecar) next to an export through the same channels. */
export async function writeFileViaSink(
  opts: IpcExportSinkOptions,
  container: FileSinkBeginInfo["container"],
  bytes: Uint8Array,
): Promise<string> {
  const sink = new IpcExportSink(opts);
  try {
    await sink.begin({ container });
    if (bytes.byteLength > 0) await sink.writeChunk(bytes);
    return (await sink.finish()).path;
  } catch (e) {
    await sink.cancel();
    throw e;
  }
}
