import { z } from "zod";

/**
 * Windows hardware-encoder probe (ENGINEERING_SPEC §5.4, §3 `export:probeEncoders`).
 *
 * `reelform-hw-probe.exe` prints one JSON report line (schema mirrored from
 * `common/include/reelform/hw_probe_report.hpp`). This module validates that
 * report and reduces it to the `export:probeEncoders` response shape. Pure,
 * except for the injected process runner in {@link createEncoderProbe}.
 */

export const HwStatus = z.enum(["hardware", "software", "unsupported"]);
export type HwStatus = z.infer<typeof HwStatus>;

export const PROBED_CODECS = ["h264", "hevc", "av1", "vp9"] as const;
export type ProbedCodec = (typeof PROBED_CODECS)[number];

/** Response body of `export:probeEncoders`. */
export const EncoderCaps = z.object({
  h264: HwStatus,
  hevc: HwStatus,
  av1: HwStatus,
  vp9: HwStatus,
});
export type EncoderCaps = z.infer<typeof EncoderCaps>;

export const HwProbeAdapter = z.object({
  name: z.string(),
  vendorId: z.number().int().min(0),
  deviceId: z.number().int().min(0),
  dedicatedVideoMemory: z.number().min(0),
  software: z.boolean(),
  featureLevel: z.string(),
});
export type HwProbeAdapter = z.infer<typeof HwProbeAdapter>;

export const HwProbeEncoder = z.object({
  codec: z.string(),
  subtype: z.string(),
  name: z.string(),
  hardware: z.boolean(),
  vendorId: z.string().optional(),
});
export type HwProbeEncoder = z.infer<typeof HwProbeEncoder>;

export const HwProbeReport = z.object({
  t: z.literal("report"),
  version: z.string(),
  adapters: z.array(HwProbeAdapter),
  encoders: z.array(HwProbeEncoder),
  errors: z.array(z.string()).default([]),
});
export type HwProbeReport = z.infer<typeof HwProbeReport>;

/** File name of the helper inside `bin/win32-<arch>/`. */
export const HW_PROBE_BINARY = "reelform-hw-probe.exe";
export const HW_PROBE_TIMEOUT_MS = 10_000;

/**
 * Used when the probe cannot run or its output is unusable. Every Windows 10+
 * install (outside N editions) ships the software H.264 encoder MFT; nothing
 * else can be assumed.
 */
export const WINDOWS_FALLBACK_CAPS: Readonly<EncoderCaps> = Object.freeze({
  h264: "software",
  hevc: "unsupported",
  av1: "unsupported",
  vp9: "unsupported",
});

// A Map, not an object literal: keys come from helper output and must not hit
// Object.prototype ("constructor", "__proto__", ...).
const CODEC_ALIASES: ReadonlyMap<string, ProbedCodec> = new Map<string, ProbedCodec>([
  ["h264", "h264"],
  ["avc", "h264"],
  ["avc1", "h264"],
  ["hevc", "hevc"],
  ["h265", "hevc"],
  ["hvc1", "hevc"],
  ["av1", "av1"],
  ["av01", "av1"],
  ["vp9", "vp9"],
  ["vp90", "vp9"],
]);

/** Map a report `codec` (or, failing that, its MF subtype FOURCC) to a probed codec. */
export function normalizeCodec(codec: string, subtype = ""): ProbedCodec | null {
  return (
    CODEC_ALIASES.get(codec.trim().toLowerCase()) ??
    CODEC_ALIASES.get(subtype.trim().toLowerCase()) ??
    null
  );
}

/** `"VEN_10DE"` → `0x10de`; anything else → null. */
export function parseVendorId(vendor: string | undefined): number | null {
  if (vendor === undefined) return null;
  const match = /^VEN_([0-9a-f]{4})$/i.exec(vendor.trim());
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 16);
}

const RANK: Record<HwStatus, number> = { unsupported: 0, software: 1, hardware: 2 };

/** Higher of two statuses (hardware > software > unsupported). */
export function bestStatus(a: HwStatus, b: HwStatus): HwStatus {
  return RANK[b] > RANK[a] ? b : a;
}

