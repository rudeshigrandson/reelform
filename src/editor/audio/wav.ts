/**
 * PCM16 little-endian WAV encoder for the audio fallback path (ENGINEERING_SPEC
 * §10.1: "else PCM WAV then ffmpeg AAC"). Channels are interleaved; samples are
 * clamped to [−1, 1] and scaled asymmetrically (−1 → −32768, +1 → 32767).
 */

export const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWavPcm16(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  if (channelCount === 0) throw new Error("encodeWavPcm16: no channels");
  if (!(sampleRate > 0) || !Number.isInteger(sampleRate)) {
    throw new Error("encodeWavPcm16: sampleRate must be a positive integer");
  }
  const frames = Math.min(...channels.map((c) => c.length));
  const blockAlign = channelCount * 2;
  const dataBytes = frames * blockAlign;
  const buf = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buf);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let o = WAV_HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const raw = (channels[c] as Float32Array)[i] as number;
      const s = Number.isNaN(raw) ? 0 : Math.max(-1, Math.min(1, raw));
      view.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
