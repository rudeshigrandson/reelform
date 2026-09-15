import type { SceneInput } from "../../editor/preview/scene";
import { initialEditorData } from "../../editor/store";
import type { ExportProgress } from "../../export/engine/progress";
import type { SinkBeginInfo } from "./exportSink";
import type { FlowSink } from "./runner";
import type { SystemPort } from "./systemPort";

/** Shared fakes for the export-flow harness. */

export class FakeFlowSink implements FlowSink {
  events: string[] = [];
  infos: (SinkBeginInfo | undefined)[] = [];
  writes: { bytes: Uint8Array; position: number | undefined }[] = [];
  size = 0;
  failFinish: unknown = null;
  constructor(public finishPath = "/exports/Demo.mp4") {}
  async begin(info?: SinkBeginInfo | undefined): Promise<void> {
    this.events.push("begin");
    this.infos.push(info);
  }
  async writeChunk(chunk: Uint8Array, position?: number | undefined): Promise<void> {
    const bytes = chunk.slice();
    this.writes.push({ bytes, position });
    this.size = Math.max(this.size, (position ?? this.size) + bytes.byteLength);
  }
  async finish(): Promise<{ path: string }> {
    this.events.push("finish");
    if (this.failFinish) throw this.failFinish;
    return { path: this.finishPath };
  }
  async cancel(): Promise<void> {
    this.events.push("cancel");
  }
  /** File contents with positional writes applied. */
  contents(): Uint8Array {
    const out = new Uint8Array(this.size);
    let end = 0;
    for (const w of this.writes) {
      const at = w.position ?? end;
      out.set(w.bytes, at);
      end = Math.max(end, at + w.bytes.byteLength);
    }
    return out;
  }
}

export type FakeSystemPort = SystemPort & { calls: [string, ...unknown[]][] };

export function fakeSystemPort(overrides: Partial<SystemPort> = {}): FakeSystemPort {
  const calls: [string, ...unknown[]][] = [];
  return {
    calls,
    reveal: async (p) => {
      calls.push(["reveal", p]);
    },
    pickFile: async (o) => {
      calls.push(["pickFile", o]);
      return null;
    },
    pickFolder: async (o) => {
      calls.push(["pickFolder", o]);
      return "/picked";
    },
    saveDialog: async (o) => {
      calls.push(["saveDialog", o]);
      return null;
    },
    clipboardWriteFile: async (p) => {
      calls.push(["clipboardWriteFile", p]);
      return { method: "file-url" };
    },
    copyText: async (t) => {
      calls.push(["copyText", t]);
    },
    ...overrides,
  };
}

export function sceneInputFor(size: { width: number; height: number }): SceneInput {
  const data = initialEditorData();
  return {
    canvas: size,
    frame: data.frame,
    sourceSize: { width: 1920, height: 1080 },
    zoomRegions: [],
    cursor: data.cursor,
    cursorTrack: null,
    hasVideo: true,
  };
}

export function progressAt(fraction: number, patch: Partial<ExportProgress> = {}): ExportProgress {
  return {
    phase: "rendering",
    label: "Rendering",
    framesDone: Math.round(fraction * 100),
    framesTotal: 100,
    fraction,
    etaMs: 1000,
    speed: 2,
    encoder: "hardware",
    ...patch,
  };
}

export function deferred<T = void>() {
  let resolve!: (v?: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = (v) => res(v as T);
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
