import { setImmediate } from "node:timers";
import { describe, expect, it } from "vitest";
import type { HelperChild, HelperDeps, SpawnOptions } from "../../capture/helperProcess";
import type { VerifyResult } from "../../capture/manifest";
import { TelemetryCollector } from "../../recording/telemetry";
import {
  CURSOR_STOP_TIMEOUT_MS,
  CursorMonitorBridge,
  type CursorMonitorStatus,
} from "./cursorMonitorBridge";

async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

type Json = { t: string; id?: number; [key: string]: unknown };
type Script = (msg: Json, child: FakeChild) => void;

/** Scripted stand-in for the Swift helper: answers stdin lines per `script`. */
class FakeChild implements HelperChild {
  readonly received: Json[] = [];
  exited = false;
  private readonly out = new Set<(c: string | Uint8Array) => void>();
  private readonly exitListeners = new Set<(code: number | null, signal: string | null) => void>();

  constructor(
    readonly pid: number,
    private readonly script: Script,
  ) {}

  readonly stdin = {
    write: (data: string) => {
      for (const line of data.split("\n").filter(Boolean)) {
        const msg = JSON.parse(line) as Json;
        this.received.push(msg);
        queueMicrotask(() => this.script(msg, this));
      }
      return true;
    },
  };
  readonly stdout = {
    on: (_e: "data", l: (c: string | Uint8Array) => void) => this.out.add(l),
  };
  readonly stderr = { on: (_e: "data", _l: (c: string | Uint8Array) => void) => undefined };

  on(event: "exit" | "error", listener: never): unknown {
    if (event === "exit") this.exitListeners.add(listener);
    return this;
  }

  /** Writes one protocol line, optionally split across two chunks. */
  send(msg: object, split = false): void {
    const line = `${JSON.stringify(msg)}\n`;
    const chunks = split ? [line.slice(0, 5), line.slice(5)] : [line];
    for (const c of chunks) for (const l of [...this.out]) l(new TextEncoder().encode(c));
  }

  sendRaw(text: string): void {
    for (const l of [...this.out]) l(text);
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    for (const l of [...this.exitListeners]) l(code, signal);
  }

  types(): string[] {
    return this.received.map((m) => m.t);
  }
}

const STARTED = { hostTimeNs: 1, sampleHz: 120, clickSource: "eventTap", keys: true };

const happyScript: Script = (msg, child) => {
  if (child.exited) return;
  if (msg.t === "ping") child.send({ t: "pong", version: "1.0.0", caps: ["position"] });
  if (msg.t === "start") child.send({ t: "started", id: msg.id, ...STARTED });
  if (msg.t === "stop") {
    child.send({ t: "stopped", id: msg.id, samples: 3 });
    child.exit(0);
  }
};

interface Harness {
  bridge: CursorMonitorBridge;
  children: FakeChild[];
  spawns: { command: string; options: SpawnOptions }[];
  killed: number[];
  logs: string[];
  statuses: CursorMonitorStatus["state"][];
  timers: { fireAll(): void; pending(): number };
}

function harness(
  opts: {
    script?: Script;
    verify?: () => Promise<VerifyResult>;
    mapKeyCode?: (code: number) => number | null;
  } = {},
): Harness {
  const children: FakeChild[] = [];
  const spawns: Harness["spawns"] = [];
  const killed: number[] = [];
  const logs: string[] = [];
  const tasks = new Map<number, () => void>();
  let seq = 0;
  const deps: HelperDeps = {
    spawn: (command, _args, options) => {
      spawns.push({ command, options });
      const child = new FakeChild(1000 + children.length, opts.script ?? happyScript);
      children.push(child);
      return child;
    },
    killTree: (pid) => {
      killed.push(pid);
      children.find((c) => c.pid === pid)?.exit(null, "SIGKILL");
    },
    timers: {
      setTimeout: (cb) => {
        tasks.set(++seq, cb);
        return seq;
      },
      clearTimeout: (h) => {
        tasks.delete(h as number);
      },
    },
  };
  const bridge = new CursorMonitorBridge({
    resolveBinary:
      opts.verify ?? (async () => ({ ok: true, path: "/bin/reelform-cursor-monitor" })),
    helperDeps: deps,
    mapKeyCode: opts.mapKeyCode,
    log: (m) => logs.push(m),
  });
  const statuses: CursorMonitorStatus["state"][] = [];
  bridge.onStatus((s) => statuses.push(s.state));
  return {
    bridge,
    children,
    spawns,
    killed,
    logs,
    statuses,
    timers: {
      fireAll: () => {
        for (const [id, cb] of [...tasks]) {
          tasks.delete(id);
          cb();
        }
      },
      pending: () => tasks.size,
    },
  };
}

