import { DEFAULT_AUDIO_SETTINGS } from "../inspector/audio/types";
import type { AudioSettings } from "../inspector/audio/types";
import { audibility, clickBusGain, masterGain, trackBusGain } from "./mix";

function settings(
  mic: { muted: boolean; solo: boolean },
  system: { muted: boolean; solo: boolean },
  muteAll = false,
): AudioSettings {
  const d = DEFAULT_AUDIO_SETTINGS;
  return {
    ...d,
    tracks: { mic: { ...d.tracks.mic, ...mic }, system: { ...d.tracks.system, ...system } },
    master: { ...d.master, muteAll },
  };
}

const bools = [false, true];

describe("solo / mute truth table", () => {
  // Expected: [micAudible, systemAudible, extrasAudible]
  const cases: Array<[string, boolean, boolean, boolean, boolean, [boolean, boolean, boolean]]> =
    [];
  for (const mm of bools)
    for (const ms of bools)
      for (const sm of bools)
        for (const ss of bools) {
          const anySolo = ms || ss;
          cases.push([
            `mic(m=${mm},s=${ms}) sys(m=${sm},s=${ss})`,
            mm,
            ms,
            sm,
            ss,
            [!mm && (!anySolo || ms), !sm && (!anySolo || ss), !anySolo],
          ]);
        }

  it.each(cases)("%s", (_n, mm, ms, sm, ss, expected) => {
    const a = audibility(settings({ muted: mm, solo: ms }, { muted: sm, solo: ss }));
    expect([a.mic, a.system, a.extras]).toEqual(expected);
  });

  it("explicit rows: solo mic silences system and extras; muted+solo is silent", () => {
    expect(
      audibility(settings({ muted: false, solo: true }, { muted: false, solo: false })),
    ).toEqual({
      mic: true,
      system: false,
      extras: false,
    });
    expect(
      audibility(settings({ muted: true, solo: true }, { muted: false, solo: false })),
    ).toEqual({
      mic: false,
      system: false,
      extras: false,
    });
  });

  it("mute-all silences everything regardless of solo", () => {
    for (const ms of bools) {
      const a = audibility(
        settings({ muted: false, solo: ms }, { muted: false, solo: false }, true),
      );
      expect(a).toEqual({ mic: false, system: false, extras: false });
    }
  });

  it("solo on an unavailable track is ignored", () => {
    const a = audibility(settings({ muted: false, solo: false }, { muted: false, solo: true }), {
      mic: true,
      system: false,
    });
    expect(a).toEqual({ mic: true, system: false, extras: true });
  });
});

describe("bus gains", () => {
  it("track, master and click gains", () => {
    const s = { ...DEFAULT_AUDIO_SETTINGS, clickVolume: 150 };
    expect(trackBusGain(s, "mic")).toBe(1);
    expect(masterGain({ ...s, master: { volumeDb: -6, muteAll: false } })).toBeCloseTo(0.501, 3);
    expect(masterGain({ ...s, master: { volumeDb: 0, muteAll: true } })).toBe(0);
    expect(clickBusGain(s)).toBe(1);
    expect(clickBusGain({ ...s, clickVolume: Number.NaN })).toBe(0);
    const soloed = settings({ muted: false, solo: true }, { muted: false, solo: false });
    expect(clickBusGain(soloed)).toBe(0);
    expect(trackBusGain(soloed, "system")).toBe(0);
    expect(
      trackBusGain(
        {
          ...s,
          tracks: { ...s.tracks, mic: { ...s.tracks.mic, volumeDb: Number.NEGATIVE_INFINITY } },
        },
        "mic",
      ),
    ).toBe(0);
  });
});
