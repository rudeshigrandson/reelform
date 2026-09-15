import { useEffect, useRef } from "react";
import { usePlaybackStore } from "../playback";
import type { PlaybackState } from "../playback";
import type { ProcessorFactory } from "./graph";
import { useLoudnessStore } from "./loudnessStore";
import {
  type PreviewAudioArgs,
  type PreviewAudioPlayer,
  browserPreviewAudioDeps,
  createPreviewAudioPlayer,
} from "./previewPlayer";
import { createNoiseReductionFactory } from "./rnnoise";

/**
 * Editor preview audio (ENGINEERING_SPEC §6.3, §9.5). Mount once per editor
 * window with values from the project session + document; the hook owns a
 * {@link PreviewAudioPlayer}, follows the playback store (play / seek / pause /
 * shuttle) and the measured loudness, and disposes the AudioContext on unmount.
 */

let sharedNoiseReduction: ProcessorFactory | null = null;

/** One RNNoise factory per window: the wasm is fetched once and shared by preview and export. */
export function defaultNoiseReduction(): ProcessorFactory {
  sharedNoiseReduction ??= createNoiseReductionFactory();
  return sharedNoiseReduction;
}

export interface UsePreviewAudioOptions {
  /**
   * Mic noise reduction processor; defaults to the shared RNNoise worklet
   * factory. Pass null to play the mic unprocessed.
   */
  noiseReduction?: ProcessorFactory | null | undefined;
  /** Player factory override (tests). */
  createPlayer?: (() => PreviewAudioPlayer) | undefined;
}

const transportOf = (s: Pick<PlaybackState, "isPlaying" | "currentMs" | "shuttleRate">) => ({
  isPlaying: s.isPlaying,
  currentMs: s.currentMs,
  rate: s.shuttleRate > 0 ? s.shuttleRate : 1,
});

export function usePreviewAudio(
  args: PreviewAudioArgs,
  options: UsePreviewAudioOptions = {},
): void {
  const playerRef = useRef<PreviewAudioPlayer | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const noiseReduction =
    options.noiseReduction === undefined ? defaultNoiseReduction() : options.noiseReduction;
  const nrRef = useRef(noiseReduction);
  nrRef.current = noiseReduction;
  const createRef = useRef(options.createPlayer);
  createRef.current = options.createPlayer;

  useEffect(() => {
    const player =
      createRef.current?.() ??
      createPreviewAudioPlayer({ ...browserPreviewAudioDeps(), noiseReduction: nrRef.current });
    playerRef.current = player;
    player.setNoiseReduction(nrRef.current);
    player.setArgs(argsRef.current);
    player.setLoudness(useLoudnessStore.getState().lufs);
    player.sync(transportOf(usePlaybackStore.getState()));
    const offPlayback = usePlaybackStore.subscribe((s, prev) => {
      if (
        s.isPlaying !== prev.isPlaying ||
        s.currentMs !== prev.currentMs ||
        s.shuttleRate !== prev.shuttleRate
      ) {
        player.sync(transportOf(s));
      }
    });
    const offLoudness = useLoudnessStore.subscribe((s) => player.setLoudness(s.lufs));
    return () => {
      offPlayback();
      offLoudness();
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setArgs(args);
  });

  useEffect(() => {
    playerRef.current?.setNoiseReduction(noiseReduction);
  }, [noiseReduction]);
}
