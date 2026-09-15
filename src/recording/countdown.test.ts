import fc from "fast-check";
import {
  IDLE_COUNTDOWN,
  cancelCountdown,
  countdownDisplayValue,
  countdownKey,
  countdownProgress,
  startCountdown,
  tickCountdown,
} from "./countdown";

describe("countdown", () => {
  it("0 seconds completes immediately", () => {
    const s = startCountdown(0, 100);
    expect(s.status).toBe("done");
    expect(countdownDisplayValue(s)).toBeUndefined();
    expect(countdownProgress(s)).toBe(1);
  });

  it("unsupported durations fall back to 0", () => {
    expect(startCountdown(4, 0).status).toBe("done");
    expect(startCountdown(Number.NaN, 0).status).toBe("done");
  });

  it.each([3, 5, 10])("counts %i → 1 then done", (seconds) => {
    let s = startCountdown(seconds, 1000);
    expect(countdownDisplayValue(s)).toBe(seconds);
    s = tickCountdown(s, 1001);
    expect(countdownDisplayValue(s)).toBe(seconds);
    s = tickCountdown(s, 2000);
    expect(countdownDisplayValue(s)).toBe(seconds - 1);
    s = tickCountdown(s, 1000 + seconds * 1000 - 1);
    expect(countdownDisplayValue(s)).toBe(1);
    s = tickCountdown(s, 1000 + seconds * 1000);
    expect(s.status).toBe("done");
    expect(countdownDisplayValue(s)).toBeUndefined();
  });

  it("time running backwards is a no-op; NaN is ignored", () => {
    let s = startCountdown(3, 1000);
    s = tickCountdown(s, 2500);
    expect(tickCountdown(s, 1200)).toBe(s);
    expect(tickCountdown(s, Number.NaN)).toBe(s);
  });

  it("Esc cancels while counting; other keys and other states are ignored", () => {
    const s = startCountdown(5, 0);
    expect(countdownKey(s, "Enter")).toBe(s);
    const c = countdownKey(s, "Escape");
    expect(c.status).toBe("cancelled");
    expect(tickCountdown(c, 99_999)).toBe(c);
    const done = startCountdown(0, 0);
    expect(cancelCountdown(done)).toBe(done);
    expect(cancelCountdown(IDLE_COUNTDOWN)).toBe(IDLE_COUNTDOWN);
  });

  it("property: remaining never increases, value within [1, total], ends done", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(3, 5, 10),
        fc.array(fc.integer({ min: -2000, max: 3000 }), { maxLength: 30 }),
        (seconds, deltas) => {
          let now = 0;
          let s = startCountdown(seconds, now);
          for (const d of deltas) {
            now += d;
            const next = tickCountdown(s, now);
            expect(next.remainingMs).toBeLessThanOrEqual(s.remainingMs);
            const v = countdownDisplayValue(next);
            if (next.status === "counting") {
              expect(v).toBeGreaterThanOrEqual(1);
              expect(v).toBeLessThanOrEqual(seconds);
            }
            const p = countdownProgress(next);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
            s = next;
          }
          expect(tickCountdown(s, Math.max(now, 0) + seconds * 1000).status).toBe("done");
        },
      ),
    );
  });
});
