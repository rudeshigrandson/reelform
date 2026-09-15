import {
  browserCreateAudioContext,
  browserGetUserMedia,
  createMicMeter,
  rafScheduler,
} from "../../recording";
import type { LauncherDefaults } from "../../launcher/types";
import type { Platform } from "../../recording/constraints";
import { isBridged } from "../ipc";
import type { MicLevelHandlers, PreRecordDeps } from "./PreRecordContainer";
import { createIpcHudWindowsPort, createIpcRecordingPort } from "./port";

/**
 * Real pre-record HUD deps inside Electron: sources over `recording:listSources`,
 * devices from `enumerateDevices`, a live `getUserMedia` + AnalyserNode meter,
 * and the HUD window port. Untested by design (thin browser binding).
 */

function platformFromUserAgent(ua: string): Platform {
  if (/Mac/i.test(ua)) return "darwin";
  if (/Win/i.test(ua)) return "win32";
  return "linux";
}

export async function openBrowserMicLevel(
  deviceId: string,
  handlers: MicLevelHandlers,
): Promise<() => void> {
  const stream = await browserGetUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : {},
    video: false,
  });
  const stopTracks = () => {
    for (const t of stream.getTracks()) t.stop();
  };
  let meter: ReturnType<typeof createMicMeter>;
  try {
    meter = createMicMeter({
      stream,
      createAudioContext: browserCreateAudioContext,
      schedule: rafScheduler,
      onLevel: handlers.onLevel,
    });
  } catch (err) {
    stopTracks();
    throw err;
  }
  const offEnded = stream.getAudioTracks()[0]?.onEnded(handlers.onEnded);
  return () => {
    offEnded?.();
    void meter.stop().catch(() => {});
    stopTracks();
  };
}

/**
 * Deps for the HUD window, or null outside Electron (no pre-record pill).
 * `defaults`: initial choices from Settings (see `launcherDefaultsFromSettings`).
 */
export function createBrowserPreRecordDeps(
  defaults?: LauncherDefaults | undefined,
): PreRecordDeps | null {
  if (!isBridged() || typeof navigator === "undefined") return null;
  const port = createIpcRecordingPort();
  return {
    listSources: () => port.listSources(),
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    openMicLevel: openBrowserMicLevel,
    windows: createIpcHudWindowsPort(),
    platform: platformFromUserAgent(navigator.userAgent),
    ...(defaults ? { defaults } : {}),
  };
}
