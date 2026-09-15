import {
  type BroadcastChannelLike,
  type RecordingBusMessage,
  createBroadcastRecordingBus,
  createMemoryBusHub,
  isRecordingBusMessage,
} from "./bus";
import { drain } from "./testFakes";

const snapshot = {
  sessionId: "s1",
  phase: "recording",
  countdownRemaining: null,
  countdownTotal: null,
  sourceLabel: "Studio Display",
  displayId: "d1",
  webcamDeviceId: null,
};

describe("isRecordingBusMessage — startRequest", () => {
  const setup = {
    sourceId: "d1",
    mode: "screen",
    mic: true,
    micDeviceId: "mic-1",
    systemAudio: false,
    webcam: false,
    fps: 30,
    countdown: 3,
    hideCursor: false,
  };

  it("accepts a well-formed setup, with or without device ids", () => {
    expect(isRecordingBusMessage({ type: "startRequest", setup })).toBe(true);
    const { micDeviceId: _mic, ...noDevice } = setup;
    expect(isRecordingBusMessage({ type: "startRequest", setup: noDevice })).toBe(true);
  });

  it("rejects bad modes, fps, countdowns and missing fields", () => {
    for (const bad of [
      { ...setup, mode: "desktop" },
      { ...setup, fps: 24 },
      { ...setup, countdown: 4 },
      { ...setup, mic: "yes" },
      { ...setup, micDeviceId: 3 },
      { ...setup, sourceId: undefined },
      null,
    ]) {
      expect(isRecordingBusMessage({ type: "startRequest", setup: bad })).toBe(false);
    }
  });
});

describe("isRecordingBusMessage", () => {
  it("accepts well-formed messages", () => {
    const ok: RecordingBusMessage[] = [
      { type: "snapshotRequest" },
      { type: "snapshot", snapshot: null },
      { type: "snapshot", snapshot: snapshot as never },
      { type: "micLevel", sessionId: "s1", level: 0.4 },
      { type: "warning", sessionId: "s1", code: "diskLow" },
      {
        type: "regionSelected",
        displayId: "d1",
        region: { x: 1, y: 2, width: 3, height: 4 },
        pixelRegion: { x: 2, y: 4, width: 6, height: 8 },
        scaleFactor: 2,
      },
      { type: "regionCancelled", displayId: "d1" },
    ];
    for (const m of ok) expect(isRecordingBusMessage(m)).toBe(true);
  });

  it("rejects malformed or foreign messages", () => {
    const bad: unknown[] = [
      null,
      "snapshot",
      { type: "nope" },
      { type: "micLevel", sessionId: "s1", level: Number.NaN },
      { type: "snapshot", snapshot: { ...snapshot, phase: "exploded" } },
      { type: "snapshot", snapshot: { ...snapshot, sourceLabel: 3 } },
      {
        type: "regionSelected",
        displayId: "d1",
        region: { x: 1, y: 2, width: 3 },
        pixelRegion: { x: 0, y: 0, width: 1, height: 1 },
        scaleFactor: 1,
      },
      {
        type: "regionSelected",
        displayId: "d1",
        region: { x: 0, y: 0, width: 1, height: 1 },
        pixelRegion: { x: 0, y: 0, width: 1, height: 1 },
        scaleFactor: 0,
      },
    ];
    for (const m of bad) expect(isRecordingBusMessage(m)).toBe(false);
  });
});

describe("createBroadcastRecordingBus", () => {
  function fakeChannel() {
    const listeners = new Set<(e: { data: unknown }) => void>();
    const posted: unknown[] = [];
    let closed = false;
    const ch: BroadcastChannelLike = {
      postMessage: (m) => posted.push(m),
      addEventListener: (_t, l) => listeners.add(l),
      removeEventListener: (_t, l) => listeners.delete(l),
      close: () => {
        closed = true;
      },
    };
    return {
      ch,
      posted,
      listeners,
      deliver: (data: unknown) => {
        for (const l of [...listeners]) l({ data });
      },
      get closed() {
        return closed;
      },
    };
  }

  it("posts, filters invalid data and cleans up on close", () => {
    const f = fakeChannel();
    let name = "";
    const bus = createBroadcastRecordingBus((n) => {
      name = n;
      return f.ch;
    });
    expect(name).toBe("reelform:recording");
    const seen: RecordingBusMessage[] = [];
    const off = bus.subscribe((m) => seen.push(m));
    bus.post({ type: "snapshotRequest" });
    expect(f.posted).toEqual([{ type: "snapshotRequest" }]);
    f.deliver({ type: "garbage" });
    f.deliver({ type: "regionCancelled", displayId: "d2" });
    expect(seen).toEqual([{ type: "regionCancelled", displayId: "d2" }]);
    off();
    expect(f.listeners.size).toBe(0);
    bus.subscribe(() => {});
    bus.close();
    expect(f.listeners.size).toBe(0);
    expect(f.closed).toBe(true);
  });
});

describe("createMemoryBusHub", () => {
  it("delivers asynchronously to other endpoints only, as copies", async () => {
    const hub = createMemoryBusHub();
    const a = hub.endpoint();
    const b = hub.endpoint();
    const seenA: RecordingBusMessage[] = [];
    const seenB: RecordingBusMessage[] = [];
    a.subscribe((m) => seenA.push(m));
    b.subscribe((m) => seenB.push(m));
    const msg: RecordingBusMessage = { type: "micLevel", sessionId: "s", level: 0.5 };
    a.post(msg);
    expect(seenB).toEqual([]);
    await drain();
    expect(seenA).toEqual([]);
    expect(seenB).toEqual([msg]);
    expect(seenB[0]).not.toBe(msg);
    b.close();
    a.post(msg);
    await drain();
    expect(seenB).toHaveLength(1);
  });
});

describe("isRecordingBusMessage — HUD messages", () => {
  it("accepts mic mute toggles and source outlines", () => {
    expect(isRecordingBusMessage({ type: "hud:setMicMuted", muted: true })).toBe(true);
    expect(
      isRecordingBusMessage({
        type: "hud:sourceOutline",
        displayId: "d1",
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        label: "Figma — Onboarding.fig",
      }),
    ).toBe(true);
    expect(
      isRecordingBusMessage({ type: "hud:sourceOutline", displayId: "d1", bounds: null }),
    ).toBe(true);
  });

  it("rejects malformed HUD messages", () => {
    for (const bad of [
      { type: "hud:setMicMuted" },
      { type: "hud:setMicMuted", muted: "yes" },
      { type: "hud:sourceOutline", bounds: null },
      { type: "hud:sourceOutline", displayId: "d1" },
      { type: "hud:sourceOutline", displayId: "d1", bounds: { x: 0, y: 0, width: -1, height: 2 } },
      { type: "hud:sourceOutline", displayId: "d1", bounds: null, label: 3 },
    ]) {
      expect(isRecordingBusMessage(bad)).toBe(false);
    }
  });

  it("snapshots may carry the started setup, which must be valid", () => {
    const setup = {
      sourceId: "d1",
      mode: "screen",
      mic: false,
      systemAudio: false,
      webcam: false,
      fps: 60,
      countdown: 3,
      hideCursor: false,
    };
    expect(isRecordingBusMessage({ type: "snapshot", snapshot: { ...snapshot, setup } })).toBe(
      true,
    );
    expect(
      isRecordingBusMessage({
        type: "snapshot",
        snapshot: { ...snapshot, setup: { ...setup, fps: 24 } },
      }),
    ).toBe(false);
  });
});
