import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Launcher, sampleLauncherProps } from "./Launcher";
import type { RecordOptions } from "./types";

describe("Launcher", () => {
  it("renders every source", () => {
    render(<Launcher {...sampleLauncherProps} />);
    for (const src of sampleLauncherProps.sources) {
      expect(screen.getByText(src.name)).toBeInTheDocument();
    }
  });

  it("highlights a source when selected", () => {
    render(<Launcher {...sampleLauncherProps} />);
    const listbox = screen.getByRole("listbox", { name: /capturable sources/i });
    const cards = within(listbox).getAllByRole("button");
    // First source is selected by default.
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    expect(cards[1]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(cards[1] as HTMLElement);
    expect(cards[1]).toHaveAttribute("aria-pressed", "true");
    expect(cards[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("updates fps via the Segmented control", () => {
    const onStart = vi.fn();
    render(<Launcher {...sampleLauncherProps} onStart={onStart} />);

    fireEvent.click(screen.getByLabelText("60"));
    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0]?.[0] as RecordOptions;
    expect(opts.fps).toBe(60);
  });

  it("calls onStart with the chosen options", () => {
    const onStart = vi.fn();
    render(<Launcher {...sampleLauncherProps} onStart={onStart} />);

    // Select the second source, then record.
    const listbox = screen.getByRole("listbox", { name: /capturable sources/i });
    const cards = within(listbox).getAllByRole("button");
    fireEvent.click(cards[1] as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: "Record" }));

    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0]?.[0] as RecordOptions;
    const secondSource = sampleLauncherProps.sources[1];
    expect(opts.sourceId).toBe(secondSource?.id);
    expect(opts.mode).toBe("screen");
    // System audio is unsupported in the fixture, so it must be forced false.
    expect(opts.systemAudio).toBe(false);
    expect(opts.mic).toBe(false);
  });
});
