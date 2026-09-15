import { describe, expect, it } from "vitest";
import { micDuckEnvelope, outputEnvelope, sourceRmsEnvelope } from "./envelope";
import type { AudioBufferLike } from "./graph";

function buffer(channels: Float32Array[], sampleRate = 1000): AudioBufferLike {
  const length = channels[0]?.length ?? 0;
  return {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (c) => channels[c] as Float32Array,
  };
}

describe("sourceRmsEnvelope", () => {
  it("averages channel energy per window", () => {
    const loud = new Float32Array(20).fill(1);
    const silent = new Float32Array(20);
    const env = sourceRmsEnvelope(buffer([loud, silent]));
    expect(env.sampleRateHz).toBe(100);
    expect(env.envelopeDb).toHaveLength(2);
    // Half the energy → −3 dB.
    expect(env.envelopeDb[0]).toBeCloseTo(-3.0103, 3);
    expect(sourceRmsEnvelope(buffer([new Float32Array(20)])).envelopeDb[0]).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("outputEnvelope", () => {
  const source = { envelopeDb: [0, -10, -20, -30, -40, -50], sampleRateHz: 100 };

  it("follows clips (trims) onto output time", () => {
    const env = outputEnvelope(
      source,
      [{ id: "c", sourceStartMs: 20, sourceEndMs: 50, timelineStartMs: 0 }],
      [],
    );
    expect(env.envelopeDb).toEqual([-20, -30, -40]);
  });

  it("follows speed regions", () => {
    const env = outputEnvelope(
      source,
      [{ id: "c", sourceStartMs: 0, sourceEndMs: 60, timelineStartMs: 0 }],
      [{ startMs: 0, endMs: 60, rate: 2 }],
    );
    expect(env.envelopeDb).toEqual([-10, -30, -50]);
  });
});

describe("micDuckEnvelope", () => {
  it("is only computed when a region ducks", () => {
    const mic = buffer([new Float32Array(40).fill(0.5)]);
    const off = [{ duck: { enabled: false, amountDb: 12 } }];
    const on = [{ duck: { enabled: true, amountDb: 12 } }];
    expect(micDuckEnvelope(mic, off, [])).toBeUndefined();
    expect(micDuckEnvelope(undefined, on, [])).toBeUndefined();
    const env = micDuckEnvelope(mic, on, []);
    expect(env?.envelopeDb).toHaveLength(4);
    expect(env?.envelopeDb[0]).toBeCloseTo(-6.02, 2);
  });
});
