import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceOutline } from "./SourceOutline";

describe("SourceOutline", () => {
  it("draws a 2px accent outline offset around the bounds with the target chip inside", () => {
    render(
      <SourceOutline
        bounds={{ x: 100, y: 100, width: 1280, height: 720 }}
        label="Figma — Onboarding.fig"
      />,
    );
    const rect = screen.getByTestId("source-outline-rect");
    expect(rect).toHaveStyle({ left: "100px", top: "100px", width: "1280px", height: "720px" });
    expect(rect.style.outline).toBe("2px solid var(--accent)");
    expect(rect.style.outlineOffset).toBe("4px");
    expect(screen.getByTestId("source-outline")).toHaveStyle({ pointerEvents: "none" });
    const chip = screen.getByTestId("source-outline-chip");
    expect(chip).toHaveTextContent("Recording target");
    // Bottom-left, inside the window: 100 + 720 - 10 inset - 20 chip.
    expect(chip).toHaveStyle({ left: "112px", top: "790px" });
    expect(screen.getByTestId("source-outline-label")).toHaveTextContent("Figma — Onboarding.fig");
  });

  it("omits the label without one, drops the chip on tiny rects, and tolerates bad bounds", () => {
    const { rerender } = render(<SourceOutline bounds={{ x: 0, y: 0, width: 800, height: 600 }} />);
    expect(screen.getByTestId("source-outline-chip")).toBeInTheDocument();
    expect(screen.queryByTestId("source-outline-label")).toBeNull();
    rerender(<SourceOutline bounds={{ x: Number.NaN, y: 10, width: -5, height: 20 }} label="x" />);
    expect(screen.getByTestId("source-outline-rect")).toHaveStyle({ left: "0px", width: "0px" });
    expect(screen.queryByTestId("source-outline-chip")).toBeNull();
  });
});
