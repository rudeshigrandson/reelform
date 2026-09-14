import { describe, expect, it } from "vitest";
import { parseProject, type Project } from "./schema";

const validProject: Project = {
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
    speeds: [],
  },
};

describe("parseProject", () => {
  it("accepts a valid v1 project", () => {
    expect(() => parseProject(validProject)).not.toThrow();
  });

  it("rejects a wrong schemaVersion", () => {
    expect(() => parseProject({ ...validProject, schemaVersion: 2 })).toThrow();
  });

  it("rejects a clip whose end precedes its start", () => {
    const bad = {
      ...validProject,
      timeline: {
        ...validProject.timeline,
        clips: [{ id: "c1", sourceStartMs: 5000, sourceEndMs: 1000, timelineStartMs: 0 }],
      },
    };
    expect(() => parseProject(bad)).toThrow();
  });

  it("rejects a speed rate outside 0.25–8", () => {
    const bad = {
      ...validProject,
      timeline: {
        ...validProject.timeline,
        speeds: [{ id: "s1", startMs: 0, endMs: 1000, rate: 20, keepPitch: true }],
      },
    };
    expect(() => parseProject(bad)).toThrow();
  });
});
