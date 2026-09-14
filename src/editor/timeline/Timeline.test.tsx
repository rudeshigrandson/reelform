import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HEADER_WIDTH_PX, Timeline, type TimelineProps } from "./Timeline";
import type { TimelineTrack } from "./types";

// jsdom lacks PointerEvent and layout. Polyfill the former so clientX/modifiers
// survive fireEvent, and give every element a 1000px-wide rect at x = 0.
const originalRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: test-only global polyfill
    (window as any).PointerEvent = PointerEventPolyfill;
  }
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 1000,
      height: 36,
      right: 1000,
      bottom: 36,
      toJSON: () => ({}),
    };
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

const tracks: TimelineTrack[] = [
  {
    kind: "zoom",
    label: "Zoom",
    allowOverlap: false,
    items: [
      { id: "z1", startMs: 2000, endMs: 4500, label: "1.8×" },
      { id: "z2", startMs: 6000, endMs: 8000, label: "2×", ghost: true },
    ],
  },
  {
    kind: "speed",
    label: "Speed",
    allowOverlap: false,
    items: [{ id: "s1", startMs: 500, endMs: 1500, label: "2×" }],
  },
  {
    kind: "annotations",
    label: "Annotations",
    allowOverlap: true,
    items: [
      { id: "a1", startMs: 1000, endMs: 3000, label: "Arrow" },
      { id: "a2", startMs: 4000, endMs: 5000, label: "Text" },
    ],
  },
];

function setup(over: Partial<TimelineProps> = {}) {
  const props: TimelineProps = {
    durationMs: 10_000, // fit at 1000px → 0.1 px/ms
    currentMs: 0,
    fps: 30,
    tracks,
    selectedIds: new Set(),
    snapEnabled: false,
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onItemChange: vi.fn(),
    onAddAtPlayhead: vi.fn(),
    ...over,
  };
  const utils = render(<Timeline {...props} />);
  return { props, ...utils };
}

const z1Name = "Zoom 1.8× 00:02.000–00:04.500";

