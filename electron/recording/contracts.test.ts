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
        "recording:endTrack",
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
    const ok = { sessionId: "s", track: "screen", seq: 0, chunk: new Uint8Array([1]) };
    expect(req.safeParse(ok).success).toBe(true);
    expect(req.safeParse({ ...ok, track: "mic", chunk: new ArrayBuffer(2) }).success).toBe(true);
    expect(req.safeParse({ ...ok, chunk: "AAAA" }).success).toBe(false);
    expect(req.safeParse({ ...ok, track: "cursor" }).success).toBe(false);
    // The renderer's old "video" track name is not a main track.
    expect(req.safeParse({ ...ok, track: "video" }).success).toBe(false);
    expect(req.safeParse({ ...ok, seq: -1 }).success).toBe(false);
    expect(req.safeParse({ ...ok, seq: 1.5 }).success).toBe(false);
    const { seq: _seq, ...noSeq } = ok;
    expect(req.safeParse(noSeq).success).toBe(false);
  });

  it("endTrack requires a non-negative integer chunk count", () => {
    const req = recordingContracts["recording:endTrack"].request;
    expect(req.safeParse({ sessionId: "s", track: "webcam", chunkCount: 0 }).success).toBe(true);
    expect(
      req.safeParse({ sessionId: "s", track: "mic", chunkCount: 3, mimeType: "audio/webm" })
        .success,
    ).toBe(true);
    expect(req.safeParse({ sessionId: "s", track: "mic", chunkCount: -1 }).success).toBe(false);
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
