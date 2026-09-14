import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";
import type { MediaProbe } from "./contracts";

/**
 * Production `probe` for `project:relink`: container duration + primary video
 * track display size via mediabunny's Node file source. Audio-only files
 * report `null` dimensions.
 */
export async function probeMediaFile(absPath: string): Promise<MediaProbe> {
  const input = new Input({ source: new FilePathSource(absPath), formats: ALL_FORMATS });
  try {
    const durationSec = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    return {
      durationMs: durationSec * 1000,
      width: video ? video.displayWidth : null,
      height: video ? video.displayHeight : null,
    };
  } finally {
    input.dispose();
  }
}
