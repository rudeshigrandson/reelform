/**
 * Pre-record countdown (§5.6, §5.7; UI guide S08) as pure state. Time is
 * injected: callers pass a monotonic `nowMs` on every transition.
 */

export const COUNTDOWN_OPTIONS = [0, 3, 5, 10] as const;
export type CountdownSeconds = (typeof COUNTDOWN_OPTIONS)[number];

export type CountdownStatus = "idle" | "counting" | "done" | "cancelled";

export interface CountdownState {
  status: CountdownStatus;
  totalMs: number;
  startedAtMs: number;
  remainingMs: number;
}

export const IDLE_COUNTDOWN: CountdownState = {
  status: "idle",
  totalMs: 0,
  startedAtMs: 0,
  remainingMs: 0,
};

export function isCountdownSeconds(v: number): v is CountdownSeconds {
  return (COUNTDOWN_OPTIONS as readonly number[]).includes(v);
}

/** Begin counting. Unsupported values fall back to 0; 0 completes immediately. */
export function startCountdown(seconds: number, nowMs: number): CountdownState {
  const s = isCountdownSeconds(seconds) ? seconds : 0;
  const totalMs = s * 1000;
  const start = Number.isFinite(nowMs) ? nowMs : 0;
  if (totalMs === 0) return { status: "done", totalMs: 0, startedAtMs: start, remainingMs: 0 };
  return { status: "counting", totalMs, startedAtMs: start, remainingMs: totalMs };
}

/** Advance to `nowMs`. Time never runs backwards (an earlier `nowMs` is a no-op). */
export function tickCountdown(state: CountdownState, nowMs: number): CountdownState {
  if (state.status !== "counting" || !Number.isFinite(nowMs)) return state;
  const remaining = Math.max(0, state.totalMs - Math.max(0, nowMs - state.startedAtMs));
  const remainingMs = Math.min(state.remainingMs, remaining);
  if (remainingMs === 0) return { ...state, status: "done", remainingMs: 0 };
  if (remainingMs === state.remainingMs) return state;
  return { ...state, remainingMs };
}

/** Esc (or any cancel) during counting. */
export function cancelCountdown(state: CountdownState): CountdownState {
  return state.status === "counting" ? { ...state, status: "cancelled" } : state;
}

/** Keyboard handling: Escape cancels while counting; other keys are ignored. */
export function countdownKey(state: CountdownState, key: string): CountdownState {
  return key === "Escape" || key === "Esc" ? cancelCountdown(state) : state;
}

/** Numeral to draw: 3, 2, 1 while counting; undefined otherwise (the "Go" frame). */
export function countdownDisplayValue(state: CountdownState): number | undefined {
  if (state.status !== "counting") return undefined;
  return Math.max(1, Math.ceil(state.remainingMs / 1000));
}

/** Ring progress 0..1 across the whole countdown. */
export function countdownProgress(state: CountdownState): number {
  if (state.status === "done") return 1;
  if (state.totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - state.remainingMs / state.totalMs));
}
