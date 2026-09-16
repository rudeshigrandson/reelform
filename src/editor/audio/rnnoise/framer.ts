/**
 * Render-quantum ↔ RNNoise frame adapter (ENGINEERING_SPEC §9.5). Web Audio
 * delivers 128-sample quanta; RNNoise denoises 480-sample frames (10 ms at
 * 48 kHz) of int16-range floats. Input accumulates into a frame; each full
 * frame is scaled, denoised in place, scaled back and queued. The output FIFO
 * starts with one frame of silence, so there is always a sample to emit and
 * the processor adds a fixed 480-sample (10 ms) latency.
 */

/** `registerProcessor` name of the RNNoise worklet. */
export const RNNOISE_PROCESSOR_NAME = "reelform-rnnoise";
export const RNNOISE_FRAME_SIZE = 480;
export const RNNOISE_SAMPLE_RATE = 48_000;
/** RNNoise works on int16-range sample values. */
export const RNNOISE_PCM_SCALE = 32_768;

/** Denoise one 480-sample frame in place (int16-range floats); returns the voice probability. */
export type DenoiseFrame = (frame: Float32Array) => number;

export class RnnoiseFramer {
  private readonly frame = new Float32Array(RNNOISE_FRAME_SIZE);
  private fill = 0;
  /** Ring buffer: one frame of prefill + one frame + one quantum of headroom. */
  private readonly queue = new Float32Array(RNNOISE_FRAME_SIZE * 4);
  private head = 0;
  private size = RNNOISE_FRAME_SIZE;
  /** Voice probability of the most recent frame. */
  lastVad = 0;

  constructor(private readonly denoise: DenoiseFrame) {}

  get latencySamples(): number {
    return RNNOISE_FRAME_SIZE;
  }

  /** Consume `input` and write the same number of samples to `output`. */
  process(input: Float32Array, output: Float32Array): void {
    const n = Math.min(input.length, output.length);
    const cap = this.queue.length;
    for (let i = 0; i < n; i++) {
      const x = input[i] as number;
      this.frame[this.fill++] = (Number.isFinite(x) ? x : 0) * RNNOISE_PCM_SCALE;
      if (this.fill === RNNOISE_FRAME_SIZE) {
        this.fill = 0;
        this.lastVad = this.denoise(this.frame);
        for (let k = 0; k < RNNOISE_FRAME_SIZE; k++) {
          this.queue[(this.head + this.size) % cap] = (this.frame[k] as number) / RNNOISE_PCM_SCALE;
          this.size++;
        }
      }
      // The prefill guarantees size ≥ 1 here: every 480 inputs add 480 outputs.
      output[i] = this.queue[this.head] as number;
      this.head = (this.head + 1) % cap;
      this.size--;
    }
  }
}
