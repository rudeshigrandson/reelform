import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SLIDER_STEPS,
  addRegion,
  anySolo,
  clampDb,
  clampFades,
  dbToGain,
  dbToSliderPosition,
  downsamplePeaks,
  formatDb,
  gainToDb,
  regionGain,
  removeRegion,
  setClickVolume,
  sliderPositionToDb,
  trackGain,
  updateMaster,
  updateRegion,
  updateTrack,
} from "./audio";
import { AUDIO_LIMITS, type AudioSettings, DEFAULT_AUDIO_SETTINGS } from "./types";

const base = DEFAULT_AUDIO_SETTINGS;
const music = {
  id: "r1",
  fileName: "music.mp3",
  path: "audio/music.mp3",
  startMs: 0,
  endMs: 10_000,
};
const withTracks = (
  patch: Partial<AudioSettings["tracks"]["mic"]>,
  sys: Partial<AudioSettings["tracks"]["system"]> = {},
) => updateTrack(updateTrack(base, "mic", patch), "system", sys);

describe("dB ↔ gain", () => {
  it("maps −∞ ↔ 0 and 0 dB ↔ 1", () => {
    expect(dbToGain(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(gainToDb(-1)).toBe(Number.NEGATIVE_INFINITY);
    expect(dbToGain(Number.NaN)).toBe(0);
    expect(dbToGain(0)).toBe(1);
    expect(gainToDb(1)).toBe(0);
  });

  it("caps at +12 dB", () => {
    expect(dbToGain(40)).toBeCloseTo(10 ** (12 / 20));
    expect(gainToDb(100)).toBe(12);
  });

  it("round-trips finite dB within range (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: -120, max: 12, noNaN: true }), (db) => {
        expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 6);
      }),
    );
  });

  it("gain is monotonic in dB (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 12, noNaN: true }),
        fc.double({ min: -100, max: 12, noNaN: true }),
        (a, b) => {
          if (a <= b) expect(dbToGain(a)).toBeLessThanOrEqual(dbToGain(b));
        },
      ),
    );
  });

  it("clampDb normalizes floor, NaN and cap", () => {
    expect(clampDb(AUDIO_LIMITS.minDb)).toBe(Number.NEGATIVE_INFINITY);
    expect(clampDb(-80)).toBe(Number.NEGATIVE_INFINITY);
    expect(clampDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
    expect(clampDb(20)).toBe(12);
    expect(clampDb(-6)).toBe(-6);
  });
});

describe("slider ↔ dB", () => {
  it("maps endpoints", () => {
    expect(sliderPositionToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(dbToSliderPosition(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(sliderPositionToDb(SLIDER_STEPS)).toBe(12);
    expect(dbToSliderPosition(99)).toBe(SLIDER_STEPS);
    expect(sliderPositionToDb(1)).toBeCloseTo(-59.9);
    expect(sliderPositionToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
    expect(sliderPositionToDb(-5)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("any audible dB gets a non-zero position", () => {
    expect(dbToSliderPosition(-59.99)).toBe(1);
  });

  it("position → dB → position is identity (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: SLIDER_STEPS }), (p) => {
        expect(dbToSliderPosition(sliderPositionToDb(p))).toBe(p);
      }),
    );
  });

  it("dB → position → dB stays within 0.1 dB (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: -59.99, max: 12, noNaN: true }), (db) => {
        expect(Math.abs(sliderPositionToDb(dbToSliderPosition(db)) - db)).toBeLessThanOrEqual(
          0.1 + 1e-9,
        );
      }),
    );
  });

  it("formats dB", () => {
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe("−∞ dB");
    expect(formatDb(0)).toBe("0.0 dB");
    expect(formatDb(-0.04)).toBe("0.0 dB");
    expect(formatDb(3.46)).toBe("+3.5 dB");
    expect(formatDb(-12)).toBe("−12.0 dB");
  });
});

