import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FRAME_SETTINGS, FrameInspector, type FrameInspectorProps, type FrameSettings } from "./index";

const base = (): FrameSettings => structuredClone(DEFAULT_FRAME_SETTINGS);
const withBg = (kind: FrameSettings["background"]["kind"], patch: Partial<FrameSettings["background"]> = {}): FrameSettings => {
  const s = base();
  return { ...s, background: { ...s.background, ...patch, kind } };
};

function setup(overrides: Partial<FrameInspectorProps> = {}) {
  const onChange = vi.fn<(next: FrameSettings) => void>();
  const utils = render(<FrameInspector value={base()} onChange={onChange} {...overrides} />);
  const last = (): FrameSettings => {
    const call = onChange.mock.calls.at(-1);
    if (!call) throw new Error("onChange not called");
    return call[0];
  };
  return { ...utils, onChange, last };
}

/** Stateful host so multi-step interactions see their own updates. */
function Controlled(props: { initial: FrameSettings; spy: (s: FrameSettings) => void }) {
  const [v, setV] = useState(props.initial);
  return (
    <FrameInspector
      value={v}
      onChange={(n) => {
        props.spy(n);
        setV(n);
      }}
    />
  );
}

describe("FrameInspector — layout", () => {
  it("renders every S13 section open by default, presets row at top", () => {
    setup();
    for (const t of ["Background", "Blur", "Padding", "Corner radius", "Shadow", "Border", "Aspect ratio", "Inset"]) {
      expect(screen.getByRole("button", { name: new RegExp(t) })).toHaveAttribute("aria-expanded", "true");
    }
    const presets = screen.getByRole("group", { name: "Presets" });
    for (const n of ["Default", "Minimal", "Product Hunt", "Twitter", "Vertical"]) {
      expect(within(presets).getByRole("button", { name: n })).toBeInTheDocument();
    }
    expect(within(presets).getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "true");
  });

  it("honours remembered collapse state and reports toggles", () => {
    const onSectionToggle = vi.fn();
    setup({ collapsed: { shadow: true }, onSectionToggle });
    const shadow = screen.getByRole("button", { name: /Shadow/ });
    expect(shadow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Strength")).toBeNull();
    fireEvent.click(shadow);
    expect(onSectionToggle).toHaveBeenLastCalledWith("shadow", true);
    expect(screen.getByLabelText("Strength")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Padding/ }));
    expect(onSectionToggle).toHaveBeenLastCalledWith("padding", false);
    // Clicking inside a section body is not a toggle.
    onSectionToggle.mockClear();
    fireEvent.click(screen.getByRole("switch", { name: "Squircle" }));
    expect(onSectionToggle).not.toHaveBeenCalled();
  });
});

describe("FrameInspector — presets", () => {
  it("applies a preset as one onChange and keeps crop", () => {
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const { onChange, last } = setup({ value: { ...base(), crop } });
    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(last().aspect.preset).toBe("9:16");
    expect(last().crop).toEqual(crop);
  });

  it("no preset is pressed when customized; user presets listed; save button wiring", () => {
    const onSavePreset = vi.fn();
    const mine = { id: "u1", name: "My launch", builtIn: false, settings: { ...base(), radius: 33 } };
    setup({ value: { ...base(), radius: 33 }, userPresets: [mine], onSavePreset });
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "My launch" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save current as preset…" }));
    expect(onSavePreset).toHaveBeenCalledTimes(1);
  });

  it("save button is disabled without a handler", () => {
    setup();
    expect(screen.getByRole("button", { name: "Save current as preset…" })).toBeDisabled();
  });
});

