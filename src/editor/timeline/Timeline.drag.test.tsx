import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Timeline, type TimelineProps } from "./Timeline";
import type { TimelineTrack } from "./types";

/** Drag constraints (SPEC §6.7): group moves, shift-drop trims, alt-drag duplicates, scope. */

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
      { id: "z1", startMs: 2000, endMs: 4000, label: "A" },
      { id: "z2", startMs: 5000, endMs: 7000, label: "B" },
    ],
  },
  {
    kind: "annotations",
    label: "Annotations",
    allowOverlap: true,
    items: [{ id: "a1", startMs: 1000, endMs: 2000, label: "Arrow" }],
  },
  {
    kind: "captions",
    label: "Captions",
    allowOverlap: true,
    items: [
      { id: "c1", startMs: 8000, endMs: 9000, label: "Hi", wordBoundaries: [8000, 8430, 9000] },
    ],
  },
];

// 10s at 1000px → 0.1 px/ms: 100px = 1s.
function setup(over: Partial<TimelineProps> = {}) {
  const props: TimelineProps = {
    durationMs: 10_000,
    currentMs: 0,
    fps: 30,
    tracks,
    selectedIds: new Set(),
    snapEnabled: false,
    onSeek: vi.fn(),
    onSelect: vi.fn(),
    onItemChange: vi.fn(),
    onItemsChange: vi.fn(),
    onItemDuplicate: vi.fn(),
    ...over,
  };
  render(<Timeline {...props} />);
  return props;
}

function drag(el: Element, fromX: number, toX: number, init: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(el, { clientX: fromX, clientY: 0, button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: toX, clientY: 0, pointerId: 1, ...init });
  fireEvent.pointerUp(el, { clientX: toX, clientY: 0, pointerId: 1, ...init });
}

const item = (name: RegExp) => screen.getByRole("button", { name });

describe("Timeline drag constraints", () => {
  it("marks the timeline as the `timeline` shortcut scope", () => {
    setup();
    expect(screen.getByRole("region", { name: "Timeline" })).toHaveAttribute(
      "data-shortcut-scope",
      "timeline",
    );
  });

  it("dragging one of several selected items moves the whole selection as one batch", () => {
    const props = setup({ selectedIds: new Set(["z1", "a1"]) });
    drag(item(/^Zoom A/), 300, 350);
    expect(props.onItemChange).not.toHaveBeenCalled();
    expect(props.onItemsChange).toHaveBeenCalledWith([
      { kind: "zoom", span: { id: "z1", startMs: 2500, endMs: 4500 } },
      { kind: "annotations", span: { id: "a1", startMs: 1500, endMs: 2500 } },
    ]);
  });

  it("a group move that would overlap an unselected zoom commits nothing", () => {
    const props = setup({ selectedIds: new Set(["z1", "a1"]) });
    drag(item(/^Zoom A/), 300, 420);
    expect(props.onItemsChange).not.toHaveBeenCalled();
    expect(props.onItemChange).not.toHaveBeenCalled();
  });

  it("shift on an invalid drop trims the tail of an earlier neighbour in the same batch", () => {
    const props = setup();
    drag(item(/^Zoom B/), 600, 450, { shiftKey: true });
    expect(props.onItemChange).not.toHaveBeenCalled();
    expect(props.onItemsChange).toHaveBeenCalledWith([
      { kind: "zoom", span: { id: "z2", startMs: 3500, endMs: 5500 } },
      { kind: "zoom", span: { id: "z1", startMs: 2000, endMs: 3500 } },
    ]);
  });

  it("a drop that only touches a neighbour is a plain valid move", () => {
    const props = setup();
    drag(item(/^Zoom A/), 300, 400, { shiftKey: true });
    expect(props.onItemsChange).not.toHaveBeenCalled();
    expect(props.onItemChange).toHaveBeenCalledWith("zoom", {
      id: "z1",
      startMs: 3000,
      endMs: 5000,
    });
  });

  it("shift trims the head of a later neighbour", () => {
    const props = setup();
    drag(item(/^Zoom A/), 300, 450, { shiftKey: true });
    expect(props.onItemsChange).toHaveBeenCalledWith([
      { kind: "zoom", span: { id: "z1", startMs: 3500, endMs: 5500 } },
      { kind: "zoom", span: { id: "z2", startMs: 5500, endMs: 7000 } },
    ]);
  });

  it("without shift an invalid drop is rejected", () => {
    const props = setup();
    drag(item(/^Zoom A/), 300, 450);
    expect(props.onItemsChange).not.toHaveBeenCalled();
    expect(props.onItemChange).not.toHaveBeenCalled();
  });

  it("alt-drop duplicates instead of moving, and refuses a copy on the original", () => {
    const props = setup();
    drag(item(/^Annotation Arrow/), 150, 700, { altKey: true });
    expect(props.onItemDuplicate).toHaveBeenCalledWith("annotations", {
      id: "a1",
      startMs: 6500,
      endMs: 7500,
    });
    expect(props.onItemChange).not.toHaveBeenCalled();

    drag(item(/^Zoom A/), 300, 350, { altKey: true });
    expect(props.onItemDuplicate).toHaveBeenCalledTimes(1);
  });

  it("caption resizes snap to word boundaries", () => {
    const props = setup({ snapEnabled: true });
    // End edge: drag from 9000 toward 8450 (within 6px of the 8430 word boundary).
    const caption = item(/^Caption Hi/);
    const handle = caption.querySelector('[data-handle="end"]') as Element;
    fireEvent.pointerDown(handle, { clientX: 900, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 845, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 845, clientY: 0, pointerId: 1 });
    expect(props.onItemChange).toHaveBeenCalledWith("captions", {
      id: "c1",
      startMs: 8000,
      endMs: 8430,
    });
  });
});
