import type {
  AudioContextLike,
  BlobLike,
  MediaStreamLike,
  MediaStreamTrackLike,
  RecorderFactory,
} from "./media";

/**
 * Thin, untested adapter mapping real browser media APIs onto the structural
 * interfaces in `media.ts`. Everything testable lives elsewhere.
 */

const realStreams = new WeakMap<MediaStreamLike, MediaStream>();

function wrapTrack(track: MediaStreamTrack): MediaStreamTrackLike {
  return {
    kind: track.kind,
    get enabled() {
      return track.enabled;
    },
    set enabled(value: boolean | undefined) {
      track.enabled = value !== false;
    },
    stop: () => track.stop(),
    onEnded: (listener) => {
      track.addEventListener("ended", listener);
      return () => track.removeEventListener("ended", listener);
    },
  };
}

const realTracks = new WeakMap<MediaStreamTrackLike, MediaStreamTrack>();

function wrapStream(stream: MediaStream): MediaStreamLike {
  const wrapAll = (tracks: MediaStreamTrack[]): MediaStreamTrackLike[] =>
    tracks.map((t) => {
      const like = wrapTrack(t);
      realTracks.set(like, t);
      return like;
    });
  const like: MediaStreamLike = {
    getTracks: () => wrapAll(stream.getTracks()),
    getAudioTracks: () => wrapAll(stream.getAudioTracks()),
    getVideoTracks: () => wrapAll(stream.getVideoTracks()),
  };
  realStreams.set(like, stream);
  return like;
}

function unwrapStream(like: MediaStreamLike): MediaStream {
  const s = realStreams.get(like);
  if (!s) throw new Error("recording: stream was not created by browserAdapter");
  return s;
}

export function browserGetUserMedia(
  constraints: Parameters<import("./media").GetUserMedia>[0],
): Promise<MediaStreamLike> {
  // Electron's desktop capture uses the non-standard `mandatory` block, which the
  // DOM MediaStreamConstraints type does not model.
  const c = constraints as unknown as MediaStreamConstraints;
  return navigator.mediaDevices.getUserMedia(c).then(wrapStream);
}

export const browserCreateStream = (tracks: MediaStreamTrackLike[]): MediaStreamLike =>
  wrapStream(
    new MediaStream(
      tracks.map((t) => {
        const real = realTracks.get(t);
        if (!real) throw new Error("recording: track was not created by browserAdapter");
        return real;
      }),
    ),
  );

export const browserCreateRecorder: RecorderFactory = (stream, options, events) => {
  const init: MediaRecorderOptions = {};
  if (options.mimeType) init.mimeType = options.mimeType;
  if (options.videoBitsPerSecond) init.videoBitsPerSecond = options.videoBitsPerSecond;
  if (options.audioBitsPerSecond) init.audioBitsPerSecond = options.audioBitsPerSecond;
  const rec = new MediaRecorder(unwrapStream(stream), init);
  rec.addEventListener("dataavailable", (e) => events.onData(e.data as BlobLike));
  rec.addEventListener("stop", () => events.onStop());
  rec.addEventListener("error", (e) => events.onError(e));
  return rec;
};

export const browserIsTypeSupported = (mime: string): boolean =>
  typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime);

export const browserCreateAudioContext = (): AudioContextLike => {
  const ctx = new AudioContext();
  return {
    createMediaStreamSource: (stream) => {
      const node = ctx.createMediaStreamSource(unwrapStream(stream));
      return {
        connect: (analyser) => {
          node.connect(analyser as unknown as AnalyserNode);
        },
        disconnect: () => node.disconnect(),
      };
    },
    // AnalyserNode structurally satisfies AnalyserNodeLike.
    createAnalyser: () => ctx.createAnalyser(),
    close: () => ctx.close(),
  };
};

export const rafScheduler = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(() => cb());
  return () => cancelAnimationFrame(id);
};

/** Real deps for `startCapture`, minus the port and callbacks. */
export function browserCaptureDeps() {
  return {
    getUserMedia: browserGetUserMedia,
    createRecorder: browserCreateRecorder,
    createStream: browserCreateStream,
    isTypeSupported: browserIsTypeSupported,
    now: () => performance.now(),
    timeOrigin: performance.timeOrigin,
    createAudioContext: browserCreateAudioContext,
    scheduleFrame: rafScheduler,
  };
}
