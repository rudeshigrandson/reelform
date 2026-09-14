import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegionSelector } from "./RegionSelector";
import { sampleRegionProps } from "./types";

/** jsdom PointerEvent drops clientX/Y; a MouseEvent under the pointer type keeps them. */
function pointer(type: string, target: EventTarget, clientX: number, clientY: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });
}

describe("RegionSelector", () => {
  it("shows the WxH readout seeded from initialBounds", () => {
    render(
      <RegionSelector
        initialBounds={sampleRegionProps.initialBounds}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("region-readout")).toHaveTextContent("640×360 px");
  });

  it("Record calls onConfirm with the current bounds", () => {
    const onConfirm = vi.fn();
    render(
      <RegionSelector
        initialBounds={sampleRegionProps.initialBounds}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith(sampleRegionProps.initialBounds);
  });

  it("Cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <RegionSelector
        initialBounds={sampleRegionProps.initialBounds}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <RegionSelector
        initialBounds={sampleRegionProps.initialBounds}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("dragging the rect moves it and updates confirmed bounds", () => {
    const onConfirm = vi.fn();
    render(
      <RegionSelector
        initialBounds={{ x: 100, y: 100, width: 200, height: 150 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const rect = screen.getByTestId("region-rect");
    pointer("pointerdown", rect, 150, 150);
    pointer("pointermove", window, 180, 170);
    pointer("pointerup", window, 180, 170);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 130, y: 120, width: 200, height: 150 });
  });
});
