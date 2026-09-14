// One-euro filter (1€ filter) — adaptive low-pass filter for noisy signals.
//
// Reference: Casiez, Roussel, Vogel, "1€ Filter: A Simple Speed-based
// Low-pass Filter for Noisy Input in Interactive Systems" (CHI 2012).
//
// The filter is a first-order low-pass whose cutoff frequency adapts to the
// signal's rate of change: it uses a low cutoff (heavy smoothing) when the
// signal is slow, and raises the cutoff (less lag) when the signal moves fast.
// This gives a good jitter-vs-lag tradeoff for pointer motion.
//
// All math is pure and deterministic. Time is expressed in seconds internally.

/** Configuration for a one-euro filter. Cutoffs are in Hz. */
export interface OneEuroConfig {
  /** Minimum cutoff frequency (Hz). Lower → smoother but laggier. */
  readonly minCutoff: number;
  /** Cutoff slope: how much velocity raises the cutoff. Higher → less lag on fast moves. */
  readonly beta: number;
  /** Cutoff (Hz) of the low-pass applied to the derivative estimate. */
  readonly dCutoff: number;
}

/**
 * Smoothing factor alpha for a first-order low-pass, given a cutoff frequency
 * (Hz) and a sampling period te (seconds). Derived from the RC low-pass:
 *   tau = 1 / (2*pi*cutoff);  alpha = 1 / (1 + tau/te)
 */
function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

/** Exponential low-pass: mix new value with previous filtered value. */
function exponentialSmoothing(alpha: number, value: number, prev: number): number {
  return alpha * value + (1 - alpha) * prev;
}

/**
 * A stateful one-euro filter for a single scalar channel. Feed samples in
 * increasing timestamp order via {@link filter}. Construct a fresh instance
 * per channel (e.g. one for x, one for y) and per pass to stay deterministic.
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  private initialized = false;
  private xPrev = 0;
  private dxPrev = 0;
  private tPrevSec = 0;

  constructor(config: OneEuroConfig) {
    this.minCutoff = config.minCutoff;
    this.beta = config.beta;
    this.dCutoff = config.dCutoff;
  }

  /**
   * Filter one sample.
   * @param tSec  timestamp in seconds (must be non-decreasing across calls)
   * @param value raw sample value
   * @returns the filtered value
   */
  filter(tSec: number, value: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = value;
      this.dxPrev = 0;
      this.tPrevSec = tSec;
      return value;
    }

    // Guard against zero/negative dt so alpha stays finite and in (0,1].
    const te = tSec - this.tPrevSec;
    const dt = te > 0 ? te : 1e-6;

    // Estimate and low-pass the derivative (rate of change per second).
    const dxRaw = (value - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.dCutoff);
    const dxHat = exponentialSmoothing(aD, dxRaw, this.dxPrev);

    // Adapt the cutoff to the (smoothed) speed, then low-pass the value.
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = exponentialSmoothing(a, value, this.xPrev);

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrevSec = tSec;
    return xHat;
  }
}
