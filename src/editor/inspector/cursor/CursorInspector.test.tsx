import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CursorInspector,
  type CursorInspectorProps,
  type CursorSettings,
  DEFAULT_CURSOR_SETTINGS,
} from "./index";

function setup(overrides: Partial<CursorInspectorProps> = {}, value: Partial<CursorSettings> = {}) {
  const onChange = vi.fn<(next: CursorSettings) => void>();
  const props: CursorInspectorProps = {
    value: { ...DEFAULT_CURSOR_SETTINGS, ...value },
    onChange,
    cursorPointCount: 1204,
    ...overrides,
  };
  const utils = render(<CursorInspector {...props} />);
  return { ...utils, onChange, props };
}

const lastChange = (fn: ReturnType<typeof vi.fn>): CursorSettings =>
  fn.mock.lastCall?.[0] as CursorSettings;

describe("CursorInspector — default state", () => {
  it("renders master switch, macOS style, preview tiles and tracked pill", () => {
    setup();
    expect(screen.getByRole("switch", { name: "Show cursor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "macOS" })).toBeChecked();
    const preview = screen.getByLabelText("Cursor preview");
    for (const name of ["Arrow", "Hand", "Text beam", "Resize"]) {
      expect(within(preview).getByRole("img", { name })).toBeInTheDocument();
    }
    // Cursor size and click-effect size both default to 100%.
    expect(screen.getAllByText("100%")).toHaveLength(2);
    expect(screen.getByText("Snappy")).toBeInTheDocument();
    expect(screen.getByText("Silky")).toBeInTheDocument();
    expect(screen.getByText("Tracked ✓ 1,204 points")).toBeInTheDocument();
    expect(screen.queryByText(/No cursor data/)).toBeNull();
  });

  it("emits a full next settings object for each control", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Windows" }));
    expect(lastChange(onChange)).toEqual({ ...DEFAULT_CURSOR_SETTINGS, style: "windows" });

    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "150" } });
    expect(lastChange(onChange).size).toBe(150);

    fireEvent.change(screen.getByLabelText("Smoothing"), { target: { value: "80" } });
    expect(lastChange(onChange).smoothing).toBe(80);

    fireEvent.click(screen.getByRole("switch", { name: "Sway" }));
    expect(lastChange(onChange).sway).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Loop mode" }));
    expect(lastChange(onChange).loop).toBe(true);

    fireEvent.click(
      within(screen.getByRole("group", { name: "Click effect" })).getByRole("radio", {
        name: "Bounce",
      }),
    );
    expect(lastChange(onChange).clickEffect).toEqual({
      ...DEFAULT_CURSOR_SETTINGS.clickEffect,
      type: "bounce",
    });

    fireEvent.change(screen.getByLabelText("Effect size"), { target: { value: "200" } });
    expect(lastChange(onChange).clickEffect.size).toBe(200);

    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#ff0000" } });
    expect(lastChange(onChange).clickEffect.color).toBe("#ff0000");

    fireEvent.click(
      within(screen.getByRole("group", { name: "Click sound" })).getByRole("radio", {
        name: "Soft",
      }),
    );
    expect(lastChange(onChange).clickSound.type).toBe("soft");
  });

  it("clamps slider input to spec ranges", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "999" } });
    // jsdom clamps range inputs to max; either way we never exceed 300.
    expect(lastChange(onChange).size).toBeLessThanOrEqual(300);
  });

  it("turning off Show cursor emits show=false", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Show cursor" }));
    expect(lastChange(onChange)).toEqual({ ...DEFAULT_CURSOR_SETTINGS, show: false });
  });
});

describe("CursorInspector — dependent controls", () => {
  it("motion blur amount is disabled until motion blur is on", () => {
    const { onChange, rerender, props } = setup();
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Motion blur" }));
    expect(lastChange(onChange).motionBlur).toEqual({ enabled: true, amount: 50 });
    rerender(
      <CursorInspector
        {...props}
        value={{ ...props.value, motionBlur: { enabled: true, amount: 50 } }}
      />,
    );
    expect(screen.getByLabelText("Amount")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "70" } });
    expect(lastChange(onChange).motionBlur).toEqual({ enabled: true, amount: 70 });
  });

  it("idle delay is disabled until Hide when idle is on", () => {
    const { onChange } = setup({}, { hideWhenIdle: { enabled: true, delaySec: 2 } });
    const delay = screen.getByLabelText("Delay");
    expect(delay).toBeEnabled();
    expect(screen.getByText("2s")).toBeInTheDocument();
    fireEvent.change(delay, { target: { value: "3.5" } });
    expect(lastChange(onChange).hideWhenIdle).toEqual({ enabled: true, delaySec: 3.5 });
  });

  it("click effect None disables color and size; sound None disables volume", () => {
    setup(
      {},
      {
        clickEffect: { ...DEFAULT_CURSOR_SETTINGS.clickEffect, type: "none" },
        clickSound: { ...DEFAULT_CURSOR_SETTINGS.clickSound, type: "none" },
      },
    );
    expect(screen.getByLabelText("Color")).toBeDisabled();
    expect(screen.getByLabelText("Effect size")).toBeDisabled();
    expect(screen.getByLabelText("Volume")).toBeDisabled();
  });
});

