import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type Annotation,
  type AnnotationOf,
  AnnotationsInspector,
  type AnnotationsInspectorProps,
  createAnnotation,
} from "./index";

function setup(overrides: Partial<AnnotationsInspectorProps> = {}) {
  const props: AnnotationsInspectorProps = {
    activeTool: null,
    onToolChange: vi.fn(),
    selected: null,
    onChange: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    detectedShortcuts: [],
    onAddAllShortcuts: vi.fn(),
    timelineDurationMs: 10_000,
    ...overrides,
  };
  const utils = render(<AnnotationsInspector {...props} />);
  return { props, ...utils };
}

const create = <K extends Annotation["kind"]>(kind: K) =>
  createAnnotation(kind, {
    id: `sel-${kind}`,
    playheadMs: 1000,
    timelineDurationMs: 10_000,
  }) as AnnotationOf<K>;

const lastChange = (fn: AnnotationsInspectorProps["onChange"]) =>
  (fn as ReturnType<typeof vi.fn>).mock.lastCall?.[0] as Annotation;

describe("AnnotationsInspector — no selection", () => {
  it("shows all 11 tools and the tips", () => {
    setup();
    const toolbar = screen.getByRole("toolbar", { name: "Annotation tools" });
    expect(within(toolbar).getAllByRole("button")).toHaveLength(11);
    for (const name of [
      "Text",
      "Arrow",
      "Line",
      "Rectangle",
      "Ellipse",
      "Highlight",
      "Blur region",
      "Image",
      "Emoji",
      "Number badge",
      "Keystroke badge",
    ]) {
      expect(within(toolbar).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("No annotation selected")).toBeInTheDocument();
    expect(screen.getByText(/last 3s/)).toBeInTheDocument();
    expect(screen.queryByText(/Keystroke badges/i)).toBeNull();
  });

  it("arms a tool, and clicking the armed tool disarms it", () => {
    const onToolChange = vi.fn();
    const { rerender, props } = setup({ onToolChange });
    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    expect(onToolChange).toHaveBeenLastCalledWith("arrow");
    rerender(<AnnotationsInspector {...props} activeTool="arrow" />);
    const arrow = screen.getByRole("button", { name: "Arrow" });
    expect(arrow).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/click or drag on the canvas to place/)).toBeInTheDocument();
    fireEvent.click(arrow);
    expect(onToolChange).toHaveBeenLastCalledWith(null);
  });
});

describe("AnnotationsInspector — keystroke list", () => {
  it("shows the detected count, deduped list, and Add all", () => {
    const shortcuts = [
      ...Array.from({ length: 12 }, (_, i) => ({ tMs: 1000 * i, label: "⌘K" })),
      { tMs: 500, label: "⌘S" },
      { tMs: 700, label: "⇧⌘P" },
    ];
    const { props } = setup({ detectedShortcuts: shortcuts });
    expect(screen.getByText("Detected 14 shortcuts")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Detected shortcuts" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("×12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));
    expect(props.onAddAllShortcuts).toHaveBeenCalledTimes(1);
  });

  it("uses singular for one shortcut", () => {
    setup({ detectedShortcuts: [{ tMs: 0, label: "⌘K" }] });
    expect(screen.getByText("Detected 1 shortcut")).toBeInTheDocument();
  });

  it("explains an empty list when the keystroke tool is armed", () => {
    setup({ activeTool: "keystrokeBadge" });
    expect(screen.getByText("No shortcuts detected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add all" })).toBeNull();
  });
});

describe("AnnotationsInspector — text selected", () => {
  it("renders text props and reports edits", () => {
    const text = create("text");
    const { props } = setup({ selected: text });
    expect(screen.queryByText("No annotation selected")).toBeNull();
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Hello\nworld" } });
    expect(lastChange(props.onChange)).toMatchObject({
      kind: "text",
      text: "Hello\nworld",
      id: text.id,
    });
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "Mono" } });
    expect(lastChange(props.onChange)).toMatchObject({ font: "Mono" });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "48" } });
    expect(lastChange(props.onChange)).toMatchObject({ fontSize: 48 });
    fireEvent.click(screen.getByLabelText("Regular"));
    expect(lastChange(props.onChange)).toMatchObject({ fontWeight: 400 });
    fireEvent.click(screen.getByLabelText("Left"));
    expect(lastChange(props.onChange)).toMatchObject({ align: "left" });
    fireEvent.click(screen.getByRole("switch", { name: "Background pill" }));
    expect(lastChange(props.onChange)).toMatchObject({ background: false });
    expect(screen.getByLabelText("Pill color")).toBeInTheDocument();
  });

  it("hides pill color when background is off", () => {
    setup({ selected: { ...create("text"), background: false } });
    expect(screen.queryByLabelText("Pill color")).toBeNull();
  });
});

