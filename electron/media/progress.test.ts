import fc from "fast-check";
import { type FfmpegProgress, createProgressParser, parseClockTime } from "./progress";

const BLOCK1 = [
  "frame=120",
  "fps=59.94",
  "stream_0_0_q=23.0",
  "bitrate=1234.5kbits/s",
  "total_size=262144",
  "out_time_us=2000000",
  "out_time_ms=2000000",
  "out_time=00:00:02.000000",
  "dup_frames=0",
  "drop_frames=0",
  "speed=1.98x",
  "progress=continue",
].join("\n");
const BLOCK2 =
  "frame=300\nout_time_us=N/A\nout_time=00:00:05.000000\nspeed=N/A\ntotal_size=N/A\nprogress=end\n";

function collect(text: string, total?: number, split: number[] = []): FfmpegProgress[] {
  const out: FfmpegProgress[] = [];
  const p = createProgressParser((x) => out.push(x), total);
  let prev = 0;
  for (const cut of [...split, text.length]) {
    p.push(text.slice(prev, cut));
    prev = cut;
  }
  p.end();
  return out;
}

describe("ffmpeg progress parser", () => {
  it("parses blocks with µs time, speed and ratio", () => {
    const [a, b] = collect(`${BLOCK1}\n${BLOCK2}`, 5000);
    expect(a).toEqual({
      frame: 120,
      fps: 59.94,
      outTimeMs: 2000,
      totalSizeBytes: 262144,
      speed: 1.98,
      ratio: 0.4,
      done: false,
    });
    expect(b).toMatchObject({
      frame: 300,
      outTimeMs: 5000,
      speed: null,
      totalSizeBytes: null,
      ratio: 1,
      done: true,
    });
  });

  it("ratio is null without a total and clamped with one", () => {
    expect(collect(BLOCK1)[0]?.ratio).toBeNull();
    expect(collect(BLOCK1, 1000)[0]?.ratio).toBe(1);
  });

  it("CRLF line endings and a trailing unterminated line", () => {
    const res = collect("frame=1\r\nout_time_us=500000\r\nprogress=continue");
    expect(res).toHaveLength(1);
    expect(res[0]?.outTimeMs).toBe(500);
  });

  it("negative out_time at the start is clamped to 0", () => {
    expect(collect("out_time_us=-23220\nprogress=continue\n")[0]?.outTimeMs).toBe(0);
  });

  it("ignores junk lines", () => {
    expect(collect("hello\n=x\nprogress=continue\n")).toHaveLength(1);
  });

  it("clock times", () => {
    expect(parseClockTime("01:02:03.5")).toBe(3723500);
    expect(parseClockTime("N/A")).toBeNull();
    expect(parseClockTime(undefined)).toBeNull();
  });

  it("property: arbitrary chunking yields identical records", () => {
    const text = `${BLOCK1}\n${BLOCK2}${BLOCK1}\n`;
    const whole = collect(text, 5000);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: text.length - 1 }), { maxLength: 20 }),
        (cuts) => {
          expect(
            collect(
              text,
              5000,
              [...cuts].sort((x, y) => x - y),
            ),
          ).toEqual(whole);
        },
      ),
    );
  });
});
