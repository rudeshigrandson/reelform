import { RNNOISE_PROCESSOR_NAME, RNNOISE_SAMPLE_RATE, RnnoiseFramer } from "./framer";
import { type RnnoiseDenoiser, createRnnoiseDenoiser } from "./rnnoiseWasm";

/**
 * RNNoise AudioWorkletProcessor (ENGINEERING_SPEC §9.5): mono in → mono out
 * at 48 kHz, 480-sample frames with a fixed 10 ms latency. Loaded with
 * `audioWorklet.addModule` by `createNoiseReductionFactory` into both the
 * preview AudioContext and export's OfflineAudioContext; the wasm bytes
 * arrive in `processorOptions.wasmBytes`. If RNNoise can't start (bad bytes,
 * wrong sample rate) the processor passes audio through unchanged.
 */

// AudioWorkletGlobalScope isn't part of lib.dom; declare what this module uses.
declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new (options: { processorOptions?: unknown }) => AudioWorkletProcessor,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  private denoiser: RnnoiseDenoiser | null = null;
  private framer: RnnoiseFramer | null = null;

  constructor(options: { processorOptions?: unknown }) {
    super(options);
    const bytes = (options.processorOptions as { wasmBytes?: ArrayBuffer } | undefined)?.wasmBytes;
    if (!bytes || sampleRate !== RNNOISE_SAMPLE_RATE) {
      this.port.postMessage({ kind: "passthrough", reason: bytes ? "sample-rate" : "no-wasm" });
      return;
    }
    try {
      const denoiser = createRnnoiseDenoiser(bytes);
      this.denoiser = denoiser;
      this.framer = new RnnoiseFramer(denoiser.denoise);
      this.port.postMessage({ kind: "ready" });
    } catch (err) {
      this.port.postMessage({
        kind: "passthrough",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    this.port.onmessage = (event: MessageEvent<{ kind?: string }>) => {
      if (event.data?.kind === "dispose") {
        this.denoiser?.destroy();
        this.denoiser = null;
        this.framer = null;
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const input = inputs[0]?.[0];
    if (!this.framer) {
      if (input) out.set(input.subarray(0, out.length));
      else out.fill(0);
      return true;
    }
    // A disconnected input still has to advance the frame clock.
    this.framer.process(input ?? new Float32Array(out.length), out);
    return true;
  }
}

registerProcessor(RNNOISE_PROCESSOR_NAME, RnnoiseProcessor);