function drag(el: Element, fromX: number, toX: number, init: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(el, { clientX: fromX, clientY: 0, button: 0, pointerId: 1, ...init });
  fireEvent.pointerMove(el, { clientX: toX, clientY: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(el, { clientX: toX, clientY: 0, pointerId: 1, ...init });
}

describe("Timeline", () => {
  it("renders track headers and items with accessible labels", () => {
    setup();
    expect(screen.getByRole("group", { name: "Zoom track" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Annotations track" })).toBeInTheDocument();
    const z1 = screen.getByRole("button", { name: z1Name });
    expect(z1).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Speed 2× 00:00.500–00:01.500" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom 2× 00:06.000–00:08.000" })).toHaveAttribute(
      "data-ghost",
      "true",
    );
  });

  it("marks selected items with aria-pressed", () => {
    setup({ selectedIds: new Set(["z1"]) });
    expect(screen.getByRole("button", { name: z1Name })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the ruler seeks to the time under the pointer, and dragging scrubs", () => {
    const { props } = setup();
    const ruler = screen.getByTestId("timeline-ruler");
    fireEvent.pointerDown(ruler, { clientX: 250, button: 0 });
    expect(props.onSeek).toHaveBeenLastCalledWith(2500);
    fireEvent.pointerMove(ruler, { clientX: 400 });
    expect(props.onSeek).toHaveBeenLastCalledWith(4000);
    fireEvent.pointerUp(ruler, { clientX: 400 });
    fireEvent.pointerMove(ruler, { clientX: 900 });
    expect(props.onSeek).toHaveBeenCalledTimes(2);
  });

  it("seek clamps to the duration", () => {
    const { props } = setup({ durationMs: 10_000 });
    fireEvent.pointerDown(screen.getByTestId("timeline-ruler"), { clientX: 5000, button: 0 });
    expect(props.onSeek).toHaveBeenLastCalledWith(10_000);
  });

  it("click selects one; shift extends within track; meta toggles", () => {
    const onSelect = vi.fn();
    const { rerender, props } = setup({ onSelect });
    const z1 = screen.getByRole("button", { name: z1Name });
    fireEvent.pointerDown(z1, { clientX: 300, button: 0 });
    fireEvent.pointerUp(z1, { clientX: 300 });
    expect([...(onSelect.mock.lastCall?.[0] ?? [])]).toEqual(["z1"]);
    expect(props.onItemChange).not.toHaveBeenCalled();

    rerender(<Timeline {...props} selectedIds={new Set(["z1"])} />);
    const z2 = screen.getByRole("button", { name: "Zoom 2× 00:06.000–00:08.000" });
    fireEvent.pointerDown(z2, { clientX: 700, button: 0, shiftKey: true });
    fireEvent.pointerUp(z2, { clientX: 700 });
    expect(new Set(onSelect.mock.lastCall?.[0])).toEqual(new Set(["z1", "z2"]));

    fireEvent.pointerDown(z1, { clientX: 300, button: 0, metaKey: true });
    fireEvent.pointerUp(z1, { clientX: 300 });
    expect([...(onSelect.mock.lastCall?.[0] ?? [])]).toEqual([]);
  });

  it("dragging an item body commits the moved times", () => {
    const { props } = setup();
    drag(screen.getByRole("button", { name: z1Name }), 300, 310); // +100ms
    expect(props.onItemChange).toHaveBeenCalledWith("zoom", {
      id: "z1",
      startMs: 2100,
      endMs: 4600,
    });
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("snaps a moved edge to the playhead, and alt bypasses", () => {
    const { props } = setup({ snapEnabled: true, currentMs: 3240 });
    const z1 = screen.getByRole("button", { name: z1Name });
    // +1200ms → 3200–5700; start is 40ms (4px) from the playhead, nothing else within 6px.
    drag(z1, 300, 420);
    expect(props.onItemChange).toHaveBeenLastCalledWith("zoom", {
      id: "z1",
      startMs: 3240,
      endMs: 5740,
    });
    drag(z1, 300, 420, { altKey: true });
    expect(props.onItemChange).toHaveBeenLastCalledWith("zoom", {
      id: "z1",
      startMs: 3200,
      endMs: 5700,
    });
  });

  it("dragging an edge resizes", () => {
    const { props } = setup();
    const z1 = screen.getByRole("button", { name: z1Name });
    const endHandle = z1.querySelector('[data-handle="end"]');
    const startHandle = z1.querySelector('[data-handle="start"]');
    if (!endHandle || !startHandle) throw new Error("handles missing");
    drag(endHandle, 450, 500);
    expect(props.onItemChange).toHaveBeenLastCalledWith("zoom", {
      id: "z1",
      startMs: 2000,
      endMs: 5000,
    });
    drag(startHandle, 200, 150);
    expect(props.onItemChange).toHaveBeenLastCalledWith("zoom", {
      id: "z1",
      startMs: 1500,
      endMs: 4500,
    });
  });

  it("dragging into a neighbour on a zoom track shows invalid and does not commit", () => {
    const { props } = setup();
    const z1 = screen.getByRole("button", { name: z1Name });
    fireEvent.pointerDown(z1, { clientX: 300, button: 0 });
    fireEvent.pointerMove(z1, { clientX: 600 }); // → 5000–7500 overlaps z2
    const live = screen.getByRole("button", { name: "Zoom 1.8× 00:05.000–00:07.500" });
    expect(live).toHaveAttribute("aria-invalid", "true");
    fireEvent.pointerUp(z1, { clientX: 600 });
    expect(props.onItemChange).not.toHaveBeenCalled();
    // Reverts to the original position.
    expect(screen.getByRole("button", { name: z1Name })).not.toHaveAttribute("aria-invalid");
  });

  it("overlap is allowed on the annotations track", () => {
    const { props } = setup();
    drag(screen.getByRole("button", { name: "Annotation Arrow 00:01.000–00:03.000" }), 150, 350);
    expect(props.onItemChange).toHaveBeenCalledWith("annotations", {
      id: "a1",
      startMs: 3000,
      endMs: 5000,
    });
  });

  it("the + button adds at the playhead for that track", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add Speed at playhead" }));
    expect(props.onAddAtPlayhead).toHaveBeenCalledWith("speed");
  });

  it("hides + buttons when onAddAtPlayhead is not provided", () => {
    setup({ onAddAtPlayhead: undefined });
    expect(screen.queryByRole("button", { name: /at playhead/ })).toBeNull();
  });

  it("positions the playhead from currentMs", () => {
    setup({ currentMs: 5000 });
    expect(screen.getByTestId("timeline-playhead").style.left).toBe(`${HEADER_WIDTH_PX + 500}px`);
  });

  it("clicking empty lane space clears selection and seeks", () => {
    const { props } = setup({ selectedIds: new Set(["z1"]) });
    const lanes = screen.getByTestId("timeline-lanes");
    fireEvent.pointerDown(lanes, { clientX: 950, clientY: 10, button: 0 });
    fireEvent.pointerUp(lanes, { clientX: 950, clientY: 10 });
    expect((props.onSelect as ReturnType<typeof vi.fn>).mock.lastCall?.[0].size).toBe(0);
    expect(props.onSeek).toHaveBeenLastCalledWith(9500);
  });

  it("marquee drag selects intersecting items across lanes", () => {
    const { props } = setup();
    const lanes = screen.getByTestId("timeline-lanes");
    fireEvent.pointerDown(lanes, { clientX: 150, clientY: 10, button: 0 });
    fireEvent.pointerMove(lanes, { clientX: 450, clientY: 90 }); // lanes 0..2, 1500–4500ms
    expect(screen.getByTestId("timeline-marquee")).toBeInTheDocument();
    fireEvent.pointerUp(lanes, { clientX: 450, clientY: 90 });
    const selected = (props.onSelect as ReturnType<typeof vi.fn>).mock.lastCall?.[0];
    expect(new Set(selected)).toEqual(new Set(["z1", "a1", "a2"]));
    expect(props.onSeek).not.toHaveBeenCalled();
  });

  it("Escape clears the selection", () => {
    const { props } = setup({ selectedIds: new Set(["z1"]) });
    fireEvent.keyDown(screen.getByRole("button", { name: z1Name }), { key: "Escape" });
    expect((props.onSelect as ReturnType<typeof vi.fn>).mock.lastCall?.[0].size).toBe(0);
  });

  it("only renders items intersecting the visible window", () => {
    const far: TimelineTrack = {
      kind: "captions",
      label: "Captions",
      allowOverlap: true,
      items: [
        { id: "near", startMs: 1000, endMs: 2000, label: "near" },
        { id: "far", startMs: 30_000, endMs: 31_000, label: "far" },
      ],
    };
    setup({ durationMs: 60_000, pxPerMs: 0.2, tracks: [far] }); // 5s visible
    expect(screen.getByRole("button", { name: /Caption near/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Caption far/ })).toBeNull();
  });

  it("ctrl + wheel zooms around the cursor; shift + wheel pans", () => {
    const onScaleChange = vi.fn();
    setup({ durationMs: 60_000, onScaleChange, tracks: [] });
    const root = screen.getByRole("region", { name: "Timeline" });
    act(() => {
      fireEvent.wheel(root, { ctrlKey: true, deltaY: -500, clientX: 500 });
    });
    const px = onScaleChange.mock.lastCall?.[0] as number;
    expect(px).toBeGreaterThan(1000 / 60_000);
    // Panning changes scroll only, never the zoom.
    act(() => {
      fireEvent.wheel(root, { shiftKey: true, deltaY: 100 });
    });
    expect(onScaleChange).toHaveBeenCalledTimes(1);
  });
});
