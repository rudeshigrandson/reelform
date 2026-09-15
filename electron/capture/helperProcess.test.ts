import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ExitInfo,
  HelperError,
  HelperProcess,
  LineDecoder,
  RingBuffer,
  START_TIMEOUT_MS,
  parseHelperLine,
} from "./helperProcess";
import { type FakeChild, fakeHelperEnv, flush, scriptHelper } from "./testUtils";

const make = (
  onSpawn?: (c: FakeChild) => void,
  opts: { watchdogMs?: number; stderrLines?: number } = {},
) => {
  const env = fakeHelperEnv(onSpawn);
  const helper = new HelperProcess(
    { command: "/bin/reelform-sck", args: ["--x"], ...opts },
    env.deps,
  );
  return { env, helper };
};

describe("LineDecoder", () => {
  it("joins partial chunks, strips CRLF and skips blank lines", () => {
    const d = new LineDecoder();
    expect(d.push('{"t":"a"')).toEqual([]);
    expect(d.push('}\r\n\n{"t":"b"}\n{"t"')).toEqual(['{"t":"a"}', '{"t":"b"}']);
    expect(d.push(':"c"}\n')).toEqual(['{"t":"c"}']);
  });

  it("decodes UTF-8 split across byte chunks", () => {
    const bytes = new TextEncoder().encode('{"t":"é✓"}\n');
    const d = new LineDecoder();
    const out = [...d.push(bytes.slice(0, 7)), ...d.push(bytes.slice(7))];
    expect(out).toEqual(['{"t":"é✓"}']);
  });

  it("property: any chunking yields the same lines", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1 }).filter((s) => !s.includes("\n") && !s.endsWith("\r")),
          { maxLength: 8 },
        ),
        fc.array(fc.nat(), { maxLength: 10 }),
        (lines, cuts) => {
          const text = lines.map((l) => `${l}\n`).join("");
          const points = [...new Set(cuts.map((c) => (text.length ? c % text.length : 0)))].sort(
            (a, b) => a - b,
          );
          const d = new LineDecoder();
          const out: string[] = [];
          let prev = 0;
          for (const p of [...points, text.length]) {
            out.push(...d.push(text.slice(prev, p)));
            prev = p;
          }
          expect(out).toEqual(lines);
        },
      ),
    );
  });
});

describe("parseHelperLine", () => {
  it("accepts {t} objects and rejects everything else", () => {
    expect(parseHelperLine('{"t":"pong","version":"1"}')).toEqual({ t: "pong", version: "1" });
    expect(parseHelperLine("not json")).toBeNull();
    expect(parseHelperLine("[1]")).toBeNull();
    expect(parseHelperLine("null")).toBeNull();
    expect(parseHelperLine('{"x":1}')).toBeNull();
    expect(parseHelperLine('{"t":"a","id":"1"}')).toBeNull();
  });
});

describe("RingBuffer", () => {
  it("property: keeps only the newest `capacity` lines", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.integer({ min: 0, max: 20 }), (items, cap) => {
        const rb = new RingBuffer(cap);
        for (const i of items) rb.push(i);
        expect(rb.toArray()).toEqual(cap === 0 ? [] : items.slice(-cap));
      }),
    );
  });
});

describe("HelperProcess.start", () => {
  it("spawns hidden without a shell and resolves on pong", async () => {
    const { env, helper } = make((c) =>
      scriptHelper(c, { version: "1.2.3", caps: ["capture", "audio"] }),
    );
    await expect(helper.start()).resolves.toEqual({ version: "1.2.3", caps: ["capture", "audio"] });
    expect(env.spawns[0]).toEqual({
      command: "/bin/reelform-sck",
      args: ["--x"],
      options: { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] },
    });
    expect(env.children[0]?.written[0]).toEqual({ t: "ping" });
    expect(helper.running).toBe(true);
    await expect(helper.start()).rejects.toMatchObject({ code: "HELPER_STATE" });
  });

  it("times out after 12s without pong and kills the tree", async () => {
    const { env, helper } = make((c) => scriptHelper(c, { silentPing: true }));
    const exits: ExitInfo[] = [];
    helper.onExit((i) => exits.push(i));
    const p = helper.start();
    let settled = false;
    p.catch(() => {}).finally(() => {
      settled = true;
    });
    env.timers.advance(START_TIMEOUT_MS - 1);
    await flush();
    expect(settled).toBe(false);
    env.timers.advance(1);
    await expect(p).rejects.toMatchObject({ code: "HELPER_START_TIMEOUT" });
    expect(env.killed).toEqual([4242]);
    expect(exits[0]).toMatchObject({ expected: false, cause: "startTimeout" });
  });

  it("rejects when the helper exits before pong", async () => {
    const { env, helper } = make((c) => scriptHelper(c, { silentPing: true }));
    const p = helper.start();
    env.children[0]?.stderr.push("dyld: missing\n");
    env.children[0]?.exit(1);
    await expect(p).rejects.toMatchObject({ code: "HELPER_EXITED" });
    expect(env.timers.pendingCount).toBe(0);
  });

  it("maps a throwing spawn to HELPER_SPAWN_FAILED", async () => {
    const helper = new HelperProcess(
      { command: "x" },
      {
        ...fakeHelperEnv().deps,
        spawn: () => {
          throw new Error("ENOENT");
        },
      },
    );
    await expect(helper.start()).rejects.toMatchObject({ code: "HELPER_SPAWN_FAILED" });
  });
});

