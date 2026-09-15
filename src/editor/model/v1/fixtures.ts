import type { Project } from "../schema";

/** Shared test fixtures: an M0-subset document (what `../schema.ts` accepts). */
export function m0Fixture(): Project {
  return {
    schemaVersion: 1,
    id: "p1",
    name: "My Demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    appVersion: "0.0.0",
    sources: {
      video: {
        path: "media/screen.mp4",
        durationMs: 10_000,
        width: 1920,
        height: 1080,
        fps: 60,
        codec: "h264",
        hasAudio: true,
      },
    },
    timeline: {
      durationMs: 10_000,
      clips: [{ id: "c1", sourceStartMs: 0, sourceEndMs: 10_000, timelineStartMs: 0 }],
      speeds: [{ id: "s1", startMs: 1000, endMs: 2000, rate: 2, keepPitch: true }],
    },
  };
}
