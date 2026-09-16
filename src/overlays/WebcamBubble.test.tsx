import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebcamBubble } from "./WebcamBubble";
import { sampleWebcamProps } from "./types";

/**
 * jsdom's PointerEvent constructor drops clientX/clientY from its init dict, so
 * we dispatch a MouseEvent under the pointer type — it carries coordinates and
 * React's synthetic onPointerDown still fires. State updates from the raw
 * window listeners are flushed with act().
 */
function pointer(type: string, target: EventTarget, clientX: number, clientY: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });
}

describe("WebcamBubble", () => {
  it("renders a circular bubble with 50% border-radius", () => {
    render(<WebcamBubble size={sampleWebcamProps.size} shape="circle" />);
    const bubble = screen.getByTestId("webcam-bubble");
    expect(bubble).toHaveAttribute("data-shape", "circle");
    expect(bubble.style.borderRadius).toBe("50%");
  });

  it("renders a rounded (non-circle) bubble", () => {
    render(<WebcamBubble size={120} shape="rounded" />);
    const bubble = screen.getByTestId("webcam-bubble");
    expect(bubble).toHaveAttribute("data-shape", "rounded");
    expect(bubble.style.borderRadius).not.toBe("50%");
  });

  it("applies the size prop", () => {
    render(<WebcamBubble size={160} shape="circle" />);
    const bubble = screen.getByTestId("webcam-bubble");
    expect(bubble.style.width).toBe("160px");
    expect(bubble.style.height).toBe("160px");
  });

  it("dragging repositions the bubble", () => {
    render(<WebcamBubble size={100} shape="circle" initialPosition={{ x: 10, y: 10 }} />);
    const bubble = screen.getByTestId("webcam-bubble");
    pointer("pointerdown", bubble, 50, 50);
    pointer("pointermove", window, 90, 70);
    pointer("pointerup", window, 90, 70);
    expect(bubble.style.left).toBe("50px");
    expect(bubble.style.top).toBe("30px");
  });

  it("clamps position to non-negative coordinates", () => {
    render(<WebcamBubble size={100} shape="circle" initialPosition={{ x: 5, y: 5 }} />);
    const bubble = screen.getByTestId("webcam-bubble");
    pointer("pointerdown", bubble, 50, 50);
    pointer("pointermove", window, 0, 0);
    pointer("pointerup", window, 0, 0);
    expect(bubble.style.left).toBe("0px");
    expect(bubble.style.top).toBe("0px");
  });

  it("without a feed draws the dashed No camera placeholder", () => {
    render(<WebcamBubble size={110} shape="circle" />);
    const bubble = screen.getByTestId("webcam-bubble");
    expect(bubble).toHaveTextContent("No camera");
    expect(bubble.style.border).toContain("dashed");
    expect(screen.getByTestId("webcam-glyph")).toBeInTheDocument();
  });

  it("mirrored gets the accent rim; controls sit on the bottom bar without starting a drag", () => {
    const onClick = vi.fn();
    render(
      <WebcamBubble
        size={110}
        shape="circle"
        mirrored
        initialPosition={{ x: 10, y: 10 }}
        controls={
          <button type="button" onClick={onClick}>
            S
          </button>
        }
      >
        <span>feed</span>
      </WebcamBubble>,
    );
    const bubble = screen.getByTestId("webcam-bubble");
    expect(bubble).toHaveAttribute("data-mirrored", "true");
    expect(bubble.style.border).toContain("var(--accent)");
    const button = screen.getByRole("button", { name: "S" });
    pointer("pointerdown", button, 50, 50);
    pointer("pointermove", window, 90, 90);
    pointer("pointerup", window, 90, 90);
    expect(bubble.style.left).toBe("10px");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
