import type {
  AnalyserNodeLike,
  AudioContextLike,
  BlobLike,
  MediaConstraintsLike,
  MediaRecorderEvents,
  MediaRecorderLike,
  MediaRecorderOptionsLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RecorderState,
} from "./media";
import type { EndTrackRequest, RecordingEvent, RecordingPort, WriteChunkRequest } from "./port";

/** Test doubles for the media APIs (imported by *.test.ts only). */

export class FakeTrack implements MediaStreamTrackLike {
  stopped = false;
  enabled = true;
  private listeners = new Set<() => void>();
  constructor(readonly kind: string) {}
  stop(): void {
    this.stopped = true;
  }
  onEnded(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  end(): void {
    for (const l of this.listeners) l();
  }
}

export class FakeStream implements MediaStreamLike {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
}

export function fakeBlob(bytes: number[] | number): BlobLike {
  const arr = typeof bytes === "number" ? new Array<number>(bytes).fill(1) : bytes;
  return {
    size: arr.length,
    arrayBuffer: async () => new Uint8Array(arr).buffer,
  };
}

export class FakeRecorder implements MediaRecorderLike {
  state: RecorderState = "inactive";
  timeslice: number | undefined;
  /** When false, stop() waits for `finishStop()`. */
  autoStop = true;
  constructor(
    readonly stream: MediaStreamLike,
    readonly options: MediaRecorderOptionsLike,
    readonly events: MediaRecorderEvents,
  ) {}
  start(timesliceMs: number): void {
    this.state = "recording";
    this.timeslice = timesliceMs;
  }
  pause(): void {
    this.state = "paused";
  }
  resume(): void {
    this.state = "recording";
  }
  stop(): void {
    if (this.autoStop) this.finishStop();
  }
  finishStop(finalChunk?: BlobLike): void {
    if (finalChunk) this.events.onData(finalChunk);
    this.state = "inactive";
    this.events.onStop();
  }
  emit(blob: BlobLike): void {
    this.events.onData(blob);
  }
}

export class FakeAnalyser implements AnalyserNodeLike {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  value = 0;
  getFloatTimeDomainData(target: Float32Array): void {
    target.fill(this.value);
  }
}

export class FakeAudioContext implements AudioContextLike {
  analyser = new FakeAnalyser();
  closed = false;
  connected = false;
  disconnected = false;
  createMediaStreamSource() {
    return {
      connect: () => {
        this.connected = true;
      },
      disconnect: () => {
        this.disconnected = true;
      },
    };
  }
  createAnalyser(): FakeAnalyser {
    return this.analyser;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Manual frame scheduler: `run()` fires the pending callbacks once. */
export class ManualScheduler {
  private queue: (() => void)[] = [];
  schedule = (cb: () => void): (() => void) => {
    this.queue.push(cb);
    return () => {
      this.queue = this.queue.filter((c) => c !== cb);
    };
  };
  run(times = 1): void {
    for (let i = 0; i < times; i++) {
      const q = this.queue;
      this.queue = [];
      for (const cb of q) cb();
    }
  }
  get size(): number {
    return this.queue.length;
  }
}

export class FakePort implements RecordingPort {
  writes: WriteChunkRequest[] = [];
  ended: EndTrackRequest[] = [];
  calls: string[] = [];
  listeners = new Set<(e: RecordingEvent) => void>();
  writeImpl: (req: WriteChunkRequest) => Promise<void> = async () => {};
  failNext: string | null = null;

  private call(name: string, id: string): Promise<void> {
    this.calls.push(`${name}:${id}`);
    if (this.failNext === name) {
      this.failNext = null;
      return Promise.reject({ code: `${name}-failed`, message: `${name} failed` });
    }
    return Promise.resolve();
  }
  pause(id: string) {
    return this.call("pause", id);
  }
  resume(id: string) {
    return this.call("resume", id);
  }
  stop(id: string) {
    return this.call("stop", id);
  }
  discard(id: string) {
    return this.call("discard", id);
  }
  async writeChunk(req: WriteChunkRequest): Promise<void> {
    await this.writeImpl(req);
    this.writes.push(req);
  }
  async endTrack(req: EndTrackRequest): Promise<void> {
    this.ended.push(req);
  }
  subscribe(listener: (e: RecordingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(e: RecordingEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export interface FakeMediaEnv {
  requests: MediaConstraintsLike[];
  recorders: FakeRecorder[];
  streams: FakeStream[];
  getUserMedia: (c: MediaConstraintsLike) => Promise<FakeStream>;
  createRecorder: (
    s: MediaStreamLike,
    o: MediaRecorderOptionsLike,
    e: MediaRecorderEvents,
  ) => FakeRecorder;
  createStream: (tracks: MediaStreamTrackLike[]) => FakeStream;
  /** Throw for requests matching this predicate. */
  failWhen: ((c: MediaConstraintsLike) => boolean) | null;
}

export function fakeMediaEnv(): FakeMediaEnv {
  const env: FakeMediaEnv = {
    requests: [],
    recorders: [],
    streams: [],
    failWhen: null,
    getUserMedia: async (c) => {
      env.requests.push(c);
      if (env.failWhen?.(c)) {
        throw { name: "NotAllowedError", message: "Permission denied" };
      }
      const tracks: FakeTrack[] = [];
      if (c.video) tracks.push(new FakeTrack("video"));
      if (c.audio) tracks.push(new FakeTrack("audio"));
      const s = new FakeStream(tracks);
      env.streams.push(s);
      return s;
    },
    createRecorder: (s, o, e) => {
      const r = new FakeRecorder(s, o, e);
      env.recorders.push(r);
      return r;
    },
    createStream: (tracks) => new FakeStream(tracks as FakeTrack[]),
  };
  return env;
}

/** Let queued promise continuations run. */
export async function drain(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
