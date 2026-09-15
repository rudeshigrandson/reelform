import type { WebCodecsApi } from "./engine";
import type { CreateVideoDecoder } from "./streamingDecoder";

/**
 * Real WebCodecs globals for the renderer. Untested glue — the engine's tests
 * inject fakes through the same `WebCodecsApi` interface.
 */
export function browserWebCodecs(): WebCodecsApi {
  return {
    isVideoConfigSupported: (c) => VideoEncoder.isConfigSupported(c),
    createVideoEncoder: (init) => new VideoEncoder(init),
    isAudioConfigSupported: (c) => AudioEncoder.isConfigSupported(c),
    createAudioEncoder: (init) => new AudioEncoder(init),
    createVideoFrame: (image, init) => new VideoFrame(image, init),
    createAudioData: (init) => new AudioData(init),
  };
}

export const browserVideoDecoder: CreateVideoDecoder = (init) => new VideoDecoder(init);
