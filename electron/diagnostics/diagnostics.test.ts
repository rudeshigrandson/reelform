import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsBundleSchema, buildDiagnosticsBundle } from "./bundle";
import { createDiagnosticsHandlers, diagnosticsContracts } from "./contracts";
import { RingBuffer, createLogger, formatLogArg, formatLogEntry } from "./logger";
import { createScrubber, scrubValue } from "./scrub";

const mac = createScrubber({ homeDir: "/Users/michi", userName: "michi" });
const win = createScrubber({ homeDir: "C:\\Users\\Mishal", userName: "Mishal" });

describe("scrubber", () => {
  it.each([
    ["Opened /Users/michi/Movies/Reelform/demo.mp4", "Opened <path>.mp4"],
    ["cwd ~/Desktop", "cwd ~/Desktop".replace("~/Desktop", "<path>")],
    ["home is /Users/michi", "home is ~"],
    ["home is /Users/michi.", "home is ~."],
    ["neighbour /Users/michigan/notes.txt", "neighbour <path>.txt"],
    ["bare /Users/michigan", "bare <path>"],
    ["    at run (/Users/michi/app/node_modules/x/index.js:10:5)", "    at run (<path>.js:10:5)"],
    ["user michi logged in", "user <user> logged in"],
    ["other user /Users/bob/secret/plan.key", "other user <path>.key"],
    ["linux /home/alice/.config/Reelform/settings.json", "linux <path>.json"],
    ["tmp /var/folders/xy/T/reelform-123", "tmp <path>"],
    ["url file:///Users/michi/a%20b.reelform", "url <path>.reelform"],
    [
      "see https://github.com/reelform/app/releases ok",
      "see https://github.com/reelform/app/releases ok",
    ],
    ["ratio 16/9 and 3/4", "ratio 16/9 and 3/4"],
    ["mime video/mp4", "mime video/mp4"],
  ])("mac: %s", (input, expected) => {
    expect(mac(input)).toBe(expected);
  });

  it.each([
    ["Failed C:\\Users\\Mishal\\Videos\\Reelform\\take 1.mp4", "Failed <path> 1.mp4"],
    ["D:/Projects/client/launch.reelform", "<path>.reelform"],
    ["share \\\\nas\\team\\video.mov", "share <path>.mov"],
    ["MISHAL did it", "<user> did it"],
  ])("win: %s", (input, expected) => {
    expect(win(input)).toBe(expected);
  });

  it("never leaks the user name through any absolute path under the profile", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z0-9 ._-]{1,12}$/), { minLength: 0, maxLength: 4 }),
        fc.constantFrom("/", "\\"),
        (segments, sep) => {
          const base = sep === "/" ? "/Users/michi" : "C:\\Users\\michi";
          const text = `err at ${[base, ...segments].join(sep)} end`;
          const out = createScrubber({ homeDir: "/Users/michi", userName: "michi" })(text);
          expect(out.toLowerCase()).not.toContain("michi");
        },
      ),
    );
  });

  it("removes a home dir that contains spaces entirely (Windows profile names)", () => {
    const s = createScrubber({ homeDir: "C:\\Users\\John Smith", userName: "john" });
    const out = s(
      "Failed C:\\Users\\John Smith\\Videos\\Reelform\\demo.mp4 and C:/Users/John Smith/x.log",
    );
    expect(out).toBe("Failed <path>.mp4 and <path>.log");
    expect(out).not.toMatch(/smith|john/i);
    const posix = createScrubber({ homeDir: "/Users/john smith" });
    expect(posix("open /Users/john smith/Movies/a.mov")).toBe("open <path>.mov");
  });

  it("does not scrub short or missing user names blindly", () => {
    const s = createScrubber({ userName: "a" });
    expect(s("a cat")).toBe("a cat");
    expect(createScrubber()("plain text")).toBe("plain text");
  });

  it("scrubValue walks nested structures", () => {
    expect(scrubValue({ a: ["/Users/michi/x.txt", 1, { b: "michi" }], c: null }, mac)).toEqual({
      a: ["<path>.txt", 1, { b: "<user>" }],
      c: null,
    });
  });
});

describe("RingBuffer", () => {
  it("keeps the last N items in order", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) rb.push(i);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.size).toBe(3);
    rb.clear();
    expect(rb.toArray()).toEqual([]);
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });

  it("property: equals the tail of the pushed sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer(), { maxLength: 60 }),
        (cap, xs) => {
          const rb = new RingBuffer<number>(cap);
          for (const x of xs) rb.push(x);
          expect(rb.toArray()).toEqual(xs.slice(-cap));
        },
      ),
    );
  });
});

