/**
 * Minimal structural views of the browser media APIs used by the Electron
 * capture backend (ENGINEERING_SPEC §5.2). Logic depends on these instead of
 * the DOM globals so tests run in node with fake classes; `browserAdapter.ts`
 * maps the real APIs onto them.
 */

export type RecorderState = "inactive" | "recording" | "paused";

export interface BlobLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface MediaStreamTrackLike {
  readonly kind: string;
  stop(): void;
  /** Subscribe to the track ending (device unplugged, source closed). Returns an unsubscribe. */
  onEnded(listener: () => void): () => void;
}

export interface MediaStreamLike {
  getTracks(): MediaStreamTrackLike[];
  getAudioTracks(): MediaStreamTrackLike[];
  getVideoTracks(): MediaStreamTrackLike[];
}

export interface MediaRecorderOptionsLike {
  mimeType?: string | undefined;
  videoBitsPerSecond?: number | undefined;
  audioBitsPerSecond?: number | undefined;
}

export interface MediaRecorderEvents {
  onData: (data: BlobLike) => void;
  onStop: () => void;
  onError: (error: unknown) => void;
}

export interface MediaRecorderLike {
  readonly state: RecorderState;
  start(timesliceMs: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

/** Creates a recorder bound to `events`; the adapter wires DOM events onto the callbacks. */
export type RecorderFactory = (
  stream: MediaStreamLike,
  options: MediaRecorderOptionsLike,
  events: MediaRecorderEvents,
) => MediaRecorderLike;

/** `getUserMedia` with Electron's legacy `mandatory` desktop constraints allowed. */
export type GetUserMedia = (constraints: MediaConstraintsLike) => Promise<MediaStreamLike>;

/** Build a new stream from a subset of tracks (used to split loopback audio from desktop video). */
export type StreamFactory = (tracks: MediaStreamTrackLike[]) => MediaStreamLike;

export interface AnalyserNodeLike {
  fftSize: number;
  smoothingTimeConstant: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

export interface MediaStreamSourceNodeLike {
  connect(node: AnalyserNodeLike): void;
  disconnect(): void;
}

export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStreamLike): MediaStreamSourceNodeLike;
  createAnalyser(): AnalyserNodeLike;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike;

/** Chromium desktop-capture constraints (`mandatory` block is Electron-specific). */
export interface DesktopMandatory {
  chromeMediaSource: "desktop";
  chromeMediaSourceId: string;
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  minHeight?: number | undefined;
  maxHeight?: number | undefined;
  minFrameRate?: number | undefined;
  maxFrameRate?: number | undefined;
}

export interface DeviceTrackConstraints {
  deviceId?: { exact: string } | undefined;
  width?: { ideal: number } | undefined;
  height?: { ideal: number } | undefined;
  frameRate?: { ideal: number } | undefined;
  echoCancellation?: boolean | undefined;
  noiseSuppression?: boolean | undefined;
  autoGainControl?: boolean | undefined;
  channelCount?: { ideal: number } | undefined;
}

export interface MediaConstraintsLike {
  audio:
    | false
    | { mandatory: { chromeMediaSource: "desktop"; chromeMediaSourceId?: string | undefined } }
    | DeviceTrackConstraints;
  video: false | { mandatory: DesktopMandatory } | DeviceTrackConstraints;
}
