import { gunzipSync, gzipSync } from "node:zlib";
import type { ChannelName, RequestOf, ResponseOf } from "@contracts";
import { type ProjectV1, loadProject } from "../../editor/model/v1";
import { m0Fixture } from "../../editor/model/v1/fixtures";
import { usePlaybackStore } from "../../editor/playback/store";
import { useEditorStore } from "../../editor/store";
import type { ProjectInvoke, ProjectMediaPort } from "./openProject";
import { useProjectSession } from "./session";

/** Shared fakes for the project lifecycle tests (not shipped code). */

export const PROJECT_PATH = "/Users/me/Reelform/Demo.reelform";

export const TELEMETRY_JSON = {
  version: 1,
  sampleHz: 60,
  origin: "display",
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  scaleFactor: 1,
  points: [
    [0, 0.1, 0.1],
    [100, 0.5, 0.5, "ibeam"],
    [200, 0.9, 0.9],
  ],
};

/**
 * Telemetry file with clicks at source 1s / 3s (clip k1) and 7s (clip k2), the
 * cursor parked at each: enough for the auto-zoom engine to suggest zooms.
 */
export function clickTelemetryJson() {
  const at = (t: number): [number, number] =>
    t < 2000 ? [0.2, 0.3] : t < 5000 ? [0.7, 0.6] : [0.4, 0.8];
  const points: [number, number, number, string][] = [];
  for (let t = 0; t <= 10_000; t += 50) points.push([t, ...at(t), "arrow"]);
  const clicks = [1000, 3000, 7000].flatMap((t) => [
    [t, ...at(t), "left", "down"],
    [t + 80, ...at(t), "left", "up"],
  ]);
  return { ...TELEMETRY_JSON, points, clicks };
}

/** A v1 document with two clips (8s of a 10s source), a stale stored duration and telemetry. */
export function projectDocument(patch: Partial<ProjectV1> = {}): ProjectV1 {
  const base = loadProject(m0Fixture());
  return {
    ...base,
    id: "proj-1",
    name: "Demo",
    sources: {
      ...base.sources,
      telemetry: {
        path: "media/telemetry.json.gz",
        pointCount: 3,
        hasClicks: false,
        hasKeys: false,
        sampleHz: 60,
      },
    },
    timeline: {
      ...base.timeline,
      durationMs: 999,
      clips: [
        { id: "k1", sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: 0 },
        { id: "k2", sourceStartMs: 6000, sourceEndMs: 10_000, timelineStartMs: 4000 },
      ],
    },
    ...patch,
  };
}

type Handler<K extends ChannelName> = (req: RequestOf<K>) => unknown;
export type FakeHandlers = { [K in ChannelName]?: Handler<K> };

export interface FakeIpc {
  invoke: ProjectInvoke;
  calls: { channel: ChannelName; payload: unknown }[];
  handlers: FakeHandlers;
  callsTo(channel: ChannelName): unknown[];
}

export function fakeIpc(overrides: FakeHandlers = {}): FakeIpc {
  let roots = 0;
  const calls: FakeIpc["calls"] = [];
  const handlers: FakeHandlers = {
    "project:resolve": () => ({ path: PROJECT_PATH }),
    "project:open": (req) => ({
      path: req.path,
      document: projectDocument(),
      modifiedAt: "2026-09-14T10:00:00.000Z",
      recovery: null,
    }),
    "media:registerRoot": () => {
      roots += 1;
      return { rootId: `root-${roots}`, baseUrl: `reelform-media://root-${roots}/` };
    },
    "media:unregisterRoot": () => ({ ok: true }),
    "project:save": (req) => ({
      path: req.path,
      modifiedAt: "2026-09-15T12:00:00.000Z",
      backupName: req.autosave ? "autosave-000000000000001.json" : null,
    }),
    "project:discardBackups": () => ({ removed: 1 }),
    "project:ensureProxy": () => ({ proxyPath: null, generated: false }),
    "project:ensureThumbnails": () => ({ items: [] }),
    "project:rename": (req) => ({
      path: req.path,
      document: projectDocument({ name: req.name }),
      modifiedAt: "2026-09-15T12:00:00.000Z",
    }),
    ...overrides,
  };
  const invoke = (async (channel: ChannelName, payload: unknown) => {
    calls.push({ channel, payload });
    const handler = handlers[channel] as ((req: unknown) => unknown) | undefined;
    if (!handler) throw new Error(`unexpected channel ${channel}`);
    return handler(payload);
  }) as unknown as ProjectInvoke;
  return {
    invoke,
    calls,
    handlers,
    callsTo: (channel) => calls.filter((c) => c.channel === channel).map((c) => c.payload),
  };
}

export type { ResponseOf };

export function fakeMedia(overrides: Partial<ProjectMediaPort> = {}): ProjectMediaPort {
  return {
    exists: async () => true,
    fetchBytes: async (url) => {
      if (url.endsWith("telemetry.json.gz")) {
        return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(TELEMETRY_JSON))));
      }
      throw new Error(`404 ${url}`);
    },
    decompress: async (bytes) => new Uint8Array(gunzipSync(bytes)),
    ...overrides,
  };
}

export function resetProjectStores(): void {
  useEditorStore.getState().reset();
  usePlaybackStore.getState().reset();
  useProjectSession.getState().reset();
}
