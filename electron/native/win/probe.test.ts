import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  EncoderCaps,
  type HwProbeEncoder,
  type HwProbeReport,
  PROBED_CODECS,
  WINDOWS_FALLBACK_CAPS,
  bestStatus,
  createEncoderProbe,
  encoderCapsFromReport,
  hwProbeRunner,
  normalizeCodec,
  parseHwProbeOutput,
  parseVendorId,
} from "./probe";

// Emitted by the C++ report builder: `reelform-native-tests --emit-probe-fixture`.
// Kept as .txt so formatters never pretty-print it: the helper emits ONE line.
const FIXTURE = readFileSync(
  fileURLToPath(new URL("./tests/fixtures/hw-probe-sample.txt", import.meta.url)),
  "utf8",
);

const NVIDIA = {
  name: "GPU",
  vendorId: 0x10de,
  deviceId: 1,
  dedicatedVideoMemory: 1,
  software: false,
  featureLevel: "12_1",
};
const BASIC_RENDER = {
  name: "Microsoft Basic Render Driver",
  vendorId: 0x1414,
  deviceId: 0x8c,
  dedicatedVideoMemory: 0,
  software: true,
  featureLevel: "12_1",
};

const report = (patch: Partial<HwProbeReport> = {}): HwProbeReport => ({
  t: "report",
  version: "1.0.0",
  adapters: [],
  encoders: [],
  errors: [],
  ...patch,
});

const enc = (codec: string, hardware: boolean, vendorId?: string): HwProbeEncoder =>
  vendorId === undefined
    ? { codec, subtype: "", name: codec, hardware }
    : { codec, subtype: "", name: codec, hardware, vendorId };

describe("parseHwProbeOutput", () => {
  it("parses the report produced by the C++ builder", () => {
    const result = parseHwProbeOutput(FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.adapters).toHaveLength(3);
    expect(result.report.encoders).toHaveLength(7);
    expect(result.report.encoders[3]?.name).toBe("Intel® Quick Sync Video H.264 Encoder MFT");
    expect(encoderCapsFromReport(result.report)).toEqual({
      h264: "hardware",
      hevc: "hardware",
      av1: "hardware",
      vp9: "unsupported",
    });
  });

  it("picks the report line among other protocol lines and CRLF", () => {
    const stdout = `{"t":"pong","version":"1.0.0","caps":[]}\r\n\r\n${FIXTURE.trim()}\r\n`;
    expect(parseHwProbeOutput(stdout).ok).toBe(true);
  });

  it("defaults a missing errors array", () => {
    const result = parseHwProbeOutput(
      '{"t":"report","version":"1.0.0","adapters":[],"encoders":[]}',
    );
    expect(result).toEqual({ ok: true, report: report() });
  });

  it("rejects empty, non-JSON and non-report output", () => {
    expect(parseHwProbeOutput("")).toEqual({ ok: false, error: "no output" });
    expect(parseHwProbeOutput("  \n\r\n")).toEqual({ ok: false, error: "no output" });
    expect(parseHwProbeOutput("Segmentation fault")).toEqual({ ok: false, error: "invalid JSON" });
    expect(parseHwProbeOutput('{"t":"pong"}')).toEqual({ ok: false, error: "no report line" });
    expect(parseHwProbeOutput("[1,2]")).toEqual({ ok: false, error: "no report line" });
    expect(parseHwProbeOutput("null")).toEqual({ ok: false, error: "no report line" });
  });

  it("reports the schema path of a malformed report", () => {
    const result = parseHwProbeOutput(
      '{"t":"report","version":"1.0.0","adapters":[],"encoders":[{"codec":"h264","subtype":"H264","name":"x","hardware":"yes"}]}',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("encoders.0.hardware");
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseHwProbeOutput(s);
        expect(typeof r.ok).toBe("boolean");
      }),
    );
  });
});