describe("logger", () => {
  const setup = (capacity = 3) => {
    let t = 0;
    const sink = vi.fn();
    const logger = createLogger({ now: () => ++t, scrub: mac, capacity, sink, level: "info" });
    return { logger, sink };
  };

  it("filters by level, scrubs messages, tags scopes, and bounds the buffer", () => {
    const { logger, sink } = setup();
    logger.debug("hidden");
    logger.info("saved", "/Users/michi/Movies/a.reelform");
    logger.child("export").warn("slow encoder", { fps: 12 });
    logger.error(new Error("boom at /Users/michi/x.ts:1"));
    logger.info("fourth");
    const entries = logger.entries();
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      t: 2,
      level: "warn",
      scope: "export",
      message: 'slow encoder {"fps":12}',
    });
    expect(entries[1]?.message).toContain("boom at <path>.ts:1");
    expect(entries[1]?.message).not.toContain("michi");
    expect(sink).toHaveBeenCalledTimes(4);
    expect(sink.mock.calls[0]?.[0]).toMatchObject({ message: "saved <path>.reelform" });

    logger.setLevel("debug");
    logger.child("a").child("b").debug("now visible");
    expect(logger.entries().at(-1)).toMatchObject({ scope: "a:b", level: "debug" });
    expect(logger.getLevel()).toBe("debug");
    logger.clear();
    expect(logger.entries()).toEqual([]);
  });

  it("truncates huge messages and handles unserializable args", () => {
    const { logger } = setup();
    logger.info("x".repeat(10_000));
    expect(logger.entries()[0]?.message.length).toBe(4001);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatLogArg(cyclic)).toBe("[object Object]");
    expect(formatLogArg(undefined)).toBe("undefined");
    expect(formatLogEntry({ t: 0, level: "warn", scope: "s", message: "m" })).toBe(
      "1970-01-01T00:00:00.000Z WARN [s] m",
    );
  });
});

describe("diagnostics bundle", () => {
  const input = {
    app: {
      name: "Reelform",
      version: "1.0.0",
      electron: "33.0.0",
      chrome: "130",
      node: "20",
      packaged: true,
    },
    os: {
      platform: "darwin",
      release: "25.5.0",
      arch: "arm64",
      locale: "en-US",
      totalMemoryMb: 16384,
    },
    gpu: { featureStatus: { webgpu: "enabled" }, info: { driver: "/Users/michi/Library/x.dylib" } },
    settings: {
      theme: "dark",
      recordingsFolder: "/Users/michi/Movies/Reelform",
      language: "system",
      shortcuts: { "editor.save": "Meta+S" },
    },
    logs: [
      { t: 0, level: "info" as const, scope: "", message: "one" },
      { t: 1, level: "warn" as const, scope: "rec", message: "two michi" },
      { t: 2, level: "error" as const, scope: "", message: "three" },
    ],
  };

  it("drops path settings, scrubs everything, keeps recent logs", () => {
    const bundle = buildDiagnosticsBundle(input, {
      now: () => 86_400_000,
      scrub: mac,
      maxLogLines: 2,
    });
    expect(DiagnosticsBundleSchema.parse(bundle)).toEqual(bundle);
    expect(bundle.createdAt).toBe("1970-01-02T00:00:00.000Z");
    expect(bundle.settings).toEqual({
      theme: "dark",
      language: "system",
      shortcuts: { "editor.save": "Meta+S" },
    });
    expect(bundle.logs).toEqual([
      "1970-01-01T00:00:00.001Z WARN [rec] two <user>",
      "1970-01-01T00:00:00.002Z ERROR three",
    ]);
    expect(bundle.gpu).toEqual({
      featureStatus: { webgpu: "enabled" },
      info: { driver: "<path>.dylib" },
    });
    expect(JSON.stringify(bundle)).not.toContain("michi");
  });

  it("maxLogLines 0 yields no logs", () => {
    expect(
      buildDiagnosticsBundle(input, { now: () => 0, scrub: mac, maxLogLines: 0 }).logs,
    ).toEqual([]);
  });

  it("system:copyDiagnostics writes JSON to the clipboard and reports bytes", async () => {
    const writeText = vi.fn();
    const h = createDiagnosticsHandlers({
      now: () => 0,
      scrub: mac,
      collect: async () => input,
      clipboard: { writeText },
    });
    const res = await h["system:copyDiagnostics"]();
    expect(diagnosticsContracts["system:copyDiagnostics"].response.parse(res)).toEqual(res);
    expect(res.ok).toBe(true);
    const text = writeText.mock.calls[0]?.[0] as string;
    expect(res.bytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(JSON.parse(text).app.version).toBe("1.0.0");
  });

  it("collection failure returns ok:false without touching the clipboard", async () => {
    const writeText = vi.fn();
    const onError = vi.fn();
    const h = createDiagnosticsHandlers({
      now: () => 0,
      scrub: mac,
      collect: async () => {
        throw new Error("gpu info timeout");
      },
      clipboard: { writeText },
      onError,
    });
    expect(await h["system:copyDiagnostics"]()).toEqual({ ok: false, bytes: 0 });
    expect(writeText).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });
});
