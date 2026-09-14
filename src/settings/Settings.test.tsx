import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Settings, sampleSettings } from "./Settings";
import type { SettingsPatch } from "./types";

function setup(overrides?: Partial<Parameters<typeof Settings>[0]>) {
  const onChange = vi.fn<(patch: SettingsPatch) => void>();
  render(<Settings settings={sampleSettings} onChange={onChange} {...overrides} />);
  return { onChange };
}

describe("Settings", () => {
  it("renders all 7 nav sections", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    for (const label of [
      "General",
      "Recording",
      "Audio",
      "Captions",
      "Shortcuts",
      "Advanced",
      "About",
    ]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("clicking Recording switches the panel", () => {
    setup();
    // Recording-only control is absent initially.
    expect(screen.queryByText(/capture backend/i)).not.toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: /settings sections/i });
    fireEvent.click(within(nav).getByRole("button", { name: "Recording" }));

    expect(screen.getByText(/capture backend/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recording" })).toBeInTheDocument();
  });

  it("changing the theme Segmented calls onChange with { theme }", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("toggling auto-prune calls onChange", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText(/auto-prune old recordings/i));
    expect(onChange).toHaveBeenCalledWith({ autoPrune: true });
  });
});
