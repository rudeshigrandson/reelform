import type {
  AudioBufferLike,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  CompressorLike,
  GainNodeLike,
} from "./graph";
import type { OfflineAudioContextLike } from "./render";

/** Recording fake Web Audio context for tests (no audio processing). */

export interface FakeParam extends AudioParamLike {
  events: Array<
    | { type: "set"; value: number; time: number }
    | { type: "curve"; values: Float32Array; time: number; duration: number }
  >;
}

export interface FakeNode extends AudioNodeLike {
  kind: string;
  label: string;
  outputs: FakeNode[];
}

export function fakeParam(value = 0): FakeParam {
  const p: FakeParam = {
    value,
    events: [],
    setValueAtTime(v, time) {
      p.events.push({ type: "set", value: v, time });
    },
    setValueCurveAtTime(values, time, duration) {
      p.events.push({ type: "curve", values, time, duration });
    },
  };
  return p;
}

export function fakeBuffer(durationS: number, sampleRate = 48_000, channels = 2): AudioBufferLike {
  const length = Math.round(durationS * sampleRate);
  return {
    duration: durationS,
    length,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: () => new Float32Array(length),
  };
}

export type FakeSource = FakeNode &
  BufferSourceLike & {
    starts: Array<{ when: number; offset: number; duration: number }>;
    stopped: boolean;
  };

export interface FakeContext extends OfflineAudioContextLike {
  nodes: FakeNode[];
  destination: FakeNode;
  gains(): Array<FakeNode & GainNodeLike & { gain: FakeParam }>;
  bufferSources(): FakeSource[];
}

/** Constructor form of {@link createFakeContext} (`new FakeAudioContext(48_000)`). */
export type FakeAudioContext = FakeContext & {
  createBuffer(channels: number, length: number, rate: number): AudioBufferLike;
};

type FakeContextOptions = Parameters<typeof createFakeContext>[1];

export const FakeAudioContext = function FakeAudioContext(
  sampleRate = 48_000,
  opts: FakeContextOptions = {},
): FakeAudioContext {
  return Object.assign(createFakeContext(sampleRate, opts), {
    createBuffer: (channels: number, length: number, rate: number) =>
      fakeBuffer(length / rate, rate, channels),
  });
} as unknown as new (
  sampleRate?: number,
  opts?: FakeContextOptions,
) => FakeAudioContext;

export function createFakeContext(
  sampleRate = 48_000,
  opts: { length?: number; channels?: number; fill?: (frame: number) => number } = {},
): FakeContext {
  const nodes: FakeNode[] = [];
  let seq = 0;
  const node = <T extends object>(kind: string, extra: T): FakeNode & T => {
    const n = {
      kind,
      label: `${kind}#${seq++}`,
      outputs: [] as FakeNode[],
      connect(dest: AudioNodeLike) {
        n.outputs.push(dest as FakeNode);
        return dest;
      },
      disconnect() {
        n.outputs.length = 0;
      },
      ...extra,
    };
    nodes.push(n);
    return n;
  };
  const destination = node("destination", {});
  const ctx: FakeContext = {
    sampleRate,
    nodes,
    destination,
    createGain: () => node("gain", { gain: fakeParam(1) }),
    createBufferSource: (): FakeSource => {
      const starts: Array<{ when: number; offset: number; duration: number }> = [];
      const extra = {
        buffer: null as AudioBufferLike | null,
        loop: false as boolean,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: fakeParam(1),
        starts,
        stopped: false,
        start(when = 0, offset = 0, duration = Number.POSITIVE_INFINITY) {
          starts.push({ when, offset, duration });
        },
        stop(this: { stopped: boolean }) {
          this.stopped = true;
        },
      };
      return node("source", extra);
    },
    createDynamicsCompressor: (): FakeNode & CompressorLike =>
      node("compressor", {
        threshold: fakeParam(-24),
        knee: fakeParam(30),
        ratio: fakeParam(12),
        attack: fakeParam(0.003),
        release: fakeParam(0.25),
      }),
    gains: () => nodes.filter((n) => n.kind === "gain") as ReturnType<FakeContext["gains"]>,
    bufferSources: () => nodes.filter((n) => n.kind === "source") as FakeSource[],
    startRendering: async () => {
      const length = opts.length ?? 0;
      const channels = opts.channels ?? 2;
      const data = Array.from({ length: channels }, (_, c) => {
        const a = new Float32Array(length);
        if (opts.fill) for (let i = 0; i < length; i++) a[i] = opts.fill(i) + c;
        return a;
      });
      return {
        duration: length / sampleRate,
        length,
        sampleRate,
        numberOfChannels: channels,
        getChannelData: (c: number) => data[c] as Float32Array,
      };
    },
  };
  return ctx;
}
