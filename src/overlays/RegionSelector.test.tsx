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

  it("keeps large pixel sizes ungrouped and localizes the default hint and labels", () => {
    render(
      <RegionSelector
        initialBounds={{ x: 0, y: 0, width: 1920.4, height: 1080 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("region-readout")).toHaveTextContent("1920×1080 px");
    expect(screen.getByTestId("region-hint")).toHaveTextContent(
      "Drag to select a region · Esc to cancel",
    );
    expect(screen.getByRole("dialog", { name: "Select capture region" })).toBeInTheDocument();
    expect(screen.getByTestId("handle-nw")).toHaveAttribute("aria-label", "Resize nw");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows a caller-supplied hint instead of the default", () => {
    render(
      <RegionSelector
        initialBounds={sampleRegionProps.initialBounds}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        hint="Pick the window area"
      />,
    );
    expect(screen.getByTestId("region-hint")).toHaveTextContent("Pick the window area");
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

  it("snaps the moved rect and resized edges to window edges within 8px", () => {
    const onConfirm = vi.fn();
    render(
      <RegionSelector
        initialBounds={{ x: 100, y: 100, width: 200, height: 150 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        snapTargets={[{ x: 50, y: 60, width: 600, height: 400 }]}
      />,
    );
    const rect = screen.getByTestId("region-rect");
    // Move to x 55 / y 104: left edge snaps to 50; top is 44px away from 60 → stays.
    pointer("pointerdown", rect, 150, 150);
    pointer("pointermove", window, 105, 154);
    pointer("pointerup", window, 105, 154);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ x: 50, y: 104, width: 200, height: 150 });

    // Drag the east handle to 645: the right edge lands on the window's 650.
    const east = screen.getByTestId("handle-e");
    pointer("pointerdown", east, 250, 179);
    pointer("pointermove", window, 645, 179);
    pointer("pointerup", window, 645, 179);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ x: 50, y: 104, width: 600, height: 150 });
  });

  it("without snap targets edges follow the pointer exactly", () => {
    const onConfirm = vi.fn();
    render(
      <RegionSelector
        initialBounds={{ x: 100, y: 100, width: 200, height: 150 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        snapTargets={[]}
      />,
    );
    pointer("pointerdown", screen.getByTestId("region-rect"), 150, 150);
    pointer("pointermove", window, 105, 154);
    pointer("pointerup", window, 105, 154);
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onConfirm).toHaveBeenCalledWith({ x: 55, y: 104, width: 200, height: 150 });
  });
});
