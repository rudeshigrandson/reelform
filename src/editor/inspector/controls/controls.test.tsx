import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnchorGrid, NumberField, Section, Slider, Switch, anchorToPoint, clamp } from "./index";

describe("Section", () => {
  it("is open by default and collapses on header click", () => {
    render(
      <Section title="Padding">
        <span>body</span>
      </Section>,
    );
    const header = screen.getByRole("button", { name: /Padding/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("body")).toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).toBeNull();
  });
});

describe("Slider", () => {
  it("reports numeric changes and shows unit", () => {
    const onChange = vi.fn();
    render(<Slider label="Blur" value={10} min={0} max={40} unit="px" onChange={onChange} />);
    expect(screen.getByText("10px")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Blur"), { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith(25);
  });
});

describe("Switch", () => {
  it("toggles and respects disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Switch label="Mirror" checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Mirror" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch label="Mirror" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("NumberField", () => {
  it("clamps to bounds and ignores empty input", () => {
    const onChange = vi.fn();
    render(<NumberField label="Offset" value={0} min={-500} max={500} onChange={onChange} />);
    const input = screen.getByLabelText("Offset");
    fireEvent.change(input, { target: { value: "9999" } });
    expect(onChange).toHaveBeenLastCalledWith(500);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("AnchorGrid", () => {
  it("marks the selected cell and reports clicks", () => {
    const onChange = vi.fn();
    render(<AnchorGrid label="Position" value="bottom-right" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "bottom-right" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "top-left" }));
    expect(onChange).toHaveBeenCalledWith("top-left");
  });

  it("maps anchors to normalized points", () => {
    expect(anchorToPoint("top-left")).toEqual({ x: 0, y: 0 });
    expect(anchorToPoint("center")).toEqual({ x: 0.5, y: 0.5 });
    expect(anchorToPoint("bottom-right")).toEqual({ x: 1, y: 1 });
  });
});

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
