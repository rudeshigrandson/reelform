import type { Project } from "../../model/schema";
import type { ProjectInfo } from "./types";

/** Shared test fixtures for the Project tab. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    id: "p1",
    name: "Onboarding flow walkthrough",
    createdAt: "2026-09-14T15:04:00.000Z",
    modifiedAt: "2026-09-14T16:30:00.000Z",
    appVersion: "1.0.0",
    sources: {
      video: {
        path: "recording/screen.mp4",
        durationMs: 60_000,
        width: 3024,
        height: 1964,
        fps: 60,
        codec: "h264",
        hasAudio: true,
      },
    },
    timeline: { durationMs: 60_000, clips: [], speeds: [] },
    ...overrides,
  };
}

export function makeInfo(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "p1",
    name: "Onboarding flow walkthrough",
    locationPath: "/Users/me/Movies/Reelform/Onboarding flow walkthrough.reelform",
    createdAt: "2026-09-14T15:04:00.000Z",
    modifiedAt: "2026-09-14T16:30:00.000Z",
    sources: [
      {
        role: "video",
        path: "recording/screen.mp4",
        absolutePath: "/Users/me/Movies/Reelform/Onboarding flow walkthrough.reelform/recording/screen.mp4",
        sizeBytes: 1_288_490_189,
        missing: false,
        durationMs: 42_180,
      },
    ],
    recording: {
      width: 3024,
      height: 1964,
      fps: 60,
      durationMs: 42_180,
      codec: "h264",
      captureBackend: "ScreenCaptureKit",
      cursorPointCount: 2531,
      audioTracks: ["MacBook Pro Microphone", "System audio"],
    },
    ...overrides,
  };
}
