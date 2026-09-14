import { describe, expect, it } from "vitest";
import { RecordingEvent, recordingContracts, recordingEvents } from "./contracts";

describe("recording contracts", () => {
  it("channel names match keys and follow domain:verb", () => {
    for (const [key, c] of Object.entries(recordingContracts)) {
      expect(c.name).toBe(key);
      expect(key).toMatch(/^recording:[a-zA-Z]+$/);
    }
    expect(Object.keys(recordingContracts).sort()).toEqual(
      [
        "recording:discard",
        "recording:finalize",
        "recording:listSources",
        "recording:pause",
        "recording:resume",
        "recording:start",
        "recording:stop",
        "recording:writeChunk",
      ].sort(),
    );
    expect(recordingEvents["recording:event"].name).toBe("recording:event");
  });

  it("validates start requests (§3)", () => {
    const start = recordingContracts["recording:start"].request;
    const valid = {
      source: { kind: "display", id: "1" },
      audio: { system: true },
      fps: 60,
      countdown: 3,
      hideCursor: true,
    };
    expect(start.safeParse(valid).success).toBe(true);
    expect(start.safeParse({ ...valid, fps: 45 }).success).toBe(false);
    expect(start.safeParse({ ...valid, countdown: 4 }).success).toBe(false);
    expect(start.safeParse({ ...valid, source: { kind: "tab", id: "x" } }).success).toBe(false);
  });

  it("writeChunk accepts binary chunks only", () => {
    const req = recordingContracts["recording:writeChunk"].request;
    expect(
      req.safeParse({ sessionId: "s", track: "screen", chunk: new Uint8Array([1]) }).success,
    ).toBe(true);
    expect(req.safeParse({ sessionId: "s", track: "mic", chunk: new ArrayBuffer(2) }).success).toBe(
      true,
    );
    expect(req.safeParse({ sessionId: "s", track: "screen", chunk: "AAAA" }).success).toBe(false);
    expect(
      req.safeParse({ sessionId: "s", track: "cursor", chunk: new Uint8Array() }).success,
    ).toBe(false);
  });

  it("event payloads discriminate by type", () => {
    expect(
      RecordingEvent.safeParse({
        sessionId: "s",
        type: "interrupted",
        reason: "diskLow",
        recordedMs: 42_000,
      }).success,
    ).toBe(true);
    expect(
      RecordingEvent.safeParse({
        sessionId: "s",
        type: "interrupted",
        reason: "cosmic ray",
        recordedMs: 1,
      }).success,
    ).toBe(false);
  });
});
