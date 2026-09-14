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
});
