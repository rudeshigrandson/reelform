import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceOutline } from "./SourceOutline";

describe("SourceOutline", () => {
  it("draws a 2px accent outline at the display-local bounds with a label above", () => {
    render(
      <SourceOutline
        bounds={{ x: 100, y: 100, width: 1280, height: 720 }}
        label="Figma — Onboarding.fig"
      />,
    );
    const rect = screen.getByTestId("source-outline-rect");
    expect(rect).toHaveStyle({ left: "100px", top: "100px", width: "1280px", height: "720px" });
    expect(rect.style.border).toBe("2px solid var(--accent)");
    expect(screen.getByTestId("source-outline")).toHaveStyle({ pointerEvents: "none" });
    const label = screen.getByTestId("source-outline-label");
    expect(label).toHaveTextContent("Figma — Onboarding.fig");
    expect(label).toHaveStyle({ top: "72px" });
  });

  it("puts the label inside a window at the top of the display, and tolerates bad bounds", () => {
    const { rerender } = render(
      <SourceOutline bounds={{ x: 0, y: 0, width: 800, height: 600 }} label="Safari" />,
    );
    expect(screen.getByTestId("source-outline-label")).toHaveStyle({ top: "4px" });
    rerender(<SourceOutline bounds={{ x: Number.NaN, y: 10, width: -5, height: 20 }} />);
    expect(screen.getByTestId("source-outline-rect")).toHaveStyle({ left: "0px", width: "0px" });
    expect(screen.queryByTestId("source-outline-label")).toBeNull();
  });
});
