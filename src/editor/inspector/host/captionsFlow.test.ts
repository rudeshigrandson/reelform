import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_FOR_TIER, findModel } from "../../../../electron/captions/models";
import { CAPTION_MODELS } from "../captions/types";
import {
  NO_SPEECH_MESSAGE,
  captionsErrorMessage,
  mapTranscribedCaptions,
  modelIdForTier,
  pickAudioCandidate,
  sidecarFileName,
  statusFromProgress,
} from "./captionsFlow";
import { makeMeta } from "./testFixtures";
import { deriveTranscribeRanges } from "./timeMap";

const audio = (path: string) => ({
  path,
  durationMs: 1000,
  width: 1,
  height: 1,
  fps: 1,
  codec: "opus",
  hasAudio: true,
});

describe("model catalog reconciliation", () => {
  it("each tier shows the catalog size of the model it downloads", () => {
    for (const m of CAPTION_MODELS) {
      expect(m.size).toBe(findModel(DEFAULT_MODEL_FOR_TIER[m.id])?.displaySize);
      expect(modelIdForTier(m.id)).toBe(DEFAULT_MODEL_FOR_TIER[m.id]);
    }
    expect(CAPTION_MODELS.map((m) => m.size)).toEqual(["32 MB", "190 MB", "540 MB"]);
  });
});

describe("pickAudioCandidate", () => {
  it("prefers mic, then system, then video audio", () => {
    const base = makeMeta();
    expect(
      pickAudioCandidate(
        makeMeta({}, { mic: audio("media/mic.webm"), system: audio("media/sys.webm") }),
        "/p",
      ),
    ).toEqual({
      role: "mic",
      path: "/p/media/mic.webm",
    });
    expect(pickAudioCandidate(makeMeta({}, { system: audio("media/sys.webm") }), "/p")?.role).toBe(
      "system",
    );
    expect(
      pickAudioCandidate(makeMeta({}, { video: { ...base.sources.video, hasAudio: true } }), "/p"),
    ).toEqual({
      role: "video",
      path: "/p/media/screen.mp4",
    });
    expect(pickAudioCandidate(base, "/p")).toBeNull();
    expect(pickAudioCandidate(null, "/p")).toBeNull();
  });
});

describe("mapTranscribedCaptions", () => {
  it("maps WAV time through trims and speeds back to the timeline", () => {
    // Clip: source 10s–20s at timeline 0; 2× between timeline 2s and 6s.
    const ranges = deriveTranscribeRanges(
      [{ id: "c", sourceStartMs: 10_000, sourceEndMs: 20_000, timelineStartMs: 0 }],
      [{ startMs: 2000, endMs: 6000, rate: 2 }],
    );
    // WAV layout: [0,2000) → t 0..2000; [2000,4000) → t 2000..6000 (2×); [4000,8000) → t 6000..10000.
    const out = mapTranscribedCaptions(
      [
        {
          id: "a",
          startMs: 1000,
          endMs: 3000,
          text: "hello",
          words: [{ t0: 1000, t1: 3000, text: "hello" }],
        },
        { id: "b", startMs: 5000, endMs: 5000, text: "world", words: [] },
        { id: "c", startMs: 7000, endMs: 7500, text: "   ", words: [] },
      ],
      ranges,
    );
    expect(out).toEqual([
      {
        id: "a",
        startMs: 1000,
        endMs: 4000,
        text: "hello",
        words: [{ t0: 1000, t1: 4000, text: "hello" }],
      },
      { id: "b", startMs: 7000, endMs: 7001, text: "world", words: [] },
    ]);
  });
});

describe("progress + errors", () => {
  it("filters progress by task id", () => {
    expect(statusFromProgress({ kind: "download", taskId: "m", progress: null }, "m")).toEqual({
      kind: "downloading",
      progress: 0,
    });
    expect(
      statusFromProgress(
        { kind: "transcribe", taskId: "j", progress: 0.34, doneMs: 14_000, totalMs: 42_000 },
        "j",
      ),
    ).toEqual({ kind: "transcribing", progress: 0.34, doneMs: 14_000, totalMs: 42_000 });
    expect(statusFromProgress({ kind: "download", taskId: "other", progress: 1 }, "m")).toBeNull();
  });

  it("maps error codes to copy", () => {
    expect(captionsErrorMessage({ code: "no-speech" }, "transcribe")).toBe(NO_SPEECH_MESSAGE);
    expect(captionsErrorMessage({ code: "cancelled" }, "download")).toBe("Cancelled.");
    expect(captionsErrorMessage(new Error("offline"), "download")).toBe(
      "Couldn't download the model. offline",
    );
    expect(captionsErrorMessage(null, "transcribe")).toBe("Couldn't transcribe.");
  });

  it("builds safe sidecar names", () => {
    expect(sidecarFileName("My: demo/1", "srt")).toBe("My  demo 1.srt");
    expect(sidecarFileName("  ", "vtt")).toBe("captions.vtt");
  });
});
