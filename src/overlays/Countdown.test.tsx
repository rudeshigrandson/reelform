import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  it("renders the current count", () => {
    render(<Countdown count={3} onCancel={vi.fn()} />);
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("3");
  });

  it("shows the Esc hint", () => {
    render(<Countdown count={2} onCancel={vi.fn()} />);
    expect(screen.getByTestId("countdown-hint")).toHaveTextContent("Press Esc to cancel");
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(<Countdown count={1} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("draws ring progress and a Go frame at zero", () => {
    const { rerender } = render(<Countdown count={2} total={3} onCancel={vi.fn()} />);
    expect(screen.getByTestId("countdown-progress")).toHaveAttribute("data-progress", "0.333");
    rerender(<Countdown count={0} total={3} onCancel={vi.fn()} />);
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("Go");
    expect(screen.getByTestId("countdown-progress")).toHaveAttribute("data-progress", "1.000");
  });

  it("pulses the ring normally and swaps to a static ring with a fade under reduce motion", () => {
    const { unmount } = render(<Countdown count={3} onCancel={vi.fn()} />);
    expect(screen.getByTestId("countdown-ring")).toHaveAttribute("data-motion", "full");
    expect(screen.getByTestId("countdown-ring").style.animation).toContain(
      "reelform-countdown-pulse",
    );
    unmount();
    document.documentElement.dataset.reduceMotion = "true";
    render(<Countdown count={3} onCancel={vi.fn()} />);
    const ring = screen.getByTestId("countdown-ring");
    expect(ring).toHaveAttribute("data-motion", "reduced");
    expect(ring.style.animation).toBe("none");
    expect(screen.getByTestId("countdown-number").style.animation).toContain(
      "reelform-countdown-fade",
    );
  });
});

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion;
});