describe("normalizeCodec / parseVendorId / bestStatus", () => {
  it("maps codec names and falls back to the MF subtype FOURCC", () => {
    expect(normalizeCodec("H264")).toBe("h264");
    expect(normalizeCodec(" avc1 ")).toBe("h264");
    expect(normalizeCodec("other", "HEVC")).toBe("hevc");
    expect(normalizeCodec("", "AV01")).toBe("av1");
    expect(normalizeCodec("unknown", "VP90")).toBe("vp9");
    expect(normalizeCodec("other", "MP43")).toBeNull();
  });

  it("does not resolve prototype keys", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(normalizeCodec(key, key)).toBeNull();
    }
  });

  it("parses PCI vendor ids", () => {
    expect(parseVendorId("VEN_10DE")).toBe(0x10de);
    expect(parseVendorId("ven_8086")).toBe(0x8086);
    expect(parseVendorId(undefined)).toBeNull();
    expect(parseVendorId("10DE")).toBeNull();
    expect(parseVendorId("VEN_10DEX")).toBeNull();
  });

  it("orders statuses", () => {
    expect(bestStatus("unsupported", "software")).toBe("software");
    expect(bestStatus("hardware", "software")).toBe("hardware");
    expect(bestStatus("software", "unsupported")).toBe("software");
  });
});

describe("encoderCapsFromReport", () => {
  it("is all unsupported for an empty report", () => {
    expect(encoderCapsFromReport(report())).toEqual({
      h264: "unsupported",
      hevc: "unsupported",
      av1: "unsupported",
      vp9: "unsupported",
    });
  });

  it("software only", () => {
    expect(
      encoderCapsFromReport(report({ adapters: [NVIDIA], encoders: [enc("h264", false)] })).h264,
    ).toBe("software");
  });

  it("hardware wins regardless of order", () => {
    const a = encoderCapsFromReport(report({ encoders: [enc("hevc", true), enc("hevc", false)] }));
    const b = encoderCapsFromReport(report({ encoders: [enc("hevc", false), enc("hevc", true)] }));
    expect(a.hevc).toBe("hardware");
    expect(b.hevc).toBe("hardware");
  });

  it("ignores hardware MFTs when only software adapters exist (VM / basic display)", () => {
    const caps = encoderCapsFromReport(
      report({
        adapters: [BASIC_RENDER],
        encoders: [enc("h264", true, "VEN_10DE"), enc("h264", false)],
      }),
    );
    expect(caps.h264).toBe("software");
  });

  it("ignores hardware MFTs whose vendor has no adapter (unplugged eGPU)", () => {
    const caps = encoderCapsFromReport(
      report({ adapters: [NVIDIA], encoders: [enc("av1", true, "VEN_1002")] }),
    );
    expect(caps.av1).toBe("unsupported");
  });

  it("trusts hardware MFTs without vendor id when a hardware adapter exists", () => {
    const caps = encoderCapsFromReport(
      report({ adapters: [NVIDIA], encoders: [enc("vp9", true)] }),
    );
    expect(caps.vp9).toBe("hardware");
  });

  it("trusts the encoder list when adapter enumeration failed", () => {
    const caps = encoderCapsFromReport(
      report({ encoders: [enc("h264", true, "VEN_10DE")], errors: ["CreateDXGIFactory1 failed"] }),
    );
    expect(caps.h264).toBe("hardware");
  });

  const encoderArb: fc.Arbitrary<HwProbeEncoder> = fc
    .record({
      codec: fc.oneof(
        fc.constantFrom("h264", "hevc", "av1", "vp9", "other", "H264", "AVC1", "constructor"),
        fc.string(),
      ),
      subtype: fc.oneof(fc.constantFrom("H264", "HEVC", "AV01", "VP90", "MP43", ""), fc.string()),
      name: fc.string(),
      hardware: fc.boolean(),
      vendorId: fc.option(fc.constantFrom("VEN_10DE", "VEN_8086", "VEN_1002", "bogus"), {
        nil: undefined,
      }),
    })
    .map(({ vendorId, ...rest }) => (vendorId === undefined ? rest : { ...rest, vendorId }));

  const adapterArb = fc.record({
    name: fc.string(),
    vendorId: fc.constantFrom(0x10de, 0x8086, 0x1002, 0x1414),
    deviceId: fc.nat(),
    dedicatedVideoMemory: fc.nat(),
    software: fc.boolean(),
    featureLevel: fc.constantFrom("12_1", "11_0", ""),
  });

  const reportArb = fc
    .record({ adapters: fc.array(adapterArb, { maxLength: 4 }), encoders: fc.array(encoderArb) })
    .map((r) => report(r));

  it("property: output always satisfies the export:probeEncoders schema", () => {
    fc.assert(
      fc.property(reportArb, (r) => {
        expect(EncoderCaps.safeParse(encoderCapsFromReport(r)).success).toBe(true);
      }),
    );
  });

  it("property: adding encoders never downgrades a codec", () => {
    fc.assert(
      fc.property(reportArb, fc.array(encoderArb), (r, extra) => {
        const before = encoderCapsFromReport(r);
        const after = encoderCapsFromReport({ ...r, encoders: [...r.encoders, ...extra] });
        for (const codec of PROBED_CODECS) {
          expect(bestStatus(before[codec], after[codec])).toBe(after[codec]);
        }
      }),
    );
  });

  it("property: encoder order does not matter", () => {
    fc.assert(
      fc.property(reportArb, (r) => {
        const reversed = { ...r, encoders: [...r.encoders].reverse() };
        expect(encoderCapsFromReport(reversed)).toEqual(encoderCapsFromReport(r));
      }),
    );
  });

  it("property: without adapters, hardware iff some hardware encoder of that codec", () => {
    fc.assert(
      fc.property(fc.array(encoderArb), (encoders) => {
        const caps = encoderCapsFromReport(report({ encoders }));
        for (const codec of PROBED_CODECS) {
          const hw = encoders.some(
            (e) => e.hardware && normalizeCodec(e.codec, e.subtype) === codec,
          );
          expect(caps[codec] === "hardware").toBe(hw);
        }
      }),
    );
  });

  it("property: JSON round trip through the parser preserves the result", () => {
    fc.assert(
      fc.property(reportArb, (r) => {
        const parsed = parseHwProbeOutput(JSON.stringify(r));
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
          expect(encoderCapsFromReport(parsed.report)).toEqual(encoderCapsFromReport(r));
      }),
    );
  });
});

