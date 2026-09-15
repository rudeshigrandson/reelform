import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
