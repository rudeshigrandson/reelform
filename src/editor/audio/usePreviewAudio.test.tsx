import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlaybackStore } from "../playback";
import { initialEditorData } from "../store";
import { useLoudnessStore } from "./loudnessStore";
import type { PreviewAudioArgs, PreviewAudioPlayer } from "./previewPlayer";
import { usePreviewAudio } from "./usePreviewAudio";

function fakePlayer() {
  return {
    setArgs: vi.fn(),
    setLoudness: vi.fn(),
    setNoiseReduction: vi.fn(),
    sync: vi.fn(),
    graph: vi.fn(() => null),
    idle: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } satisfies PreviewAudioPlayer;
}

const args = (durationMs = 10_000): PreviewAudioArgs => ({
  micUrl: "mic.m4a",
  systemAudioUrl: null,
  mediaBaseUrl: null,
  audio: initialEditorData().audio,
  clickSound: { type: "none", volume: 60, customSound: null },
  telemetry: null,
  clips: [],
  speeds: [],
  durationMs,
});

afterEach(() => {
  usePlaybackStore.getState().reset();
  useLoudnessStore.getState().clear();
});

describe("usePreviewAudio", () => {
  it("follows play / seek / pause / shuttle and disposes on unmount", () => {
    usePlaybackStore.getState().setDuration(10_000);
    const player = fakePlayer();
    const { unmount } = renderHook(() => usePreviewAudio(args(), { createPlayer: () => player }));
    expect(player.setArgs).toHaveBeenCalled();
    expect(player.sync).toHaveBeenLastCalledWith({ isPlaying: false, currentMs: 0, rate: 1 });

    act(() => usePlaybackStore.getState().seek(2000));
    expect(player.sync).toHaveBeenLastCalledWith({ isPlaying: false, currentMs: 2000, rate: 1 });
    act(() => usePlaybackStore.getState().play());
    expect(player.sync).toHaveBeenLastCalledWith({ isPlaying: true, currentMs: 2000, rate: 1 });
    act(() => usePlaybackStore.getState().shuttleForward());
    expect(player.sync).toHaveBeenLastCalledWith({ isPlaying: true, currentMs: 2000, rate: 2 });
    act(() => usePlaybackStore.getState().pause());
    expect(player.sync).toHaveBeenLastCalledWith({ isPlaying: false, currentMs: 2000, rate: 1 });

    const calls = player.sync.mock.calls.length;
    act(() => usePlaybackStore.getState().setLoop(true));
    expect(player.sync.mock.calls.length).toBe(calls);

    unmount();
    expect(player.dispose).toHaveBeenCalledTimes(1);
    act(() => usePlaybackStore.getState().play());
    expect(player.sync.mock.calls.length).toBe(calls);
  });

  it("pushes new args, measured loudness and the noise reduction processor", () => {
    const player = fakePlayer();
    const nr = vi.fn();
    const { rerender } = renderHook(
      ({ a, noiseReduction }) => usePreviewAudio(a, { createPlayer: () => player, noiseReduction }),
      { initialProps: { a: args(), noiseReduction: null as typeof nr | null } },
    );
    const next = args(20_000);
    rerender({ a: next, noiseReduction: nr });
    expect(player.setArgs).toHaveBeenLastCalledWith(next);
    expect(player.setNoiseReduction).toHaveBeenLastCalledWith(nr);
    act(() => useLoudnessStore.getState().setLufs("mic", -23));
    expect(player.setLoudness).toHaveBeenLastCalledWith({ mic: -23 });
  });
});