describe("CursorMonitorBridge lifecycle", () => {
  it("spawns nothing until the first listener, then pings and starts once", async () => {
    const h = harness();
    await flush();
    expect(h.spawns).toHaveLength(0);
    h.bridge.on("mousemove", () => {});
    h.bridge.on("keydown", () => {});
    await flush();
    expect(h.spawns).toEqual([
      {
        command: "/bin/reelform-cursor-monitor",
        options: { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] },
      },
    ]);
    expect(h.children[0]?.types()).toEqual(["ping", "start"]);
    expect(h.bridge.getStatus()).toEqual({
      state: "running",
      sampleHz: 120,
      clickSource: "eventTap",
      keys: true,
    });
    expect(h.statuses).toEqual(["starting", "running"]);
  });

  it("stops and kills the helper when the last listener leaves, and respawns on demand", async () => {
    const h = harness();
    const offMove = h.bridge.on("mousemove", () => {});
    const offKey = h.bridge.on("keydown", () => {});
    await flush();
    offMove();
    offMove(); // idempotent
    await flush();
    expect(h.children[0]?.types()).toEqual(["ping", "start"]);
    offKey();
    await h.bridge.whenStopped();
    await flush();
    expect(h.children[0]?.types()).toEqual(["ping", "start", "stop"]);
    // Graceful: the helper exits after `stopped`, so no kill signal is needed.
    expect(h.children[0]?.exited).toBe(true);
    expect(h.killed).toEqual([]);
    expect(h.bridge.getStatus()).toEqual({ state: "idle" });

    h.bridge.on("wheel", () => {});
    await flush();
    expect(h.spawns).toHaveLength(2);
    expect(h.bridge.getStatus().state).toBe("running");
  });

  it("stop timeout: a hung helper is killed anyway", async () => {
    const h = harness({
      script: (msg, child) => {
        if (msg.t === "ping") child.send({ t: "pong", version: "1.0.0", caps: [] });
        if (msg.t === "start") child.send({ t: "started", id: msg.id, ...STARTED });
        // never answers stop
      },
    });
    const off = h.bridge.on("mousemove", () => {});
    await flush();
    off();
    await flush();
    expect(h.killed).toEqual([]);
    expect(h.timers.pending()).toBeGreaterThan(0); // the CURSOR_STOP_TIMEOUT_MS request timer
    expect(CURSOR_STOP_TIMEOUT_MS).toBe(3000);
    h.timers.fireAll();
    await h.bridge.whenStopped();
    expect(h.killed).toEqual([1000]);
  });

  it("reports unavailable without spawning when manifest verification fails", async () => {
    const h = harness({ verify: async () => ({ ok: false, reason: "checksum mismatch" }) });
    const seen: unknown[] = [];
    h.bridge.on("mousemove", (e) => seen.push(e));
    await flush();
    expect(h.spawns).toHaveLength(0);
    expect(h.bridge.getStatus()).toEqual({ state: "unavailable", reason: "checksum mismatch" });
  });

  it("treats a throwing verifier like a failed verification", async () => {
    const h = harness({
      verify: async () => {
        throw new Error("EACCES");
      },
    });
    h.bridge.on("mousemove", () => {});
    await flush();
    expect(h.bridge.getStatus()).toEqual({ state: "unavailable", reason: "EACCES" });
  });

  it("reports the helper's start error and kills it", async () => {
    const h = harness({
      script: (msg, child) => {
        if (msg.t === "ping") child.send({ t: "pong", version: "1.0.0", caps: [] });
        if (msg.t === "start")
          child.send({
            t: "error",
            id: msg.id,
            code: "invalidState",
            message: "start while running",
          });
      },
    });
    h.bridge.on("mousemove", () => {});
    await flush();
    expect(h.bridge.getStatus()).toEqual({
      state: "unavailable",
      reason: "invalidState: start while running",
    });
    expect(h.killed).toEqual([1000]);
  });

  it("rejects an unexpected reply to start", async () => {
    const h = harness({
      script: (msg, child) => {
        if (msg.t === "ping") child.send({ t: "pong", version: "1.0.0", caps: [] });
        if (msg.t === "start") child.send({ t: "stopped", id: msg.id, samples: 0 });
      },
    });
    h.bridge.on("mousemove", () => {});
    await flush();
    expect(h.bridge.getStatus()).toMatchObject({ state: "unavailable" });
    expect(h.killed).toEqual([1000]);
  });

  it("marks a crash and ignores output from the dead helper", async () => {
    const h = harness();
    const moves: unknown[] = [];
    h.bridge.on("mousemove", (e) => moves.push(e));
    await flush();
    const child = h.children[0];
    child?.exit(6, "SIGABRT");
    await flush();
    expect(h.bridge.getStatus()).toMatchObject({ state: "crashed" });
    child?.send({ t: "move", tNs: 1, x: 1, y: 1, cursor: "arrow" });
    expect(moves).toEqual([]);
  });

  it("unsubscribing while the helper is still starting leaves no process behind", async () => {
    let pong: (() => void) | null = null;
    const h = harness({
      script: (msg, child) => {
        if (msg.t === "ping") pong = () => child.send({ t: "pong", version: "1.0.0", caps: [] });
        if (msg.t === "start") child.send({ t: "started", id: msg.id, ...STARTED });
      },
    });
    const off = h.bridge.on("mousemove", () => {});
    await flush();
    expect(h.bridge.getStatus().state).toBe("starting");
    off();
    await h.bridge.whenStopped();
    expect(h.killed).toEqual([1000]);
    (pong as (() => void) | null)?.();
    await flush();
    expect(h.bridge.getStatus()).toEqual({ state: "idle" });
    expect(h.children[0]?.types()).toEqual(["ping"]);
  });

  it("resubscribing during shutdown waits for the old helper before spawning", async () => {
    const h = harness();
    const off = h.bridge.on("mousemove", () => {});
    await flush();
    off();
    h.bridge.on("mousemove", () => {});
    await flush();
    expect(h.children[0]?.exited).toBe(true);
    expect(h.children[1]?.types()).toEqual(["ping", "start"]);
    expect(h.spawns).toHaveLength(2);
    expect(h.bridge.getStatus().state).toBe("running");
  });

  it("dispose drops listeners and stops the helper", async () => {
    const h = harness();
    const moves: unknown[] = [];
    h.bridge.on("mousemove", (e) => moves.push(e));
    await flush();
    const child = h.children[0];
    await h.bridge.dispose();
    expect(child?.types()).toEqual(["ping", "start", "stop"]);
    expect(child?.exited).toBe(true);
    child?.send({ t: "move", tNs: 1, x: 1, y: 1, cursor: "arrow" });
    expect(moves).toEqual([]);
  });
});

