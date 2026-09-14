/**
 * Stage 2 — Candidate events (ENGINEERING_SPEC §8.2).
 * Each detector turns cleaned telemetry into zero or more candidate zoom
 * anchors. A candidate has a time, a focus point (0..1), a raw strength, and a
 * kind used later to build the human-readable reason.
 */

import { cursorAt } from "./normalize.js";
import { clamp } from "./util.js";
import type { Sample } from "./normalize.js";
import type { Telemetry, TelemetryClick } from "./types.js";

export type CandidateKind = "click" | "typing" | "dwell" | "scroll" | "selection";

export interface Candidate {
  readonly tMs: number;
  readonly x: number;
  readonly y: number;
  readonly strength: number;
  readonly kind: CandidateKind;
  /** For selection candidates: the drag span end time. */
  readonly endMs?: number;
}

const DOUBLE_CLICK_MS = 350;
const TYPING_BURST_MIN = 3;
const TYPING_BURST_WINDOW_MS = 1500;
const DWELL_SPEED_MAX = 0.02; // units/s
const DWELL_MIN_MS = 450;
const DWELL_MAX_MS = 2600;
const SCROLL_BURST_GAP_MS = 400;
const SELECTION_MAX_VERT = 0.08; // small vertical movement threshold

/** Click-down candidates. Handles double-click and right-click strengths. */
export function clickCandidates(clicks: readonly TelemetryClick[]): Candidate[] {
  const downs = clicks
    .filter((c) => c[4] === "down")
    .slice()
    .sort((a, b) => a[0] - b[0]);
  const out: Candidate[] = [];
  for (let i = 0; i < downs.length; i++) {
    const c = downs[i];
    if (c === undefined) continue;
    const tMs = c[0];
    const x = c[1];
    const y = c[2];
    const button = c[3];
    let strength: number;
    if (button === "right") {
      strength = 0.6;
    } else {
      // double-click: a previous left-down within DOUBLE_CLICK_MS nearby
      const prev = downs[i - 1];
      const isDouble =
        prev !== undefined &&
        prev[3] !== "right" &&
        tMs - prev[0] <= DOUBLE_CLICK_MS &&
        Math.abs(prev[1] - x) < 0.05 &&
        Math.abs(prev[2] - y) < 0.05;
      strength = isDouble ? 1.2 : 1.0;
    }
    out.push({ tMs, x, y, strength, kind: "click" });
  }
  return out;
}

/**
 * Typing bursts: >=3 keys within 1.5s → one candidate at burst start, focused
 * at the last click position at/ before that time (fallback: cursor).
 */
