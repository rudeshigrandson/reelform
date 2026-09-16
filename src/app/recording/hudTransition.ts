import type { HudRect, HudWindowPlan, HudWindowsPort } from "./port";

/**
 * Flicker-free HUD window changes (SPEC §5.7). Moving the window and laying
 * out at different times made the pill jump or show clipped for a frame, so
 * every change is a handshake where the window always fits what is drawn:
 *
 * 1. `prepare` — main computes the target bounds without moving the window.
 * 2. Grow first — when the target does not fit inside the current window,
 *    `commitHudLayout(id, "grow")` grows it to the union of both rects. The old
 *    content stays in place through `hold` (a shift applied on the window's
 *    `resize` event, the frame the new bounds paint).
 * 3. `apply` — the renderer lays out for the target, shifted by
 *    {@link planShift} against the (possibly grown) window so everything stays
 *    where it is on screen (collapse: the pill is drawn at its collapsed spot
 *    inside the still-large window).
 * 4. Two animation frames, so that layout is painted (skipped when the grow
 *    already produced the target bounds).
 * 5. `commitHudLayout(id)` — main runs `setBounds` (shrink); the shift is
 *    dropped (`settle`) on the window's `resize` event or when the commit
 *    resolves at the latest.
 *
 * Bigger content is thus only rendered into a window that already fits it, and
 * a window only shrinks after smaller content has painted.
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

/**
 * Bounds the window must grow to before content for `target` is rendered, or
 * null when `target` already fits inside `previous` (a shrink or a move within).
 */
export function growBounds(previous: HudRect, target: HudRect): HudRect | null {
  const fits =
    target.x >= previous.x &&
    target.y >= previous.y &&
    target.x + target.width <= previous.x + previous.width &&
    target.y + target.height <= previous.y + previous.height;
  if (fits) return null;
  const x = Math.min(previous.x, target.x);
  const y = Math.min(previous.y, target.y);
  return {
    x,
    y,
    width: Math.max(previous.x + previous.width, target.x + target.width) - x,
    height: Math.max(previous.y + previous.height, target.y + target.height) - y,
  };
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
  /**
   * The window grew before `apply`: draw the content currently on screen at
   * `shift` so it does not move. Called synchronously (flush it) at most once.
   */
  hold?: ((shift: Shift) => void) | undefined;
  /**
   * Lay out for the plan (shifted by `planShift(plan)`; after a grow,
   * `plan.previous` is the grown window). `null`: no HUD or the prepare failed.
   */
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

const sameRect = (a: HudRect, b: HudRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Grow the window first; resolves the grown bounds, or null when it did not grow. */
async function grow<P extends HudWindowPlan>(
  env: HudTransitionEnv,
  t: HudTransition<P>,
  plan: P,
  grown: HudRect,
): Promise<HudRect | null> {
  let held = false;
  const hold = () => {
    if (held) return;
    held = true;
    t.hold?.(planShift({ previous: grown, target: plan.previous }));
  };
  const off = (env.onResize ?? windowResize)(hold);
  try {
    if (!(await env.windows.commitHudLayout(plan.commitId, "grow"))) return null;
  } catch {
    return null;
  } finally {
    off();
  }
  hold();
  return grown;
}

async function runNow<P extends HudWindowPlan>(
  env: HudTransitionEnv,
  t: HudTransition<P>,
): Promise<boolean> {
  if (t.isCurrent && !t.isCurrent()) return false;
  let prepared: P | null;
  try {
    prepared = await t.prepare();
  } catch {
    prepared = null;
  }
  if (!prepared) {
    t.apply(null);
    return false;
  }
  const growTo = growBounds(prepared.previous, prepared.target);
  const grown = growTo ? await grow(env, t, prepared, growTo) : null;
  const ready: P = grown ? { ...prepared, previous: grown } : prepared;
  t.apply(ready);
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    t.settle(ready);
  };
  // Grown straight to the target: nothing left to move, no paint to wait for.
  if (!grown || !sameRect(grown, ready.target)) await (env.frames ?? waitForPaint)();
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