describe("FrameInspector — background: wallpaper selected", () => {
  it("shows categories, the selected wallpaper, and selects another", () => {
    const { last } = setup();
    expect(screen.getByRole("radio", { name: "Wallpaper" })).toBeChecked();
    const grid = screen.getByRole("listbox", { name: "Wallpapers" });
    expect(within(grid).getAllByRole("option")).toHaveLength(5);
    expect(within(grid).getByRole("option", { name: "Abstract 1" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mesh" }));
    fireEvent.click(screen.getByRole("option", { name: "Mesh 3" }));
    expect(last().background).toMatchObject({ kind: "wallpaper", wallpaperId: "mesh-3" });
  });

  it("opens on the selected wallpaper's category and shows Add custom… only with a handler", () => {
    const onAddCustomWallpaper = vi.fn();
    setup({ value: withBg("wallpaper", { wallpaperId: "mac-2" }), onAddCustomWallpaper });
    expect(screen.getByRole("button", { name: "Mac" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add custom…" }));
    expect(onAddCustomWallpaper).toHaveBeenCalled();
  });

  it("empty custom category shows a hint when no add handler", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText("No wallpapers in this category.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add custom…" })).toBeNull();
  });
});

describe("FrameInspector — background kinds", () => {
  it("switching kind emits the new kind and keeps other data", () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Color" }));
    expect(last().background.kind).toBe("color");
    expect(last().background.wallpaperId).toBe("abstract-1");
  });

  it("color kind shows a picker", () => {
    const { last } = setup({ value: withBg("color") });
    fireEvent.input(screen.getByLabelText("Background color"), { target: { value: "#ff0000" } });
    expect(last().background.color).toBe("#ff0000");
  });

  it("none kind explains transparency and disables blur", () => {
    setup({ value: withBg("none") });
    expect(screen.getByText(/Transparent/)).toBeInTheDocument();
    expect(screen.getByLabelText("Background blur")).toBeDisabled();
    expect(screen.getByText("Applies to wallpaper and image backgrounds.")).toBeInTheDocument();
  });
});

describe("FrameInspector — gradient editing", () => {
  it("previews, edits angle/stops, adds up to 4 and removes down to 2", () => {
    const spy = vi.fn<(s: FrameSettings) => void>();
    render(<Controlled initial={withBg("gradient")} spy={spy} />);
    expect(screen.getByTestId("gradient-preview").style.background).toContain("linear-gradient");
    fireEvent.change(screen.getByLabelText("Angle"), { target: { value: "90" } });
    expect(spy.mock.calls.at(-1)?.[0].background.gradient.angle).toBe(90);

    const add = screen.getByRole("button", { name: "Add stop" });
    expect(screen.getByRole("button", { name: "Remove stop 1" })).toBeDisabled();
    fireEvent.click(add);
    fireEvent.click(add);
    expect(spy.mock.calls.at(-1)?.[0].background.gradient.stops).toHaveLength(4);
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Stop 2 position"), { target: { value: "30" } });
    expect(spy.mock.calls.at(-1)?.[0].background.gradient.stops[1]?.position).toBe(30);

    fireEvent.click(screen.getByRole("button", { name: "Remove stop 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove stop 3" }));
    expect(spy.mock.calls.at(-1)?.[0].background.gradient.stops).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Remove stop 1" })).toBeDisabled();
  });

  it("radial hides the angle control", () => {
    const s = withBg("gradient");
    s.background.gradient.type = "radial";
    setup({ value: s });
    expect(screen.queryByLabelText("Angle")).toBeNull();
  });
});

describe("FrameInspector — image dropzone", () => {
  const png = () => new File(["x"], "bg.png", { type: "image/png" });

  it("empty → hover → drop calls onImageSelect", () => {
    const onImageSelect = vi.fn();
    setup({ value: withBg("image"), onImageSelect });
    const zone = screen.getByTestId("image-dropzone");
    expect(zone).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("Drop an image here")).toBeInTheDocument();
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } });
    expect(zone).toHaveAttribute("data-state", "hover");
    expect(screen.getByText("Drop to use as background")).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(zone).toHaveAttribute("data-state", "empty");
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    expect(onImageSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "bg.png" }));
  });

  it("ignores non-image drops and accepts browsed files", () => {
    const onImageSelect = vi.fn();
    setup({ value: withBg("image"), onImageSelect });
    fireEvent.drop(screen.getByTestId("image-dropzone"), { dataTransfer: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(onImageSelect).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("image-input"), { target: { files: [png()] } });
    expect(onImageSelect).toHaveBeenCalledTimes(1);
  });

  it("filled shows the file name, Remove clears path, Fit/Fill toggles", () => {
    const { last } = setup({ value: withBg("image", { image: { path: "media/wallpapers/desk.jpg", fit: "fill" } }) });
    expect(screen.getByTestId("image-dropzone")).toHaveAttribute("data-state", "filled");
    expect(screen.getByText("desk.jpg")).toBeInTheDocument();
    expect(screen.getByLabelText("Background blur")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Fit" }));
    expect(last().background.image.fit).toBe("fit");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(last().background.image.path).toBeNull();
  });
});

