import { describe, expect, it } from "vitest";
import {
  type HudTransition,
  NO_SHIFT,
  growBounds,
  planShift,
  runHudTransition,
} from "./hudTransition";
import type { HudWindowPlan } from "./port";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

function plan(commitId: number): HudWindowPlan {
  return { commitId, previous: rect(440, 836, 560, 64), target: rect(570, 844, 300, 48) };
}

function env(log: string[], opts: { applied?: boolean; failCommit?: boolean } = {}) {
  const resize = new Set<() => void>();
  let releaseFrames: (() => void) | null = null;
  return {
    resize,
    releaseFrames: () => releaseFrames?.(),
    value: {
      windows: {
        commitHudLayout: async (id: number) => {
          log.push(`commit:${id}`);
          if (opts.failCommit) throw new Error("gone");
          return opts.applied ?? true;
        },
      },
      frames: () =>
        new Promise<void>((resolve) => {
          log.push("frames");
          releaseFrames = resolve;
        }),
      onResize: (l: () => void) => {
        resize.add(l);
        return () => resize.delete(l);
      },
    },
  };
}

function transition(log: string[], id: number, extra: Partial<HudTransition<HudWindowPlan>> = {}) {
  return {
    prepare: async () => {
      log.push(`prepare:${id}`);
      return plan(id);
    },
    apply: (p: HudWindowPlan | null) => log.push(`apply:${p?.commitId ?? "none"}`),
    settle: (p: HudWindowPlan) => log.push(`settle:${p.commitId}`),
    ...extra,
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("planShift", () => {
  it("is the target origin relative to the current window, ignoring non-finite input", () => {
    expect(planShift(plan(1))).toEqual({ x: 130, y: 8 });
    expect(planShift({ previous: rect(0, 0, 1, 1), target: rect(Number.NaN, 5, 1, 1) })).toEqual({
      x: 0,
      y: 5,
    });
    expect(NO_SHIFT).toEqual({ x: 0, y: 0 });
  });
});

describe("growBounds", () => {
  it("is null when the target fits inside the window, else the union of both", () => {
    expect(growBounds(rect(0, 0, 620, 352), rect(0, 288, 620, 64))).toBeNull();
    expect(growBounds(rect(0, 288, 620, 64), rect(0, 0, 620, 352))).toEqual(rect(0, 0, 620, 352));
    // Wider but shorter (interrupted card → pre-record pill): grows to fit both.
    expect(growBounds(rect(140, 0, 340, 84), rect(0, 10, 620, 64))).toEqual(rect(0, 0, 620, 84));
  });
});

describe("runHudTransition — grow before render, shrink after render", () => {
  function growEnv(log: string[]) {
    const e = env(log);
    const resize = e.resize;
    e.value.windows.commitHudLayout = async (id: number, stage?: "grow" | "final") => {
      log.push(stage === "grow" ? `grow:${id}` : `commit:${id}`);
      // setBounds fires the window resize before the reply is handled.
      for (const l of [...resize]) l();
      return true;
    };
    return e;
  }

  it("grows the window, holds the old content in place, then renders the bigger layout", async () => {
    const log: string[] = [];
    const e = growEnv(log);
    const previous = rect(440, 836, 340, 48);
    const target = rect(440, 644, 340, 240);
    const applied: HudWindowPlan[] = [];
    const done = runHudTransition(e.value, {
      prepare: async () => ({ commitId: 1, previous, target }),
      hold: (s) => log.push(`hold:${s.x},${s.y}`),
      apply: (p) => {
        if (p) applied.push(p);
        log.push("apply");
      },
      settle: () => log.push("settle"),
    });
    await expect(done).resolves.toBe(true);
    // Grown straight to the target: no paint wait before the (no-op) final commit.
    expect(log).toEqual(["grow:1", "hold:0,192", "apply", "commit:1", "settle"]);
    expect(applied[0]?.previous).toEqual(target);
    expect(planShift(applied[0] ?? plan(0))).toEqual(NO_SHIFT);
  });

  it("mixed change: grows to the union, renders, waits for paint, then shrinks", async () => {
    const log: string[] = [];
    const e = growEnv(log);
    const previous = rect(140, 0, 340, 84);
    const target = rect(0, 10, 620, 64);
    const done = runHudTransition(e.value, {
      prepare: async () => ({ commitId: 2, previous, target }),
      hold: (s) => log.push(`hold:${s.x},${s.y}`),
      apply: (p) => log.push(`apply:${p ? JSON.stringify(planShift(p)) : "none"}`),
      settle: () => log.push("settle"),
    });
    await flush();
    expect(log).toEqual(["grow:2", "hold:140,0", 'apply:{"x":0,"y":10}', "frames"]);
    e.releaseFrames();
    await done;
    expect(log.slice(-2)).toEqual(["commit:2", "settle"]);
  });

  it("a shrink renders first and never grows", async () => {
    const log: string[] = [];
    const e = growEnv(log);
    const done = runHudTransition(e.value, transition(log, 3));
    await flush();
    expect(log).toEqual(["prepare:3", "apply:3", "frames"]);
    e.releaseFrames();
    await done;
    expect(log.some((l) => l.startsWith("grow"))).toBe(false);
  });

  it("a refused grow falls back to the in-place layout", async () => {
    const log: string[] = [];
    const e = env(log);
    e.value.windows.commitHudLayout = async (id: number, stage?: "grow" | "final") => {
      log.push(stage === "grow" ? `grow:${id}` : `commit:${id}`);
      return stage !== "grow";
    };
    const previous = rect(0, 100, 36, 36);
    const target = rect(0, 94, 340, 48);
    const shifts: string[] = [];
    const done = runHudTransition(e.value, {
      prepare: async () => ({ commitId: 4, previous, target }),
      hold: () => log.push("hold"),
      apply: (p) => shifts.push(p ? JSON.stringify(planShift(p)) : "none"),
      settle: () => {},
    });
    await flush();
    e.releaseFrames();
    await done;
    expect(log).toEqual(["grow:4", "frames", "commit:4"]);
    expect(shifts).toEqual(['{"x":0,"y":-6}']);
  });
});

describe("runHudTransition", () => {
  it("prepares, applies, waits for paint, then commits and settles", async () => {
    const log: string[] = [];
    const e = env(log);
    const done = runHudTransition(e.value, transition(log, 1));
    await flush();
    expect(log).toEqual(["prepare:1", "apply:1", "frames"]);
    e.releaseFrames();
    await expect(done).resolves.toBe(true);
    expect(log).toEqual(["prepare:1", "apply:1", "frames", "commit:1", "settle:1"]);
    expect(e.resize.size).toBe(0);
  });

  it("settles on the window resize before the commit reply, exactly once", async () => {
    const log: string[] = [];
    const e = env(log);
    const done = runHudTransition(e.value, transition(log, 1));
    await flush();
    e.releaseFrames();
    await flush();
    // The commit's setBounds resized the window before its reply was handled.
    for (const l of [...e.resize]) l();
    await done;
    expect(log.filter((l) => l.startsWith("settle"))).toEqual(["settle:1"]);
  });

  it("runs transitions on one port one after another", async () => {
    const log: string[] = [];
    const e = env(log);
    const first = runHudTransition(e.value, transition(log, 1));
    const second = runHudTransition(e.value, transition(log, 2));
    await flush();
    expect(log).toEqual(["prepare:1", "apply:1", "frames"]);
    e.releaseFrames();
    await first;
    await flush();
    expect(log.slice(-3)).toEqual(["prepare:2", "apply:2", "frames"]);
    e.releaseFrames();
    await second;
    expect(log.at(-1)).toBe("settle:2");
  });

  it("skips superseded transitions and handles no HUD, prepare and commit failures", async () => {
    const log: string[] = [];
    const e = env(log, { failCommit: true });
    await expect(
      runHudTransition(e.value, transition(log, 1, { isCurrent: () => false })),
    ).resolves.toBe(false);
    expect(log).toEqual([]);

    await expect(
      runHudTransition(e.value, transition(log, 2, { prepare: async () => null })),
    ).resolves.toBe(false);
    await expect(
      runHudTransition(
        e.value,
        transition(log, 3, {
          prepare: async () => {
            throw new Error("ipc");
          },
        }),
      ),
    ).resolves.toBe(false);
    expect(log).toEqual(["apply:none", "apply:none"]);

    const failing = runHudTransition(e.value, transition(log, 4));
    await flush();
    e.releaseFrames();
    await expect(failing).resolves.toBe(false);
    expect(log.slice(-2)).toEqual(["commit:4", "settle:4"]);
  });
});
