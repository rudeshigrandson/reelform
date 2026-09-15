import type { HudWindowPlan, HudWindowsPort } from "./port";

/**
 * Flicker-free HUD window changes (SPEC §5.7). Moving the window first and
 * laying out after the IPC reply made the pill jump for a frame, so every
 * change is a handshake:
 *
 * 1. `prepare` — main computes the target bounds without moving the window.
 * 2. `apply` — the renderer lays out for the target, shifted by
 *    {@link planShift} so everything stays where it is on screen while the
 *    window still has its old bounds (collapse: the pill is drawn at its
 *    collapsed spot inside the still-large window).
 * 3. Two animation frames, so that layout is painted.
 * 4. `commitHudLayout` — main runs `setBounds`; the shift is dropped
 *    (`settle`) on the window's `resize` event — the same frame the new bounds
 *    paint — or when the commit resolves at the latest.
 *
 * Transitions on one HUD port run strictly one after another, so a prepare is
 * never replaced by another before its commit.
 */

export type FrameWait = () => Promise<void>;
export type ResizeSubscribe = (listener: () => void) => () => void;

export interface Shift {
  x: number;
  y: number;
}

export const NO_SHIFT: Shift = { x: 0, y: 0 };

/** Two animation frames (the first schedules paint, the second runs after it). */
export const waitForPaint: FrameWait = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

export const windowResize: ResizeSubscribe = (listener) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

/** Where content laid out for `target` must be drawn while the window is still at `previous`. */
export function planShift(plan: Pick<HudWindowPlan, "previous" | "target">): Shift {
  const d = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : 0);
  return { x: d(plan.target.x, plan.previous.x), y: d(plan.target.y, plan.previous.y) };
}

export interface HudTransitionEnv {
  windows: Pick<HudWindowsPort, "commitHudLayout">;
  frames?: FrameWait | undefined;
  onResize?: ResizeSubscribe | undefined;
}

export interface HudTransition<P extends HudWindowPlan> {
  /** Still wanted? Checked before preparing (a newer request may have superseded it). */
  isCurrent?: (() => boolean) | undefined;
  prepare: () => Promise<P | null>;
  /** Lay out for the plan (shifted). `null`: no HUD or the prepare failed. */
  apply: (plan: P | null) => void;
  /** The window moved: drop the shift. Called exactly once per applied plan. */
  settle: (plan: P) => void;
}

const queues = new WeakMap<object, Promise<unknown>>();

/** Run one handshake after any pending one on the same port; resolves whether main applied it. */
export function runHudTransition<P extends HudWindowPlan>(
  env: HudTransitionEnv,
  transition: HudTransition<P>,
): Promise<boolean> {
  const previous = queues.get(env.windows) ?? Promise.resolve();
  const run = previous.then(() => runNow(env, transition));
  queues.set(
    env.windows,
    run.catch(() => false),
  );
  return run;
}

async function runNow<P extends HudWindowPlan>(
  env: HudTransitionEnv,
  t: HudTransition<P>,
): Promise<boolean> {
  if (t.isCurrent && !t.isCurrent()) return false;
  let plan: P | null;
  try {
    plan = await t.prepare();
  } catch {
    plan = null;
  }
  t.apply(plan);
  if (!plan) return false;
  const ready = plan;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    t.settle(ready);
  };
  await (env.frames ?? waitForPaint)();
  const off = (env.onResize ?? windowResize)(settle);
  try {
    return await env.windows.commitHudLayout(ready.commitId);
  } catch {
    return false;
  } finally {
    off();
    settle();
  }
}
