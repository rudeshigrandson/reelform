import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_CURSOR_SETTINGS } from "../../inspector/cursor/types";
import { DEFAULT_FRAME_SETTINGS } from "../../inspector/frame/types";
import { parseProject } from "../schema";
import { m0Fixture } from "./fixtures";
import {
  type Migration,
  ProjectLoadError,
  formatIssuePath,
  loadProject,
  migrate,
} from "./migrations";

function expectError(raw: unknown) {
  const r = migrate(raw);
  if (r.ok) throw new Error("expected failure");
  expect(r.error).toBeInstanceOf(ProjectLoadError);
  return r.error;
}

describe("migrate", () => {
  it("accepts the M0 fixture and fills every post-M0 field with defaults", () => {
    const raw = m0Fixture();
    expect(() => parseProject(raw)).not.toThrow();
    const r = migrate(raw);
    if (!r.ok) throw r.error;
    expect(r.fromVersion).toBe(1);
    const p = r.project;
    expect(p.frame).toEqual(DEFAULT_FRAME_SETTINGS);
    expect(p.timeline.zooms).toEqual([]);
    expect(p.timeline.speeds).toEqual([
      { id: "s1", startMs: 1000, endMs: 2000, rate: 2, keepPitch: true, rampInMs: 0, rampOutMs: 0 },
    ]);
    expect(p.ui.selection).toEqual({ zoomId: null, annotationId: null, speedId: null });
    expect(p.sources.capture).toBeUndefined();
  });

  it("defaults cursor.scaleWithZoom to false on documents saved before it existed", () => {
    const raw = m0Fixture() as Record<string, unknown>;
    const { scaleWithZoom: _drop, ...legacyCursor } = structuredClone(DEFAULT_CURSOR_SETTINGS);
    const r = migrate({ ...raw, cursor: { ...legacyCursor, size: 140 } });
    if (!r.ok) throw r.error;
    expect(r.project.cursor.scaleWithZoom).toBe(false);
    expect(r.project.cursor.size).toBe(140);
    const on = migrate({ ...raw, cursor: { ...legacyCursor, scaleWithZoom: true } });
    if (!on.ok) throw on.error;
    expect(on.project.cursor.scaleWithZoom).toBe(true);
  });

  it("defaults are fresh copies, never shared references", () => {
    const a = loadProject(m0Fixture());
    const b = loadProject(m0Fixture());
    expect(a.frame).not.toBe(b.frame);
    expect(a.frame).not.toBe(DEFAULT_FRAME_SETTINGS);
  });

  it("migrates an unversioned (v0) document", () => {
    const { schemaVersion: _v, ...raw } = m0Fixture();
    const r = migrate(raw);
    if (!r.ok) throw r.error;
    expect(r.fromVersion).toBe(0);
    expect(r.project.schemaVersion).toBe(1);
  });

  it("maps the spec's single rampMs onto in/out ramps", () => {
    const raw = m0Fixture();
    const speeds = [{ id: "s1", startMs: 0, endMs: 1000, rate: 3, rampMs: 300 }];
    const p = loadProject({ ...raw, timeline: { ...raw.timeline, speeds } });
    expect(p.timeline.speeds[0]).toMatchObject({ rampInMs: 300, rampOutMs: 300, keepPitch: true });
  });

  it("rejects a future version with a typed error", () => {
    const e = expectError({ ...m0Fixture(), schemaVersion: 7 });
    expect(e.code).toBe("future-version");
    expect(e.version).toBe(7);
  });

  it("property: every version above current is future-version", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 1_000_000 }), (v) => {
        const r = migrate({ ...m0Fixture(), schemaVersion: v });
        return !r.ok && r.error.code === "future-version";
      }),
    );
  });

  it.each([[-1], [1.5], ["1"], [null]])("rejects schemaVersion %j", (v) => {
    expect(expectError({ ...m0Fixture(), schemaVersion: v }).code).toBe("invalid-version");
  });

  it.each([[null], [[]], ["{}"], [42]])("rejects non-object %j", (raw) => {
    expect(expectError(raw).code).toBe("not-an-object");
  });

  it("reports a missing migration step", () => {
    const r = migrate({ schemaVersion: 0 }, [], 1);
    expect(!r.ok && r.error.code).toBe("no-migration-path");
  });

  it("chains a custom registry in order", () => {
    const ran: number[] = [];
    const steps: Migration[] = [
      {
        from: 0,
        to: 1,
        description: "a",
        up: (d) => {
          ran.push(0);
          return { ...d, schemaVersion: 1 };
        },
      },
    ];
    const { schemaVersion: _v, ...raw } = m0Fixture();
    const r = migrate(raw, steps);
    expect(r.ok && r.fromVersion).toBe(0);
    expect(ran).toEqual([0]);
  });

  it("chains multi-step registries in version order", () => {
    const ran: string[] = [];
    const steps: Migration[] = [
      // Deliberately out of order in the registry.
      {
        from: 1,
        to: 2,
        description: "b",
        up: (d) => {
          ran.push("1->2");
          // Test-only: land back on the v1 literal so the real schema validates.
          return { ...d, schemaVersion: 1, name: `${String(d.name)}+b` };
        },
      },
      {
        from: 0,
        to: 1,
        description: "a",
        up: (d) => {
          ran.push("0->1");
          return { ...d, name: `${String(d.name)}+a` };
        },
      },
    ];
    const { schemaVersion: _v, ...raw } = m0Fixture();
    const r = migrate(raw, steps, 2);
    if (!r.ok) throw r.error;
    expect(ran).toEqual(["0->1", "1->2"]);
    expect(r.project.name).toBe("My Demo+a+b");
    expect(r.fromVersion).toBe(0);
  });

  it("reports a gap in the middle of a chain", () => {
    const steps: Migration[] = [{ from: 0, to: 1, description: "a", up: (d) => d }];
    const r = migrate({}, steps, 3);
    expect(!r.ok && r.error.code).toBe("no-migration-path");
  });

  it("rejects a step that overshoots the current version", () => {
    const steps: Migration[] = [{ from: 0, to: 5, description: "x", up: (d) => d }];
    const r = migrate({}, steps, 1);
    expect(!r.ok && r.error.code).toBe("no-migration-path");
  });

  it("a throwing or non-object migration becomes a typed error, never a throw", () => {
    const boom: Migration[] = [
      {
        from: 0,
        to: 1,
        description: "boom",
        up: () => {
          throw new Error("bad data");
        },
      },
    ];
    const r1 = migrate({}, boom, 1);
    expect(!r1.ok && r1.error.code).toBe("migration-failed");
    expect(!r1.ok && r1.error.message).toMatch(/bad data/);
    const nonObject: Migration[] = [
      // Simulates a buggy migration returning a non-object at runtime.
      { from: 0, to: 1, description: "null", up: () => null as unknown as Record<string, unknown> },
    ];
    const r2 = migrate({}, nonObject, 1);
    expect(!r2.ok && r2.error.code).toBe("migration-failed");
  });

  it("property: migrate never throws on arbitrary JSON input", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const r = migrate(v);
        return typeof r.ok === "boolean";
      }),
      { numRuns: 200 },
    );
  });

  it("accepts zero-length audio regions (the audio tab can create them)", () => {
    const raw = m0Fixture();
    const region = {
      id: "a1",
      fileName: "m.mp3",
      path: "media/m.mp3",
      startMs: 500,
      endMs: 500,
      volumeDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      loop: false,
      duck: { enabled: true, amountDb: 12 },
    };
    const p = loadProject({ ...raw, timeline: { ...raw.timeline, audioRegions: [region] } });
    expect(p.timeline.audioRegions[0]?.offsetMs).toBe(0);
    const bad = { ...region, endMs: 400 };
    const err = expectError({ ...raw, timeline: { ...raw.timeline, audioRegions: [bad] } });
    expect(err.issues.map((i) => i.path)).toContain("timeline.audioRegions[0].endMs");
  });

  it("loadProject throws the typed error", () => {
    expect(() => loadProject({ schemaVersion: 99 })).toThrow(ProjectLoadError);
  });
});