describe("HelperProcess.request", () => {
  it("refuses before start", async () => {
    const { helper } = make();
    await expect(helper.request({ t: "stop" })).rejects.toBeInstanceOf(HelperError);
  });

  it("correlates out-of-order responses by id", async () => {
    let child: FakeChild | undefined;
    const { helper } = make((c) => {
      child = c;
      scriptHelper(c);
      const base = c.onWrite;
      c.onWrite = (m, cc) => {
        if (m.t === "a" || m.t === "b") return; // answer manually
        base?.(m, cc);
      };
    });
    await helper.start();
    const a = helper.request({ t: "a" });
    const b = helper.request({ t: "b" });
    const ids = child?.written.slice(1).map((m) => m.id) ?? [];
    expect(ids).toEqual([1, 2]);
    child?.reply({ t: "done", id: 2, which: "b" });
    child?.reply({ t: "done", id: 1, which: "a" });
    await expect(a).resolves.toMatchObject({ which: "a" });
    await expect(b).resolves.toMatchObject({ which: "b" });
  });

  it("rejects on {t:error} with the helper code and on timeout", async () => {
    let child: FakeChild | undefined;
    const { env, helper } = make((c) => {
      child = c;
      scriptHelper(c);
    });
    await helper.start();
    const failing = helper.request({ t: "x" });
    child?.reply({ t: "error", id: 1, code: "NO_DISPLAY", message: "gone" });
    await expect(failing).rejects.toMatchObject({ code: "NO_DISPLAY", message: "gone" });

    const slow = helper.request({ t: "y" }, 500);
    env.timers.advance(500);
    await expect(slow).rejects.toMatchObject({ code: "HELPER_REQUEST_TIMEOUT" });
    // A late answer for the timed-out id becomes a plain event, not a crash.
    const events: string[] = [];
    helper.onEvent((m) => events.push(m.t));
    child?.reply({ t: "late", id: 2 });
    expect(events).toEqual(["late"]);
  });

  it("routes id-less messages to event listeners and logs malformed lines", async () => {
    let child: FakeChild | undefined;
    const { helper } = make((c) => {
      child = c;
      scriptHelper(c);
    });
    await helper.start();
    const events: string[] = [];
    const off = helper.onEvent((m) => events.push(m.t));
    child?.reply({ t: "stats", fps: 60 });
    child?.stdout.push("garbage\n");
    off();
    child?.reply({ t: "stats" });
    expect(events).toEqual(["stats"]);
    expect(helper.stderrTail().some((l) => l.includes("[protocol]"))).toBe(true);
  });

  it("rejects pending requests when the helper crashes, reporting an unexpected exit", async () => {
    let child: FakeChild | undefined;
    const { helper } = make(
      (c) => {
        child = c;
        scriptHelper(c);
      },
      { stderrLines: 2 },
    );
    await helper.start();
    const exits: ExitInfo[] = [];
    helper.onExit((i) => exits.push(i));
    const p = helper.request({ t: "never" });
    child?.stderr.push("one\ntwo\nthree\n");
    child?.exit(null, "SIGSEGV");
    await expect(p).rejects.toMatchObject({ code: "HELPER_EXITED" });
    expect(exits).toEqual([
      {
        code: null,
        signal: "SIGSEGV",
        expected: false,
        cause: undefined,
        stderrTail: ["two", "three"],
      },
    ]);
    // Late subscribers still learn about the exit.
    const late: ExitInfo[] = [];
    helper.onExit((i) => late.push(i));
    expect(late).toHaveLength(1);
  });
});

describe("HelperProcess.kill / watchdog", () => {
  it("kill is expected, kills the tree once and ignores the later OS exit", async () => {
    let child: FakeChild | undefined;
    const { env, helper } = make((c) => {
      child = c;
      scriptHelper(c);
    });
    await helper.start();
    const exits: ExitInfo[] = [];
    helper.onExit((i) => exits.push(i));
    const p = helper.request({ t: "never" });
    await helper.kill();
    await expect(p).rejects.toMatchObject({ code: "HELPER_KILLED" });
    child?.exit(0);
    await helper.kill();
    expect(env.killed).toEqual([4242]);
    expect(exits).toHaveLength(1);
    expect(exits[0]?.expected).toBe(true);
    expect(helper.running).toBe(false);
  });

  it("any message resets the watchdog; silence kills the helper as a crash", async () => {
    let child: FakeChild | undefined;
    const { env, helper } = make(
      (c) => {
        child = c;
        scriptHelper(c);
      },
      { watchdogMs: 5000 },
    );
    await helper.start();
    const exits: ExitInfo[] = [];
    helper.onExit((i) => exits.push(i));
    helper.armWatchdog();
    env.timers.advance(4000);
    child?.reply({ t: "stats" });
    env.timers.advance(4000);
    expect(exits).toHaveLength(0);
    env.timers.advance(1000);
    expect(exits[0]).toMatchObject({ expected: false, cause: "watchdog" });
    expect(env.killed).toEqual([4242]);
  });

  it("disarmed watchdog never fires", async () => {
    const { env, helper } = make(undefined, { watchdogMs: 100 });
    await helper.start();
    helper.armWatchdog();
    helper.disarmWatchdog();
    env.timers.advance(10_000);
    expect(helper.running).toBe(true);
  });
});
