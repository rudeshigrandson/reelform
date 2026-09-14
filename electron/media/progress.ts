/**
 * Parser for ffmpeg `-progress pipe:1` output: blocks of `key=value` lines, each
 * block terminated by `progress=continue` or `progress=end`. Chunks from the
 * pipe may split lines anywhere, so the parser buffers partial lines.
 */

export interface FfmpegProgress {
  frame: number | null;
  fps: number | null;
  /** Output timestamp reached, ms. */
  outTimeMs: number | null;
  totalSizeBytes: number | null;
  /** Encode speed relative to realtime (`1.5x` → 1.5). */
  speed: number | null;
  /** 0..1 when a total duration is known, else null. */
  ratio: number | null;
  done: boolean;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** `HH:MM:SS.micro` → ms (null for `N/A` or garbage). */
export function parseClockTime(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?)(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const [, sign, h = "0", min = "0", s = "0"] = m;
  const ms = (Number(h) * 3600 + Number(min) * 60 + Number(s)) * 1000;
  return sign === "-" ? -ms : ms;
}

/** Fold one completed key/value block into a progress record. */
export function progressFromBlock(
  block: Readonly<Record<string, string>>,
  totalDurationMs?: number | undefined,
): FfmpegProgress {
  // `out_time_ms` is actually microseconds in ffmpeg (long-standing quirk).
  const us = num(block.out_time_us) ?? num(block.out_time_ms);
  let outTimeMs = us !== null ? us / 1000 : parseClockTime(block.out_time);
  if (outTimeMs !== null) outTimeMs = Math.max(0, outTimeMs);
  const done = block.progress === "end";
  let ratio: number | null = null;
  if (totalDurationMs !== undefined && totalDurationMs > 0 && outTimeMs !== null) {
    ratio = Math.min(1, Math.max(0, outTimeMs / totalDurationMs));
  }
  if (done && totalDurationMs !== undefined && totalDurationMs > 0) ratio = 1;
  return {
    frame: num(block.frame),
    fps: num(block.fps),
    outTimeMs,
    totalSizeBytes: num(block.total_size),
    speed: num(block.speed?.replace(/x$/, "")),
    ratio,
    done,
  };
}

export interface ProgressParser {
  push(chunk: string): void;
  /** Flush a trailing unterminated line (call on process exit). */
  end(): void;
}

export function createProgressParser(
  onProgress: (p: FfmpegProgress) => void,
  totalDurationMs?: number | undefined,
): ProgressParser {
  let pending = "";
  let block: Record<string, string> = {};

  const line = (raw: string): void => {
    const text = raw.trim();
    const eq = text.indexOf("=");
    if (eq <= 0) return;
    const key = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    block[key] = value;
    if (key === "progress") {
      onProgress(progressFromBlock(block, totalDurationMs));
      block = {};
    }
  };

  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? "";
      for (const l of lines) line(l);
    },
    end() {
      if (pending !== "") line(pending);
      pending = "";
    },
  };
}