describe("CursorInspector — Show cursor off", () => {
  it("disables every other control but keeps the master switch and cursor data", () => {
    setup({}, { show: false });
    const master = screen.getByRole("switch", { name: "Show cursor" });
    expect(master).toBeEnabled();
    expect(master).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Windows" })).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
    expect(screen.getByLabelText("Smoothing")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Sway" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Loop mode" })).toBeDisabled();
    expect(screen.getByText("Tracked ✓ 1,204 points")).toBeInTheDocument();
  });
});

describe("CursorInspector — custom cursor upload", () => {
  const png = () =>
    new File([new Uint8Array([137, 80, 78, 71])], "arrow.png", { type: "image/png" });

  it("shows an upload button instead of preview and forwards a valid file", () => {
    const onUploadCustomCursor = vi.fn();
    setup({ onUploadCustomCursor }, { style: "custom" });
    expect(screen.queryByLabelText("Cursor preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload PNG or SVG…" })).toBeEnabled();
    const file = png();
    fireEvent.change(screen.getByLabelText("Custom cursor file"), { target: { files: [file] } });
    expect(onUploadCustomCursor).toHaveBeenCalledWith(file);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects non PNG/SVG files with an inline error", () => {
    const onUploadCustomCursor = vi.fn();
    setup({ onUploadCustomCursor }, { style: "custom" });
    const jpg = new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Custom cursor file"), { target: { files: [jpg] } });
    expect(onUploadCustomCursor).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Use a PNG or SVG file.");
    // A subsequent valid upload clears the error.
    fireEvent.change(screen.getByLabelText("Custom cursor file"), { target: { files: [png()] } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onUploadCustomCursor).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty file selection", () => {
    const onUploadCustomCursor = vi.fn();
    setup({ onUploadCustomCursor }, { style: "custom" });
    fireEvent.change(screen.getByLabelText("Custom cursor file"), { target: { files: [] } });
    expect(onUploadCustomCursor).not.toHaveBeenCalled();
  });

  it("shows the uploaded file name with Replace", () => {
    setup(
      { onUploadCustomCursor: vi.fn() },
      {
        style: "custom",
        customCursor: { fileName: "arrow.svg", path: "/proj/arrow.svg", kind: "svg" },
      },
    );
    expect(screen.getByText("arrow.svg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Upload PNG or SVG…" })).toBeNull();
  });

  it("disables upload when the host provides no handler", () => {
    setup({}, { style: "custom" });
    expect(screen.getByRole("button", { name: "Upload PNG or SVG…" })).toBeDisabled();
  });
});

describe("CursorInspector — custom click sound", () => {
  it("offers a sound picker and forwards the file", () => {
    const onUploadCustomSound = vi.fn();
    setup(
      { onUploadCustomSound },
      { clickSound: { type: "custom", volume: 60, customSound: null } },
    );
    expect(screen.getByRole("button", { name: "Choose sound…" })).toBeEnabled();
    expect(screen.getByLabelText("Volume")).toBeEnabled();
    const wav = new File([new Uint8Array([1])], "click.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByLabelText("Custom click sound file"), {
      target: { files: [wav] },
    });
    expect(onUploadCustomSound).toHaveBeenCalledWith(wav);
  });

  it("shows the chosen sound name", () => {
    setup(
      {},
      {
        clickSound: {
          type: "custom",
          volume: 60,
          customSound: { fileName: "click.wav", path: "/p/click.wav" },
        },
      },
    );
    expect(screen.getByText("click.wav")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
  });
});

describe("CursorInspector — no telemetry", () => {
  it.each([null, 0])("explains and disables everything when point count is %s", (count) => {
    const { onChange } = setup({ cursorPointCount: count });
    expect(screen.getByRole("status")).toHaveTextContent(
      "No cursor data — rendered cursor unavailable",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "No cursor data — rendered cursor unavailable",
    );
    expect(screen.queryByText(/Tracked ✓/)).toBeNull();
    const master = screen.getByRole("switch", { name: "Show cursor" });
    expect(master).toBeDisabled();
    fireEvent.click(master);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "macOS" })).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
  });

  it("formats a single tracked point", () => {
    setup({ cursorPointCount: 1 });
    expect(screen.getByText("Tracked ✓ 1 point")).toBeInTheDocument();
  });
});
