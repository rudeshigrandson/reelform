import { vi } from "vitest";
import { initialProjectSession, useProjectSession } from "../../../app/project/session";
import type { ProjectMeta } from "../../persistence";
import { initialEditorData, useEditorStore } from "../../store";
import { createDefaultInspectorHost } from "./defaultHost";
import { effectiveClips } from "./timeMap";
import type { CaptionsPort, CaptionsProgressEvent, InspectorHost } from "./types";

/** Shared fixtures for host logic + panel integration tests. */

export const VIDEO_SOURCE = {
  path: "media/screen.mp4",
  durationMs: 42_180,
  width: 3024,
  height: 1964,
  fps: 60,
  codec: "h264",
  hasAudio: false,
};

export function audioSource(path: string, durationMs = 1000) {
  return { path, durationMs, width: 1, height: 1, fps: 1, codec: "opus", hasAudio: true };
}

export function makeMeta(
  over: Partial<ProjectMeta> = {},
  sources: Partial<ProjectMeta["sources"]> = {},
): ProjectMeta {
  return {
    id: "p1",
    name: "Demo",
    createdAt: "2026-09-14T15:04:00.000Z",
    modifiedAt: "2026-09-14T16:30:00.000Z",
    appVersion: "1.0.0",
    sources: { video: VIDEO_SOURCE, ...sources },
    ...over,
  };
}

export interface FakeCaptions extends CaptionsPort {
  emit(e: CaptionsProgressEvent): void;
}

export function fakeCaptionsPort(over: Partial<CaptionsPort> = {}): FakeCaptions {
  const listeners = new Set<(e: CaptionsProgressEvent) => void>();
  return {
    models: vi.fn(async () => []),
    download: vi.fn(async () => {}),
    cancelDownload: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({ captions: [] })),
    onProgress: vi.fn((cb: (e: CaptionsProgressEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    emit: (e) => {
      for (const l of listeners) l(e);
    },
    ...over,
  };
}

export interface FakeHost extends InspectorHost {
  captions: FakeCaptions;
  labels: string[];
}

/**
 * Host whose history calls apply to the real stores and record their labels;
 * `defer` runs synchronously. Every port is a `vi.fn` the test can override.
 */
export function fakeHost(
  over: Partial<InspectorHost> = {},
  captions: FakeCaptions = fakeCaptionsPort(),
): FakeHost {
  const labels: string[] = [];
  const base = createDefaultInspectorHost();
  const host = createDefaultInspectorHost({
    pickFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => null),
    readTextFile: vi.fn(async () => ""),
    reveal: vi.fn(async () => {}),
    importMedia: vi.fn(async () => {
      throw new Error("not stubbed");
    }),
    relinkMedia: vi.fn(async () => ({
      path: "media/new.mp4",
      url: "reelform-media://p/media/new.mp4",
    })),
    trimSource: vi.fn(async () => null),
    deleteProject: vi.fn(async () => {}),
    statSources: vi.fn(async () => ({})),
    decodeAudio: vi.fn(async () => null),
    captions,
    documentUpdate: vi.fn((label, patch, key) => {
      labels.push(label);
      base.documentUpdate(label, patch, key);
    }),
    metaUpdate: vi.fn((label, update, patch) => {
      labels.push(label);
      base.metaUpdate(label, update, patch);
    }),
    platform: "mac",
    defer: (work) => work(),
    ...over,
  });
  return Object.assign(host, { captions, labels });
}

export function resetStores(meta: ProjectMeta | null = makeMeta()): void {
  useEditorStore.setState({
    ...initialEditorData(),
    durationMs: meta?.sources.video.durationMs ?? 0,
    clips: effectiveClips(meta),
  });
  useProjectSession.setState({
    ...initialProjectSession(),
    status: meta ? "ready" : "idle",
    meta,
    projectPath: meta ? "/Users/me/Demo.reelform" : null,
    projectId: meta?.id ?? null,
    mediaBaseUrl: meta ? "reelform-media://p1/" : null,
    sourceSize: meta
      ? { width: meta.sources.video.width, height: meta.sources.video.height }
      : null,
  });
}

/** PCM: `on` segments of a 0.5-amplitude square wave, silence elsewhere. */
export function pcm(
  sampleRate: number,
  totalMs: number,
  on: readonly [number, number][],
): Float32Array {
  const out = new Float32Array(Math.round((sampleRate * totalMs) / 1000));
  for (const [s, e] of on) {
    for (
      let i = Math.round((sampleRate * s) / 1000);
      i < Math.min(out.length, Math.round((sampleRate * e) / 1000));
      i++
    ) {
      out[i] = i % 2 === 0 ? 0.5 : -0.5;
    }
  }
  return out;
}