describe("effective gain", () => {
  it("defaults to unity", () => {
    expect(trackGain(base, "mic")).toBe(1);
    expect(trackGain(base, "system")).toBe(1);
  });

  it("mute and mute-all silence", () => {
    expect(trackGain(withTracks({ muted: true }), "mic")).toBe(0);
    expect(trackGain(withTracks({ muted: true }), "system")).toBe(1);
    const all = updateMaster(base, { muteAll: true });
    expect(trackGain(all, "mic")).toBe(0);
    expect(trackGain(all, "system")).toBe(0);
  });

  it("solo silences non-soloed tracks and regions", () => {
    const s = addRegion(withTracks({ solo: true }), music);
    expect(anySolo(s)).toBe(true);
    expect(trackGain(s, "mic")).toBe(1);
    expect(trackGain(s, "system")).toBe(0);
    expect(regionGain(s, s.regions[0]!)).toBe(0);
  });

  it("muted wins over solo", () => {
    expect(trackGain(withTracks({ solo: true, muted: true }), "mic")).toBe(0);
  });

  it("ignores solo on unavailable tracks", () => {
    const s = withTracks({}, { solo: true });
    expect(trackGain(s, "mic", { mic: true, system: false })).toBe(1);
    expect(trackGain(s, "system", { mic: true, system: false })).toBe(0);
  });

  it("applies master gain and ducking", () => {
    const s = addRegion(updateMaster(base, { volumeDb: -6 }), music);
    const r = s.regions[0]!;
    expect(trackGain(s, "mic")).toBeCloseTo(dbToGain(-6));
    expect(regionGain(s, r)).toBeCloseTo(dbToGain(-6));
    expect(regionGain(s, r, { ducked: true })).toBeCloseTo(dbToGain(-6 - r.duck.amountDb));
    const noDuck = updateRegion(s, "r1", { duck: { enabled: false } });
    expect(regionGain(noDuck, noDuck.regions[0]!, { ducked: true })).toBeCloseTo(dbToGain(-6));
  });

  it("gain is always within [0, cap²] (property)", () => {
    const cap = dbToGain(12) ** 2;
    fc.assert(
      fc.property(
        fc.record({
          micDb: fc.double({ min: -100, max: 30, noNaN: true }),
          masterDb: fc.double({ min: -100, max: 30, noNaN: true }),
          muted: fc.boolean(),
          solo: fc.boolean(),
          sysSolo: fc.boolean(),
          muteAll: fc.boolean(),
        }),
        (x) => {
          const s = updateMaster(
            withTracks({ volumeDb: x.micDb, muted: x.muted, solo: x.solo }, { solo: x.sysSolo }),
            {
              volumeDb: x.masterDb,
              muteAll: x.muteAll,
            },
          );
          const g = trackGain(s, "mic");
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(cap + 1e-9);
          if (x.muted || x.muteAll || (x.sysSolo && !x.solo)) expect(g).toBe(0);
        },
      ),
    );
  });
});

describe("clampFades", () => {
  it("keeps valid fades unchanged", () => {
    expect(clampFades(200, 300, 1000)).toEqual({ fadeInMs: 200, fadeOutMs: 300 });
  });

  it("keeps the prioritized fade and shrinks the other", () => {
    expect(clampFades(700, 500, 1000, "in")).toEqual({ fadeInMs: 700, fadeOutMs: 300 });
    expect(clampFades(700, 500, 1000, "out")).toEqual({ fadeInMs: 500, fadeOutMs: 500 });
    expect(clampFades(5000, 500, 1000, "in")).toEqual({ fadeInMs: 1000, fadeOutMs: 0 });
  });

  it("handles negative, NaN and zero duration", () => {
    expect(clampFades(-5, Number.NaN, 1000)).toEqual({ fadeInMs: 0, fadeOutMs: 0 });
    expect(clampFades(100, 100, 0)).toEqual({ fadeInMs: 0, fadeOutMs: 0 });
    expect(clampFades(100, 100, Number.NaN)).toEqual({ fadeInMs: 0, fadeOutMs: 0 });
  });

  it("sum never exceeds duration, fades stay ≥ 0 (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        fc.integer({ min: 0, max: 600_000 }),
        fc.constantFrom<"in" | "out" | undefined>("in", "out", undefined),
        (fi, fo, d, p) => {
          const r = clampFades(fi, fo, d, p);
          expect(r.fadeInMs).toBeGreaterThanOrEqual(0);
          expect(r.fadeOutMs).toBeGreaterThanOrEqual(0);
          expect(r.fadeInMs + r.fadeOutMs).toBeLessThanOrEqual(d);
          // Math.max(0, …) normalizes -0: fc.double generates -0, which passes `>= 0`
          // but Math.round(-0) is -0 and toBe uses Object.is.
          if (p === "in" && fi >= 0 && Math.round(fi) <= d)
            expect(r.fadeInMs).toBe(Math.max(0, Math.round(fi)));
          if (p === "out" && fo >= 0 && Math.round(fo) <= d)
            expect(r.fadeOutMs).toBe(Math.max(0, Math.round(fo)));
        },
      ),
    );
  });
});