describe("AnnotationsInspector — blur selected", () => {
  it("renders strength + pixelate and not text controls", () => {
    const blur = create("blur");
    const { props } = setup({ selected: blur });
    expect(screen.queryByLabelText("Content")).toBeNull();
    fireEvent.change(screen.getByLabelText("Strength"), { target: { value: "30" } });
    expect(lastChange(props.onChange)).toMatchObject({ kind: "blur", strength: 30 });
    fireEvent.click(screen.getByRole("switch", { name: "Pixelate" }));
    expect(lastChange(props.onChange)).toMatchObject({ pixelate: true });
  });
});

describe("AnnotationsInspector — other kinds", () => {
  it("arrow shows head style; line does not", () => {
    const { unmount, props } = setup({ selected: create("arrow") });
    fireEvent.click(screen.getByLabelText("Open"));
    expect(lastChange(props.onChange)).toMatchObject({ headStyle: "open" });
    fireEvent.click(screen.getByRole("switch", { name: "Dashed" }));
    expect(lastChange(props.onChange)).toMatchObject({ dashed: true });
    unmount();
    setup({ selected: create("line") });
    expect(screen.queryByLabelText("Open")).toBeNull();
    expect(screen.getByRole("switch", { name: "Dashed" })).toBeInTheDocument();
  });

  it("rect has radius; ellipse does not; opacity maps to 0..1", () => {
    const { unmount, props } = setup({ selected: create("rect") });
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "50" } });
    expect(lastChange(props.onChange)).toMatchObject({ opacity: 0.5 });
    expect(screen.getByLabelText("Radius")).toBeInTheDocument();
    unmount();
    setup({ selected: create("ellipse") });
    expect(screen.queryByLabelText("Radius")).toBeNull();
  });

  it("image shows empty hint without src, plus fit and corner radius", () => {
    const { props } = setup({ selected: create("image") });
    expect(screen.getByText("No image")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Cover"));
    expect(lastChange(props.onChange)).toMatchObject({ fit: "cover" });
  });

  it("number badge, emoji and keystroke badge edit their content", () => {
    const { unmount, props } = setup({ selected: create("numberBadge") });
    fireEvent.change(screen.getByLabelText("Number"), { target: { value: "7" } });
    expect(lastChange(props.onChange)).toMatchObject({ value: 7 });
    unmount();
    const e = setup({ selected: create("emoji") });
    fireEvent.change(screen.getByRole("textbox", { name: "Emoji" }), { target: { value: "🔥" } });
    expect(lastChange(e.props.onChange)).toMatchObject({ emoji: "🔥" });
    e.unmount();
    setup({ selected: { ...create("keystrokeBadge"), label: "⌘K" } });
    expect(screen.getByLabelText("Label")).toHaveValue("⌘K");
  });
});

describe("AnnotationsInspector — common controls", () => {
  it("duplicate and delete pass the selection", () => {
    const sel = create("rect");
    const { props } = setup({ selected: sel });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onDuplicate).toHaveBeenCalledWith(sel);
    expect(props.onDelete).toHaveBeenCalledWith(sel);
  });

  it("animation: choosing Slide reveals direction; None disables duration", () => {
    const sel = create("text");
    const { props, rerender } = setup({ selected: sel });
    const animIn = screen.getByRole("group", { name: "Animation in" });
    fireEvent.click(within(animIn).getByLabelText("Slide"));
    const changed = lastChange(props.onChange);
    expect(changed.animIn.type).toBe("slide");
    expect(changed.animOut).toEqual(sel.animOut);
    rerender(<AnnotationsInspector {...props} selected={changed} />);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Animation in" })).getByLabelText("▸"),
    );
    expect(lastChange(props.onChange).animIn.direction).toBe("right");
    rerender(
      <AnnotationsInspector
        {...props}
        selected={{ ...sel, animOut: { ...sel.animOut, type: "none" } }}
      />,
    );
    expect(screen.getByLabelText("Out duration")).toBeDisabled();
  });

  it("position uses percent and follow zoom toggles", () => {
    const sel = { ...create("rect"), x: 0.25 };
    const { props } = setup({ selected: sel });
    expect(screen.getByLabelText("X")).toHaveValue(25);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "50" } });
    expect(lastChange(props.onChange).x).toBeCloseTo(0.5);
    fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "400" } });
    expect(lastChange(props.onChange).rotation).toBe(180);
    fireEvent.click(screen.getByRole("switch", { name: "Follow zoom" }));
    expect(lastChange(props.onChange).followZoom).toBe(!sel.followZoom);
  });

  it("timing edits keep end after start and clamp to the timeline", () => {
    const sel = create("text"); // 1s–4s
    const { props } = setup({ selected: sel });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "6" } });
    const moved = lastChange(props.onChange);
    expect(moved.startMs).toBe(6000);
    expect(moved.endMs).toBeGreaterThan(moved.startMs);
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "99" } });
    expect(lastChange(props.onChange).endMs).toBe(10_000);
    expect(screen.getByText("Duration 3s")).toBeInTheDocument();
  });
});
