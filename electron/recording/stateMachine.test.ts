import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type RecordingAction,
  type RecordingState,
  TERMINAL_STATES,
  isActive,
  isCapturing,
  transition,
} from "./stateMachine";

const ACTIONS: RecordingAction[] = [
  "prepare",
  "prepareFailed",
  "prepared",
  "countdownDone",
  "startFailed",
  "pause",
  "resume",
  "stop",
  "finalized",
  "discard",
  "interrupt",
];

describe("transition", () => {
  it("walks the happy path", () => {
    const path: [RecordingAction, RecordingState][] = [
      ["prepare", "preparing"],
      ["prepared", "countdown"],
      ["countdownDone", "recording"],
      ["pause", "paused"],
      ["resume", "recording"],
      ["stop", "finalizing"],
      ["finalized", "done"],
    ];
    let s: RecordingState = "idle";
    for (const [a, expected] of path) {
      const next = transition(s, a);
      expect(next).toBe(expected);
      s = next as RecordingState;
    }
  });

  it("rejects illegal actions", () => {
    expect(transition("idle", "pause")).toBeNull();
    expect(transition("recording", "resume")).toBeNull();
    expect(transition("paused", "pause")).toBeNull();
    expect(transition("countdown", "stop")).toBeNull();
    expect(transition("countdown", "interrupt")).toBeNull();
    expect(transition("interrupted", "finalized")).toBeNull();
  });

  it("interruption from capture and finalizing keeps a discard escape hatch", () => {
    expect(transition("paused", "interrupt")).toBe("interrupted");
    expect(transition("finalizing", "interrupt")).toBe("interrupted");
    expect(transition("interrupted", "discard")).toBe("discarded");
  });

  it("property: random action sequences stay within the graph invariants", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ACTIONS), { maxLength: 40 }), (actions) => {
        let s: RecordingState = "idle";
        let prev: RecordingState = s;
        for (const a of actions) {
          const next = transition(s, a);
          if (next === null) continue;
          prev = s;
          s = next;
          if (s === "paused") expect(prev).toBe("recording");
          if (s === "finalizing") expect(["recording", "paused"]).toContain(prev);
          if (s === "done") expect(prev).toBe("finalizing");
          if (s === "recording") expect(["countdown", "paused"]).toContain(prev);
          // done/discarded absorb everything
          if (prev === "done" || prev === "discarded") throw new Error("left an absorbing state");
        }
        expect(isActive(s) && TERMINAL_STATES.includes(s)).toBe(false);
      }),
    );
  });

  it("isActive / isCapturing", () => {
    expect(isActive("idle")).toBe(false);
    expect(isActive("countdown")).toBe(true);
    expect(isActive("finalizing")).toBe(true);
    expect(isActive("interrupted")).toBe(false);
    expect(isCapturing("paused")).toBe(true);
    expect(isCapturing("finalizing")).toBe(false);
  });
});