describe("createEncoderProbe", () => {
  it("runs the helper once and caches, including concurrent callers", async () => {
    const runHwProbe = vi.fn(async () => FIXTURE);
    const probe = createEncoderProbe({ runHwProbe });
    const [a, b] = await Promise.all([probe.probeEncoders(), probe.probeEncoders()]);
    expect(a).toEqual(b);
    expect(a.h264).toBe("hardware");
    expect((await probe.report())?.adapters).toHaveLength(3);
    expect(runHwProbe).toHaveBeenCalledTimes(1);
  });

  it("falls back when the helper rejects, and caches the failure", async () => {
    const onError = vi.fn();
    const runHwProbe = vi.fn(async () => {
      throw new Error("spawn ENOENT");
    });
    const probe = createEncoderProbe({ runHwProbe, onError });
    expect(await probe.probeEncoders()).toEqual(WINDOWS_FALLBACK_CAPS);
    expect(await probe.report()).toBeNull();
    expect(runHwProbe).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("hw-probe failed: spawn ENOENT");
  });

  it("falls back when the helper throws synchronously", async () => {
    const probe = createEncoderProbe({
      runHwProbe: () => {
        throw "boom";
      },
    });
    expect(await probe.probeEncoders()).toEqual(WINDOWS_FALLBACK_CAPS);
  });

  it("falls back on unusable output and reports why", async () => {
    const onError = vi.fn();
    const probe = createEncoderProbe({ runHwProbe: async () => "garbage", onError });
    expect(await probe.probeEncoders()).toEqual(WINDOWS_FALLBACK_CAPS);
    expect(onError).toHaveBeenCalledWith("hw-probe: invalid JSON");
  });

  it("returns a fresh copy of the fallback (callers may mutate)", async () => {
    const probe = createEncoderProbe({ runHwProbe: async () => "" });
    const caps = await probe.probeEncoders();
    caps.h264 = "hardware";
    expect(WINDOWS_FALLBACK_CAPS.h264).toBe("software");
  });

  it("reset re-runs the helper", async () => {
    const runHwProbe = vi.fn(async () => FIXTURE);
    const probe = createEncoderProbe({ runHwProbe });
    await probe.probeEncoders();
    probe.reset();
    await probe.probeEncoders();
    expect(runHwProbe).toHaveBeenCalledTimes(2);
  });
});

describe("hwProbeRunner", () => {
  it("spawns the binary hidden with a timeout and returns stdout", async () => {
    const execFile = vi.fn(async () => ({ stdout: FIXTURE }));
    const run = hwProbeRunner(execFile, "C:\\app\\bin\\win32-x64\\reelform-hw-probe.exe", 5000);
    expect(await run()).toBe(FIXTURE);
    expect(execFile).toHaveBeenCalledWith("C:\\app\\bin\\win32-x64\\reelform-hw-probe.exe", [], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  });
});