describe("tracks / master / clicks", () => {
  it("clamps track volume and fades to duration, prioritizing the edited fade", () => {
    let s = updateTrack(base, "mic", { fadeOutMs: 800 }, 1000);
    s = updateTrack(s, "mic", { fadeInMs: 500 }, 1000);
    expect(s.tracks.mic).toMatchObject({ fadeInMs: 500, fadeOutMs: 500 });
    expect(updateTrack(base, "system", { volumeDb: 50 }).tracks.system.volumeDb).toBe(12);
  });

  it("caps fades without a known duration", () => {
    expect(updateTrack(base, "mic", { fadeInMs: 99_999 }).tracks.mic.fadeInMs).toBe(
      AUDIO_LIMITS.fadeMaxMs,
    );
  });

  it("does not mutate input", () => {
    const snapshot = JSON.stringify(base);
    updateTrack(base, "mic", { muted: true, noiseReduction: true });
    addRegion(base, music);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("clamps click volume and ignores NaN", () => {
    expect(setClickVolume(base, 150).clickVolume).toBe(100);
    expect(setClickVolume(base, -1).clickVolume).toBe(0);
    expect(setClickVolume(base, Number.NaN).clickVolume).toBe(base.clickVolume);
  });
});

describe("regions", () => {
  it("adds with defaults and ducking on", () => {
    const s = addRegion(base, music);
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0]).toMatchObject({
      id: "r1",
      volumeDb: 0,
      loop: false,
      duck: { enabled: true },
    });
  });

  it("ignores duplicate ids and unknown removals", () => {
    const s = addRegion(base, music);
    expect(addRegion(s, music)).toBe(s);
    expect(removeRegion(s, "nope")).toBe(s);
    expect(updateRegion(s, "nope", { loop: true })).toBe(s);
  });

  it("sanitizes region bounds", () => {
    const s = addRegion(base, { ...music, startMs: 500, endMs: 100 });
    expect(s.regions[0]).toMatchObject({ startMs: 500, endMs: 500 });
  });

  it("updates, clamps fades to region duration and duck amount", () => {
    let s = addRegion(base, { ...music, endMs: 2000 });
    s = updateRegion(s, "r1", { fadeInMs: 1500, fadeOutMs: 0 });
    s = updateRegion(s, "r1", { fadeOutMs: 1200 });
    expect(s.regions[0]).toMatchObject({ fadeInMs: 800, fadeOutMs: 1200 });
    s = updateRegion(s, "r1", { duck: { amountDb: 99 } });
    expect(s.regions[0]!.duck).toEqual({ enabled: true, amountDb: AUDIO_LIMITS.duckAmountDb.max });
  });

  it("add then remove restores the region list (property)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 8 }),
        fc.nat(),
        (ids, pick) => {
          let s = base;
          for (const id of ids) s = addRegion(s, { ...music, id });
          expect(s.regions.map((r) => r.id)).toEqual(ids);
          if (ids.length === 0) return;
          const victim = ids[pick % ids.length]!;
          const after = removeRegion(s, victim);
          expect(after.regions.map((r) => r.id)).toEqual(ids.filter((id) => id !== victim));
        },
      ),
    );
  });
});

describe("downsamplePeaks", () => {
  it("handles empty and invalid input", () => {
    expect(downsamplePeaks([], 10)).toEqual([]);
    expect(downsamplePeaks([0.5], 0)).toEqual([]);
    expect(downsamplePeaks([Number.NaN, 2, -1], 10)).toEqual([0, 1, 0]);
  });

  it("keeps length ≤ bars, values in [0,1] and preserves the max (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -2, max: 2, noNaN: true }), { minLength: 1, maxLength: 500 }),
        fc.integer({ min: 1, max: 64 }),
        (peaks, bars) => {
          const out = downsamplePeaks(peaks, bars);
          expect(out.length).toBe(Math.min(peaks.length, bars));
          for (const v of out) expect(v >= 0 && v <= 1).toBe(true);
          const clampedMax = Math.max(...peaks.map((p) => Math.min(1, Math.max(0, p))));
          expect(Math.max(...out)).toBe(clampedMax);
        },
      ),
    );
  });
});
