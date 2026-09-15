import { describe, expect, it } from "vitest";
import { type HudTransition, NO_SHIFT, planShift, runHudTransition } from "./hudTransition";
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
