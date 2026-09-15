import { beforeEach, describe, expect, it } from "vitest";
import { initialProjectSession, useProjectSession } from "./session";

beforeEach(() => {
  useProjectSession.getState().reset();
});

describe("useProjectSession", () => {
  it("starts idle with no project, media or telemetry", () => {
    const s = useProjectSession.getState();
    expect(s.status).toBe("idle");
    expect([s.projectPath, s.projectId, s.videoUrl, s.sourceSize, s.telemetry]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(s.mediaOffline).toBe(false);
  });

  it("setSession merges a partial patch without touching other fields", () => {
    useProjectSession.getState().setSession({ status: "loading", projectPath: "/p/Demo.reelform" });
    useProjectSession.getState().setSession({
      status: "ready",
      videoUrl: "reelform-media://r-1/media/screen.mp4",
      sourceSize: { width: 2880, height: 1800 },
    });
    const s = useProjectSession.getState();
    expect(s).toMatchObject({
      status: "ready",
      projectPath: "/p/Demo.reelform",
      videoUrl: "reelform-media://r-1/media/screen.mp4",
      sourceSize: { width: 2880, height: 1800 },
    });
  });

  it("reset returns every data field to its initial value", () => {
    useProjectSession.getState().setSession({ status: "error", mediaOffline: true, projectId: "x" });
    useProjectSession.getState().reset();
    const { setSession: _set, reset: _reset, ...data } = useProjectSession.getState();
    expect(data).toEqual(initialProjectSession());
  });

  it("initialProjectSession returns a fresh object each call", () => {
    const a = initialProjectSession();
    a.sourceSize = { width: 1, height: 1 };
    expect(initialProjectSession().sourceSize).toBeNull();
  });
});