describe("invalid documents report useful paths", () => {
  const withTimeline = (patch: Record<string, unknown>) => {
    const raw = m0Fixture();
    return { ...raw, timeline: { ...raw.timeline, ...patch } };
  };
  const zoom = {
    id: "z1",
    startMs: 0,
    endMs: 1000,
    level: 2,
    focus: { mode: "fixed", x: 0.5, y: 0.5 },
    easeInMs: 600,
    easeOutMs: 700,
    curve: "ease-out-cubic",
    source: "manual",
  };

  const paths = (raw: unknown) => expectError(raw).issues.map((i) => i.path);

  it("zoom level out of range", () => {
    expect(paths(withTimeline({ zooms: [{ ...zoom, level: 9 }] }))).toContain(
      "timeline.zooms[0].level",
    );
  });

  it("zoom region ending before it starts", () => {
    expect(paths(withTimeline({ zooms: [{ ...zoom, endMs: 0 }] }))).toContain(
      "timeline.zooms[0].endMs",
    );
  });

  it("duplicate ids on a track", () => {
    expect(
      paths(withTimeline({ zooms: [zoom, { ...zoom, startMs: 2000, endMs: 3000 }] })),
    ).toContain("timeline.zooms[1].id");
  });

  it("unknown annotation kind", () => {
    expect(paths(withTimeline({ annotations: [{ kind: "sparkle" }] }))[0]).toBe(
      "timeline.annotations[0].kind",
    );
  });

  it("transition pointing at a missing clip", () => {
    const transitions = [
      { id: "t1", afterClipId: "nope", kind: "cross-dissolve", durationMs: 400 },
    ];
    expect(paths(withTimeline({ transitions }))).toContain("timeline.transitions[0].afterClipId");
  });

  it("frame color and missing video source", () => {
    const raw = m0Fixture();
    const bad = {
      ...raw,
      sources: {},
      frame: {
        ...DEFAULT_FRAME_SETTINGS,
        shadow: { ...DEFAULT_FRAME_SETTINGS.shadow, color: "red" },
      },
    };
    const err = expectError(bad);
    expect(err.code).toBe("invalid-document");
    expect(err.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["sources.video", "frame.shadow.color"]),
    );
    expect(err.message).toMatch(/issues/);
  });

  it("-Infinity volume is not JSON-safe and is rejected (must be null)", () => {
    const raw = loadProject(m0Fixture());
    const bad = structuredClone(raw);
    bad.audio.master.volumeDb = Number.NEGATIVE_INFINITY;
    expect(paths(bad)).toContain("audio.master.volumeDb");
  });
});

describe("formatIssuePath", () => {
  it("formats nested and root paths", () => {
    expect(formatIssuePath(["a", 0, "b", 12])).toBe("a[0].b[12]");
    expect(formatIssuePath([])).toBe("(root)");
  });
});