/**
 * Reduce a report to per-codec status.
 *
 * A hardware encoder only counts when a matching physical adapter is present:
 * if the report lists adapters and none is hardware (VM / Basic Render Driver)
 * or none matches the MFT's `VEN_xxxx`, a stale driver registration would
 * otherwise advertise an encoder that fails at export time. Reports without
 * adapters (enumeration failed) trust the encoder list.
 */
export function encoderCapsFromReport(report: HwProbeReport): EncoderCaps {
  const hardwareAdapters = report.adapters.filter((a) => !a.software);
  const adaptersKnown = report.adapters.length > 0;
  const hardwareUsable = (encoder: HwProbeEncoder): boolean => {
    if (!adaptersKnown) return true;
    if (hardwareAdapters.length === 0) return false;
    const vendor = parseVendorId(encoder.vendorId);
    return vendor === null || hardwareAdapters.some((a) => a.vendorId === vendor);
  };

  const caps: EncoderCaps = {
    h264: "unsupported",
    hevc: "unsupported",
    av1: "unsupported",
    vp9: "unsupported",
  };
  for (const encoder of report.encoders) {
    const codec = normalizeCodec(encoder.codec, encoder.subtype);
    if (codec === null) continue;
    if (encoder.hardware) {
      if (hardwareUsable(encoder)) caps[codec] = "hardware";
    } else {
      caps[codec] = bestStatus(caps[codec], "software");
    }
  }
  return caps;
}

export type HwProbeParseResult = { ok: true; report: HwProbeReport } | { ok: false; error: string };

/**
 * Find and validate the report in helper stdout. Tolerates CRLF, blank lines
 * and other protocol lines (e.g. a `pong` in `--stdio` mode): the last
 * `{"t":"report"}` line wins. Never throws.
 */
export function parseHwProbeOutput(stdout: string): HwProbeParseResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let lastError = "no output";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      lastError = "invalid JSON";
      continue;
    }
    if (typeof json !== "object" || json === null || (json as { t?: unknown }).t !== "report") {
      lastError = "no report line";
      continue;
    }
    const parsed = HwProbeReport.safeParse(json);
    if (parsed.success) return { ok: true, report: parsed.data };
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    return { ok: false, error: `invalid report${where}: ${issue?.message ?? "schema mismatch"}` };
  }
  return { ok: false, error: lastError };
}

/** Minimal promisified `child_process.execFile` shape (inject the real one in main). */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: boolean; maxBuffer: number },
) => Promise<{ stdout: string }>;

/** Build a `runHwProbe` for {@link createEncoderProbe} from an execFile implementation. */
export function hwProbeRunner(
  execFile: ExecFileFn,
  binaryPath: string,
  timeoutMs: number = HW_PROBE_TIMEOUT_MS,
): () => Promise<string> {
  return async () => {
    const { stdout } = await execFile(binaryPath, [], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  };
}

export interface EncoderProbeDeps {
  /** Run `reelform-hw-probe.exe` once and resolve with its stdout. */
  runHwProbe: () => Promise<string>;
  /** Diagnostics sink (probe failures are not fatal). */
  onError?: ((message: string) => void) | undefined;
}

export interface EncoderProbe {
  /** `export:probeEncoders` response. Probes once per launch; falls back on failure. */
  probeEncoders(): Promise<EncoderCaps>;
  /** Full report for Advanced settings, or null when the probe failed. */
  report(): Promise<HwProbeReport | null>;
  /** Forget the cached result (next call re-runs the helper). */
  reset(): void;
}

/** Once-per-launch cached probe (§5.4 "enumerates … once per launch; result cached"). */
export function createEncoderProbe(deps: EncoderProbeDeps): EncoderProbe {
  let pending: Promise<HwProbeReport | null> | null = null;

  const load = (): Promise<HwProbeReport | null> => {
    pending ??= Promise.resolve()
      .then(() => deps.runHwProbe())
      .then(
        (stdout) => {
          const result = parseHwProbeOutput(stdout);
          if (result.ok) return result.report;
          deps.onError?.(`hw-probe: ${result.error}`);
          return null;
        },
        (err: unknown) => {
          deps.onError?.(`hw-probe failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        },
      );
    return pending;
  };

  return {
    report: load,
    async probeEncoders() {
      const report = await load();
      return report === null ? { ...WINDOWS_FALLBACK_CAPS } : encoderCapsFromReport(report);
    },
    reset() {
      pending = null;
    },
  };
}
