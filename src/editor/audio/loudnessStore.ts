import { create } from "zustand";

/**
 * Measured integrated loudness per recorded track (ENGINEERING_SPEC §9.5).
 * Filled by the Audio tab when Normalize is first enabled (measured off-thread);
 * the preview player and export read it as `loudnessLufs` for the normalize gain.
 * `-Infinity` means "measured, silent" (normalize applies 0 dB); an absent key
 * means "not measured yet".
 */

export type LoudnessTrack = "mic" | "system";

export interface LoudnessState {
  lufs: Partial<Record<LoudnessTrack, number>>;
  /** Source URL each `lufs` entry was measured from (so a remount doesn't re-measure). */
  sources: Partial<Record<LoudnessTrack, string>>;
  setLufs(track: LoudnessTrack, value: number, sourceUrl?: string | undefined): void;
  /** Drop one track's measurement (its source was replaced or removed). */
  forget(track: LoudnessTrack): void;
  /** Forget every measurement (project closed / sources replaced). */
  clear(): void;
}

export const useLoudnessStore = create<LoudnessState>((set) => ({
  lufs: {},
  sources: {},
  setLufs: (track, value, sourceUrl) =>
    set((s) => {
      const sources = { ...s.sources };
      if (sourceUrl === undefined) delete sources[track];
      else sources[track] = sourceUrl;
      return { lufs: { ...s.lufs, [track]: value }, sources };
    }),
  forget: (track) =>
    set((s) => {
      if (!(track in s.lufs) && !(track in s.sources)) return s;
      const lufs = { ...s.lufs };
      const sources = { ...s.sources };
      delete lufs[track];
      delete sources[track];
      return { lufs, sources };
    }),
  clear: () => set({ lufs: {}, sources: {} }),
}));