export function typingCandidates(
  telemetry: Telemetry,
  samples: readonly Sample[],
): Candidate[] {
  const keys = telemetry.keys.slice().sort((a, b) => a[0] - b[0]);
  const downClicks = telemetry.clicks
    .filter((c) => c[4] === "down")
    .slice()
    .sort((a, b) => a[0] - b[0]);
  const out: Candidate[] = [];

  let i = 0;
  while (i < keys.length) {
    // grow a burst window
    let j = i;
    while (
      j + 1 < keys.length &&
      (keys[j + 1]?.[0] ?? Infinity) - (keys[i]?.[0] ?? 0) <= TYPING_BURST_WINDOW_MS
    ) {
      j++;
    }
    const count = j - i + 1;
    const startKey = keys[i];
    if (count >= TYPING_BURST_MIN && startKey !== undefined) {
      const startMs = startKey[0];
      const focus = lastClickBefore(downClicks, startMs) ?? cursorAt(samples, startMs);
      if (focus !== undefined) {
        out.push({ tMs: startMs, x: focus.x, y: focus.y, strength: 0.9, kind: "typing" });
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

function lastClickBefore(
  downClicks: readonly TelemetryClick[],
  tMs: number,
): { x: number; y: number } | undefined {
  let found: { x: number; y: number } | undefined;
  for (const c of downClicks) {
    if (c[0] <= tMs) found = { x: c[1], y: c[2] };
    else break;
  }
  return found;
}

/** Dwell: cursor speed < 0.02 units/s sustained for [450ms, 2600ms]. */
export function dwellCandidates(samples: readonly Sample[]): Candidate[] {
  const out: Candidate[] = [];
  let runStart = -1;
  let sx = 0;
  let sy = 0;
  let n = 0;

  const flush = (endIdx: number) => {
    if (runStart < 0 || n === 0) return;
    const startS = samples[runStart];
    const endS = samples[endIdx];
    if (startS === undefined || endS === undefined) return;
    const durMs = endS.tMs - startS.tMs;
    if (durMs >= DWELL_MIN_MS && durMs <= DWELL_MAX_MS) {
      // dwell-duration factor: 0 at min, 1 at max
      const factor = clamp((durMs - DWELL_MIN_MS) / (DWELL_MAX_MS - DWELL_MIN_MS), 0, 1);
      const midMs = startS.tMs + durMs / 2;
      out.push({
        tMs: midMs,
        x: sx / n,
        y: sy / n,
        strength: 0.5 * factor,
        kind: "dwell",
      });
    }
  };

  for (let k = 0; k < samples.length; k++) {
    const s = samples[k];
    if (s === undefined) continue;
    if (s.speed < DWELL_SPEED_MAX) {
      if (runStart < 0) {
        runStart = k;
        sx = 0;
        sy = 0;
        n = 0;
      }
      sx += s.x;
      sy += s.y;
      n++;
    } else {
      if (runStart >= 0) flush(k - 1 >= 0 ? k - 1 : runStart);
      runStart = -1;
    }
  }
  if (runStart >= 0) flush(samples.length - 1);
  return out;
}

/** Scroll bursts: scrolls clustered with <=400ms gaps → candidate at cursor. */
export function scrollCandidates(
  telemetry: Telemetry,
  samples: readonly Sample[],
): Candidate[] {
  const scrolls = telemetry.scrolls.slice().sort((a, b) => a[0] - b[0]);
  const out: Candidate[] = [];
  let i = 0;
  while (i < scrolls.length) {
    let j = i;
    while (
      j + 1 < scrolls.length &&
      (scrolls[j + 1]?.[0] ?? Infinity) - (scrolls[j]?.[0] ?? 0) <= SCROLL_BURST_GAP_MS
    ) {
      j++;
    }
    const first = scrolls[i];
    const last = scrolls[j];
    if (first !== undefined && last !== undefined) {
      const midMs = (first[0] + last[0]) / 2;
      const focus = cursorAt(samples, midMs);
      if (focus !== undefined) {
        out.push({ tMs: first[0], x: focus.x, y: focus.y, strength: 0.4, kind: "scroll" });
      }
    }
    i = j + 1;
  }
  return out;
}

/**
 * Text-selection: a left down → drag → up with small vertical movement spans a
 * selection. Candidate is placed at the drag start, mid-point focus, and
 * carries `endMs` for the drag span.
 */
export function selectionCandidates(clicks: readonly TelemetryClick[]): Candidate[] {
  const sorted = clicks.slice().sort((a, b) => a[0] - b[0]);
  const out: Candidate[] = [];
  let openDown: TelemetryClick | undefined;
  for (const c of sorted) {
    if (c[3] !== "left") {
      if (c[4] === "down") openDown = undefined;
      continue;
    }
    if (c[4] === "down") {
      openDown = c;
    } else if (c[4] === "up" && openDown !== undefined) {
      const downT = openDown[0];
      const upT = c[0];
      const dx = c[1] - openDown[1];
      const dy = c[2] - openDown[2];
      const horiz = Math.abs(dx);
      const vert = Math.abs(dy);
      // must move (drag), mostly horizontal, small vertical
      if (upT > downT && horiz > 0.03 && vert <= SELECTION_MAX_VERT) {
        out.push({
          tMs: downT,
          x: (openDown[1] + c[1]) / 2,
          y: (openDown[2] + c[2]) / 2,
          strength: 0.8,
          kind: "selection",
          endMs: upT,
        });
      }
      openDown = undefined;
    }
  }
  return out;
}

/** Run all enabled detectors and return the merged candidate list. */
export function collectCandidates(
  telemetry: Telemetry,
  samples: readonly Sample[],
  options: { zoomOnClicks: boolean; zoomOnTyping: boolean },
): Candidate[] {
  const out: Candidate[] = [];
  if (options.zoomOnClicks) {
    out.push(...clickCandidates(telemetry.clicks));
    out.push(...selectionCandidates(telemetry.clicks));
  }
  if (options.zoomOnTyping) {
    out.push(...typingCandidates(telemetry, samples));
  }
  out.push(...dwellCandidates(samples));
  out.push(...scrollCandidates(telemetry, samples));
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}
