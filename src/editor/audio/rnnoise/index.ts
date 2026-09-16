import type { AudioContextLike, AudioNodeLike, ProcessorFactory, ProcessorSlot } from "../graph";
import { RNNOISE_PROCESSOR_NAME, RNNOISE_SAMPLE_RATE } from "./framer";

/**
 * RNNoise noise reduction for the mic track (ENGINEERING_SPEC §9.5) as an
 * `AudioWorklet`. The same factory serves the live preview `AudioContext` and
 * export's `OfflineAudioContext`:
 *
 *   const nr = createNoiseReductionFactory();
 *   await nr.prepare(ctx);                       // addModule + wasm, once per context
 *   buildAudioGraph({ ctx, …, processors: { noiseReduction: nr } });
 *
 * `ProcessorFactory` is synchronous, so the worklet module must be loaded
 * before the graph builds. When it isn't (no AudioWorklet support, load
 * failure, or a context not at 48 kHz, RNNoise's only rate) the factory
 * returns a unity-gain pass-through so the graph still renders.
 */

export { RNNOISE_FRAME_SIZE, RNNOISE_PROCESSOR_NAME, RNNOISE_SAMPLE_RATE } from "./framer";

/** `processorOptions` the worklet receives. */
export interface RnnoiseProcessorOptions {
  /** RNNoise wasm binary, compiled inside the worklet. */
  wasmBytes: ArrayBuffer;
}

interface AudioWorkletLike {
  addModule(url: string): Promise<void>;
}

type ContextWithWorklet = AudioContextLike & { audioWorklet?: AudioWorkletLike | undefined };

export interface NoiseReductionDeps {
  /** URL of the bundled worklet module. */
  workletUrl?: (() => Promise<string>) | undefined;
  /** RNNoise wasm bytes. */
  loadWasm?: (() => Promise<ArrayBuffer>) | undefined;
  /** Constructs the worklet node (defaults to `new AudioWorkletNode`). */
  createNode?:
    | ((ctx: AudioContextLike, name: string, options: RnnoiseProcessorOptions) => AudioNodeLike)
    | undefined;
}

export interface NoiseReductionFactory extends ProcessorFactory {
  /** Load the worklet module into `ctx`; resolves true when RNNoise will run there. */
  prepare(ctx: AudioContextLike): Promise<boolean>;
  /** True once `prepare(ctx)` succeeded and the context runs at 48 kHz. */
  isReady(ctx: AudioContextLike): boolean;
}

async function defaultWorkletUrl(): Promise<string> {
  return (await import("./assets")).RNNOISE_WORKLET_URL;
}

async function defaultLoadWasm(): Promise<ArrayBuffer> {
  const { RNNOISE_WASM_URL } = await import("./assets");
  const res = await fetch(RNNOISE_WASM_URL);
  if (!res.ok) throw new Error(`RNNoise wasm failed to load (HTTP ${res.status})`);
  return res.arrayBuffer();
}

function defaultCreateNode(
  ctx: AudioContextLike,
  name: string,
  options: RnnoiseProcessorOptions,
): AudioNodeLike {
  // Mono in/out: RNNoise has one state per stream; the graph up-mixes the result.
  return new AudioWorkletNode(ctx as unknown as BaseAudioContext, name, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    outputChannelCount: [1],
    processorOptions: options,
  });
}

function passThrough(ctx: AudioContextLike): ProcessorSlot {
  const gain = ctx.createGain();
  gain.gain.value = 1;
  return { input: gain, output: gain };
}

export function createNoiseReductionFactory(deps: NoiseReductionDeps = {}): NoiseReductionFactory {
  const workletUrl = deps.workletUrl ?? defaultWorkletUrl;
  const loadWasm = deps.loadWasm ?? defaultLoadWasm;
  const createNode = deps.createNode ?? defaultCreateNode;
  const prepared = new WeakMap<AudioContextLike, Promise<boolean>>();
  const ready = new WeakSet<AudioContextLike>();
  let wasm: Promise<ArrayBuffer> | null = null;
  let wasmBytes: ArrayBuffer | null = null;

  const isReady = (ctx: AudioContextLike): boolean =>
    ready.has(ctx) && wasmBytes !== null && ctx.sampleRate === RNNOISE_SAMPLE_RATE;

  const factory = ((ctx: AudioContextLike): ProcessorSlot => {
    if (!isReady(ctx) || !wasmBytes) return passThrough(ctx);
    try {
      const node = createNode(ctx, RNNOISE_PROCESSOR_NAME, { wasmBytes: wasmBytes.slice(0) });
      return { input: node, output: node };
    } catch {
      return passThrough(ctx);
    }
  }) as NoiseReductionFactory;

  factory.isReady = isReady;
  factory.prepare = (ctx) => {
    let p = prepared.get(ctx);
    if (p) return p;
    p = (async () => {
      const worklet = (ctx as ContextWithWorklet).audioWorklet;
      if (!worklet || ctx.sampleRate !== RNNOISE_SAMPLE_RATE) return false;
      try {
        wasm ??= loadWasm();
        const [bytes, url] = await Promise.all([wasm, workletUrl()]);
        await worklet.addModule(url);
        wasmBytes = bytes;
        ready.add(ctx);
        return true;
      } catch {
        // A failed wasm load may succeed on a later context.
        wasm = null;
        return false;
      }
    })();
    prepared.set(ctx, p);
    return p;
  };
  return factory;
}
