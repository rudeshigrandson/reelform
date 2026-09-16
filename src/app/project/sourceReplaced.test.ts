import type { EventName, EventPayloadOf } from "@contracts";
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import type { ProjectMeta } from "../../editor/persistence";
import { type ProjectSessionState, initialProjectSession } from "./session";
import {
  type SourceReplacedEvent,
  applySourceReplaced,
  bindSourceReplaced,
} from "./sourceReplaced";

const video = {
  path: "media/screen.mp4",
  durationMs: 8000,
  width: 1920,
  height: 1080,
  fps: 60,
  codec: "vp9",
  hasAudio: false,
};

function sessionStore(patch: Partial<ProjectSessionState> = {}) {
  const meta = {
    id: "p1",
    name: "Demo",
    createdAt: "x",
    modifiedAt: "x",
    appVersion: "1",
    sources: { video },
  } as ProjectMeta;
  const session = create<ProjectSessionState>((set) => ({
    ...initialProjectSession(),
    projectPath: "/Projects/Demo.reelform",
    projectId: "p1",
    meta,
    mediaBaseUrl: "reelform-media://root/",
    videoUrl: "reelform-media://root/media/screen.mp4",
    setSession: (p) => set(p),
    reset: () => set(initialProjectSession()),
    ...patch,
  }));
  return { session };
}

const event = (extra: Partial<SourceReplacedEvent> = {}): SourceReplacedEvent => ({
  path: "/Projects/Demo.reelform",
  projectId: "p1",
  source: "video",
  from: "media/screen.mp4",
  to: "media/screen.h264.mp4",
  codec: "h264",
  ...extra,
});

describe("applySourceReplaced", () => {
  it("patches the session source and video URL of the open project", () => {
    const stores = sessionStore();
    expect(applySourceReplaced(event(), stores)).toBe(true);
    const s = stores.session.getState();
    expect(s.meta?.sources.video).toEqual({
      ...video,
      path: "media/screen.h264.mp4",
      codec: "h264",
    });
    expect(s.videoUrl).toBe("reelform-media://root/media/screen.h264.mp4");
    expect(s.meta?.name).toBe("Demo");
  });

  it("matches a renamed folder by project id; keeps the codec when none is sent", () => {
    const stores = sessionStore({ projectPath: "/Projects/Renamed.reelform" });
    const { codec: _codec, ...noCodec } = event();
    expect(applySourceReplaced(noCodec, stores)).toBe(true);
    expect(stores.session.getState().meta?.sources.video.codec).toBe("vp9");
  });

  it("ignores other projects, stale swaps, missing sources and closed sessions", () => {
    const stores = sessionStore();
    const before = stores.session.getState();
    expect(applySourceReplaced(event({ path: "/other", projectId: "p2" }), stores)).toBe(false);
    expect(applySourceReplaced(event({ from: "media/other.mp4" }), stores)).toBe(false);
    expect(applySourceReplaced(event({ source: "webcam" }), stores)).toBe(false);
    expect(stores.session.getState()).toBe(before);
    const closed = sessionStore({ meta: null });
    expect(applySourceReplaced(event(), closed)).toBe(false);
  });

  it("keeps the served URL when no project media root is registered", () => {
    const stores = sessionStore({ mediaBaseUrl: null });
    expect(applySourceReplaced(event(), stores)).toBe(true);
    expect(stores.session.getState().videoUrl).toBe("reelform-media://root/media/screen.mp4");
  });
});

describe("bindSourceReplaced", () => {
  it("subscribes to project:sourceReplaced and unsubscribes", () => {
    const listeners = new Map<string, (p: unknown) => void>();
    const onEvent = <K extends EventName>(channel: K, cb: (p: EventPayloadOf<K>) => void) => {
      listeners.set(channel, cb as (p: unknown) => void);
      return () => listeners.delete(channel);
    };
    const stores = sessionStore();
    const off = bindSourceReplaced(onEvent, stores);
    listeners.get("project:sourceReplaced")?.(event());
    expect(stores.session.getState().meta?.sources.video.path).toBe("media/screen.h264.mp4");
    off();
    expect(listeners.size).toBe(0);
  });
});