describe("CursorMonitorBridge event mapping", () => {
  async function running() {
    const h = harness();
    const events: [string, unknown][] = [];
    for (const type of ["mousemove", "mousedown", "mouseup", "keydown", "wheel"] as const) {
      h.bridge.on(type, (e) => events.push([type, e]));
    }
    await flush();
    const child = h.children[0];
    if (!child) throw new Error("no child");
    return { h, child, events };
  }

  it("maps move / click / scroll to uiohook-style events and tracks the cursor type", async () => {
    const { h, child, events } = await running();
    expect(h.bridge.cursorType()).toBe("arrow");
    child.send({ t: "move", tNs: 5, x: -1440.5, y: 20, cursor: "ibeam" }, true);
    child.send({ t: "click", tNs: 6, x: 3, y: 4, button: "left", phase: "down" });
    child.send({ t: "click", tNs: 7, x: 3, y: 4, button: "right", phase: "up" });
    child.send({ t: "click", tNs: 8, x: 3, y: 4, button: "middle", phase: "down" });
    child.send({ t: "scroll", tNs: 9, dx: 0, dy: -12 });
    expect(events).toEqual([
      ["mousemove", { x: -1440.5, y: 20 }],
      ["mousedown", { x: 3, y: 4, button: 0 }],
      ["mouseup", { x: 3, y: 4, button: 2 }],
      ["mousedown", { x: 3, y: 4, button: 1 }],
      ["wheel", { dx: 0, dy: -12 }],
    ]);
    expect(h.bridge.cursorType()).toBe("ibeam");
  });

  it("translates mac key codes + modifier mask and drops unmapped keys", async () => {
    const { child, events } = await running();
    child.send({ t: "key", tNs: 1, keyCode: 0x28, modifiers: 8 | 1 }); // ⇧⌘K
    child.send({ t: "key", tNs: 2, keyCode: 0x24, modifiers: 2 | 4 }); // ⌃⌥Return
    child.send({ t: "key", tNs: 3, keyCode: 0x0a, modifiers: 0 }); // ISO § — unmapped
    child.send({ t: "key", tNs: 4, keyCode: 0x7e, modifiers: 16 | 32 }); // fn+caps ↑
    expect(events).toEqual([
      ["keydown", { keycode: 0x25, shiftKey: true, ctrlKey: false, altKey: false, metaKey: true }],
      ["keydown", { keycode: 0x1c, shiftKey: false, ctrlKey: true, altKey: true, metaKey: false }],
      [
        "keydown",
        { keycode: 0xe048, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
      ],
    ]);
  });

  it("uses an injected key map (e.g. a Windows helper)", async () => {
    const h = harness({ mapKeyCode: (code) => (code === 65 ? 0x1e : null) });
    const keys: unknown[] = [];
    h.bridge.on("keydown", (e) => keys.push(e));
    await flush();
    h.children[0]?.send({ t: "key", tNs: 1, keyCode: 65, modifiers: 0 });
    h.children[0]?.send({ t: "key", tNs: 1, keyCode: 66, modifiers: 0 });
    expect(keys).toEqual([
      { keycode: 0x1e, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
    ]);
  });

  it("ignores invalid or unknown lines and logs them", async () => {
    const { h, child, events } = await running();
    child.sendRaw("not json\n");
    child.send({ t: "key", tNs: 1, keyCode: 1, modifiers: 64 }); // modifier out of range
    child.send({ t: "move", tNs: 1, x: 0, y: 0, cursor: "wait" }); // unknown cursor
    child.send({ t: "click", tNs: 1, x: 0, y: 0, button: "back", phase: "down" });
    child.send({ t: "error", code: "exportFailed", message: "disk" });
    child.send({ t: "cursorsExported", dir: "/c", files: [] });
    expect(events).toEqual([]);
    expect(h.logs.filter((l) => l.includes("ignored invalid"))).toHaveLength(3);
    expect(h.logs.some((l) => l.includes("helper error exportFailed"))).toBe(true);
  });

  it("isolates a throwing listener from the others", async () => {
    const h = harness();
    const seen: unknown[] = [];
    h.bridge.on("mousemove", () => {
      throw new Error("boom");
    });
    h.bridge.on("mousemove", (e) => seen.push(e));
    await flush();
    h.children[0]?.send({ t: "move", tNs: 1, x: 1, y: 2, cursor: "hand" });
    expect(seen).toEqual([{ x: 1, y: 2 }]);
    expect(h.logs.some((l) => l.includes("mousemove listener threw: boom"))).toBe(true);
  });

  it("the same function subscribed twice counts once", async () => {
    const h = harness();
    const seen: unknown[] = [];
    const fn = (e: unknown) => seen.push(e);
    const off1 = h.bridge.on("mousemove", fn);
    h.bridge.on("mousemove", fn);
    await flush();
    h.children[0]?.send({ t: "move", tNs: 1, x: 1, y: 2, cursor: "arrow" });
    expect(seen).toHaveLength(1);
    off1();
    await h.bridge.whenStopped();
    expect(h.children[0]?.exited).toBe(true);
  });
});

describe("CursorMonitorBridge feeding TelemetryCollector", () => {
  it("produces telemetry with cursor types, DOM buttons and the typing privacy filter", async () => {
    const h = harness();
    let now = 1_000_000_000n;
    const collector = new TelemetryCollector({
      hook: h.bridge,
      nowNs: () => now,
      origin: "display",
      bounds: { x: 0, y: 0, width: 1000, height: 500 },
      scaleFactor: 2,
      cursorType: () => h.bridge.cursorType(),
    });
    collector.start();
    await flush();
    const child = h.children[0];
    if (!child) throw new Error("no child");
    expect(h.bridge.getStatus().state).toBe("running");

    now += 10_000_000n;
    child.send({ t: "move", tNs: 0, x: 500, y: 250, cursor: "hand" });
    now += 20_000_000n;
    child.send({ t: "click", tNs: 0, x: 500, y: 250, button: "right", phase: "down" });
    now += 1_000_000n;
    child.send({ t: "key", tNs: 0, keyCode: 0x28, modifiers: 0 }); // plain "k" → dropped
    now += 1_000_000n;
    child.send({ t: "key", tNs: 0, keyCode: 0x28, modifiers: 8 }); // ⌘K → kept
    now += 1_000_000n;
    child.send({ t: "scroll", tNs: 0, dx: 1, dy: 2 });

    collector.stop();
    await h.bridge.whenStopped();
    expect(child.exited).toBe(true);
    expect(child.types()).toEqual(["ping", "start", "stop"]);

    const file = collector.finalize({ firstFramePtsNs: 1_000_000_000n, keepTypedText: false });
    expect(file.points).toEqual([[10, 0.5, 0.5, "hand"]]);
    expect(file.clicks).toEqual([[30, 0.5, 0.5, 2, "down"]]);
    expect(file.keys).toEqual([[32, 0x25, 8]]);
    expect(file.scrolls).toEqual([[33, 1, 2]]);
  });
});