describe("FrameInspector — sliders & switches", () => {
  it("blur, radius, squircle, shadow, border, inset emit patched settings", () => {
    const { last } = setup();
    fireEvent.change(screen.getByLabelText("Background blur"), { target: { value: "12" } });
    expect(last().blur).toBe(12);
    fireEvent.change(screen.getByLabelText("Corner radius"), { target: { value: "64" } });
    expect(last().radius).toBe(64);
    fireEvent.click(screen.getByRole("switch", { name: "Squircle" }));
    expect(last().squircle).toBe(true);
    fireEvent.change(screen.getByLabelText("Strength"), { target: { value: "80" } });
    expect(last().shadow.strength).toBe(80);
    fireEvent.change(screen.getByLabelText("Offset Y"), { target: { value: "-20" } });
    expect(last().shadow.offsetY).toBe(-20);
    fireEvent.change(screen.getByLabelText("Width"), { target: { value: "4" } });
    expect(last().border.width).toBe(4);
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "50" } });
    expect(last().border.opacity).toBe(50);
    fireEvent.change(screen.getByLabelText("Source scale"), { target: { value: "75" } });
    expect(last().inset).toBe(75);
    // Unrelated fields untouched.
    expect(last().padding).toEqual(DEFAULT_FRAME_SETTINGS.padding);
  });

  it("sliders expose S13 bounds", () => {
    setup();
    const bounds: Array<[string, string, string]> = [
      ["Background blur", "0", "40"],
      ["Padding", "0", "200"],
      ["Corner radius", "0", "64"],
      ["Strength", "0", "100"],
      ["Width", "0", "8"],
      ["Source scale", "50", "100"],
    ];
    for (const [label, min, max] of bounds) {
      const el = screen.getByLabelText(label);
      expect(el).toHaveAttribute("min", min);
      expect(el).toHaveAttribute("max", max);
    }
  });
});

describe("FrameInspector — padding", () => {
  it("match all sides hides steppers; turning off reveals T/R/B/L seeded from the uniform value", () => {
    const spy = vi.fn<(s: FrameSettings) => void>();
    render(<Controlled initial={base()} spy={spy} />);
    expect(screen.queryByLabelText("Top")).toBeNull();
    fireEvent.change(screen.getByLabelText("Padding"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("switch", { name: "Match all sides" }));
    expect(screen.getByLabelText("Top")).toHaveValue(100);
    fireEvent.change(screen.getByLabelText("Left"), { target: { value: "999" } });
    const p = spy.mock.calls.at(-1)?.[0].padding;
    expect(p).toMatchObject({ matchAll: false, top: 100, right: 100, bottom: 100, left: 200 });
    fireEvent.click(screen.getByRole("switch", { name: "Match all sides" }));
    expect(spy.mock.calls.at(-1)?.[0].padding).toMatchObject({ matchAll: true, all: 100, left: 100 });
    expect(screen.queryByLabelText("Left")).toBeNull();
  });
});

describe("FrameInspector — aspect ratio", () => {
  it("lists all ratios and shows output size", () => {
    const { last } = setup({ sourceSize: { width: 2880, height: 1800 } });
    for (const n of ["16:9", "9:16", "1:1", "4:3", "4:5", "21:9", "Source", "Custom"]) {
      expect(screen.getByRole("radio", { name: n })).toBeInTheDocument();
    }
    expect(screen.getByTestId("output-size")).toHaveTextContent("1920 × 1080");
    fireEvent.click(screen.getByRole("radio", { name: "4:5" }));
    expect(last().aspect.preset).toBe("4:5");
  });

  it("source without known size notes it", () => {
    setup({ value: { ...base(), aspect: { ...base().aspect, preset: "source" } } });
    expect(screen.getByText(/source size unknown/)).toBeInTheDocument();
  });

  it("custom aspect editing: valid W×H commits, invalid shows an error and does not commit", () => {
    const { onChange, last } = setup({ value: { ...base(), aspect: { preset: "custom", customWidth: 1920, customHeight: 1080 } } });
    const w = screen.getByLabelText("Custom width");
    const h = screen.getByLabelText("Custom height");
    expect(w).toHaveValue("1920");

    fireEvent.change(w, { target: { value: "1280" } });
    expect(last().aspect).toMatchObject({ preset: "custom", customWidth: 1280, customHeight: 1080 });

    onChange.mockClear();
    fireEvent.change(h, { target: { value: "abc" } });
    expect(screen.getByRole("alert")).toHaveTextContent("whole numbers");
    expect(h).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(h, { target: { value: "20" } });
    expect(screen.getByRole("alert")).toHaveTextContent("between 64 and 7680");
    fireEvent.change(h, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(h, { target: { value: "720" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("custom inputs resync when value changes externally", () => {
    const { rerender } = render(
      <FrameInspector value={{ ...base(), aspect: { preset: "custom", customWidth: 1920, customHeight: 1080 } }} onChange={() => {}} />,
    );
    rerender(<FrameInspector value={{ ...base(), aspect: { preset: "custom", customWidth: 800, customHeight: 600 } }} onChange={() => {}} />);
    expect(screen.getByLabelText("Custom width")).toHaveValue("800");
    expect(screen.getByTestId("output-size")).toHaveTextContent("800 × 600");
  });
});
