import {
  ALL_FORMATS,
  type EncodedPacket,
  EncodedPacketSink,
  Input,
  type InputVideoTrack,
  type Source,
} from "mediabunny";
import type { SourcePacket, VideoPacketSource } from "./streamingDecoder";

/** mediabunny demux → `VideoPacketSource` for the StreamingDecoder (§10.2). */

class MediabunnyPacket implements SourcePacket {
  constructor(readonly packet: EncodedPacket) {}
  get timestampUs(): number {
    return this.packet.microsecondTimestamp;
  }
  get key(): boolean {
    return this.packet.type === "key";
  }
  toChunk(): EncodedVideoChunk {
    return this.packet.toEncodedVideoChunk();
  }
}

export function createTrackPacketSource(track: InputVideoTrack): VideoPacketSource {
  const sink = new EncodedPacketSink(track);
  const wrap = (p: EncodedPacket | null): SourcePacket | null =>
    p ? new MediabunnyPacket(p) : null;
  return {
    async decoderConfig() {
      const config = await track.getDecoderConfig();
      if (!config) throw new Error("source video codec cannot be decoded");
      return config;
    },
    async keyPacketAt(timestampUs) {
      const key = await sink.getKeyPacket(timestampUs / 1e6, { verifyKeyPackets: true });
      return wrap(key ?? (await sink.getFirstPacket()));
    },
    async next(packet) {
      if (!(packet instanceof MediabunnyPacket)) throw new TypeError("foreign packet");
      return wrap(await sink.getNextPacket(packet.packet));
    },
  };
}

export interface OpenedVideoSource {
  packets: VideoPacketSource;
  track: InputVideoTrack;
  dispose(): void;
}

/** Open the primary video track of a media source (Blob / buffer / stream). */
export async function openVideoSource(source: Source): Promise<OpenedVideoSource> {
  const input = new Input({ formats: ALL_FORMATS, source });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error("source has no video track");
  }
  return { packets: createTrackPacketSource(track), track, dispose: () => input.dispose() };
}
