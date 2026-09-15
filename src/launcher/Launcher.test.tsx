import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Launcher, sampleLauncherProps } from "./Launcher";
import type { RecordOptions } from "./types";

describe("Launcher", () => {
  it("lists displays for Screen and windows for Window", () => {
    render(<Launcher {...sampleLauncherProps} />);
    expect(screen.getByText("Built-in Retina Display")).toBeInTheDocument();
    expect(screen.getByText("LG UltraFine")).toBeInTheDocument();
    expect(screen.queryByText("Safari — Reelform")).toBeNull();
    fireEvent.click(screen.getByLabelText("Window"));
    expect(screen.getByText("Safari — Reelform")).toBeInTheDocument();
    expect(screen.queryByText("LG UltraFine")).toBeNull();
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

  it("keeps the selection across a source refresh and falls back when it disappears", () => {
    const onStart = vi.fn();
    const { rerender } = render(<Launcher {...sampleLauncherProps} onStart={onStart} />);
    const cards = within(screen.getByRole("listbox")).getAllByRole("button");
    fireEvent.click(cards[1] as HTMLElement);
    rerender(
      <Launcher
        {...sampleLauncherProps}
        sources={[...sampleLauncherProps.sources]}
        onStart={onStart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect((onStart.mock.calls[0]?.[0] as RecordOptions).sourceId).toBe("disp-2");
    rerender(
      <Launcher
        {...sampleLauncherProps}
        sources={sampleLauncherProps.sources.filter((s) => s.id !== "disp-2")}
        onStart={onStart}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect((onStart.mock.calls[1]?.[0] as RecordOptions).sourceId).toBe("disp-1");
  });

  it("loading, empty and error source states", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <Launcher {...sampleLauncherProps} sources={[]} sourcesStatus="loading" />,
    );
    expect(screen.getByTestId("launcher-sources-loading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
    rerender(<Launcher {...sampleLauncherProps} sources={[]} />);
    expect(screen.getByTestId("launcher-sources-empty")).toHaveTextContent("No displays found");
    rerender(
      <Launcher
        {...sampleLauncherProps}
        sourcesStatus="error"
        sourcesError="Screen capture failed"
        onRetrySources={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Screen capture failed");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });

  it("renders notices with actions and dismiss", () => {
    const action = vi.fn();
    const dismiss = vi.fn();
    render(
      <Launcher
        {...sampleLauncherProps}
        notices={[
          {
            id: "permission",
            tone: "danger",
            message: "Screen Recording permission is missing",
            action: { label: "Open System Settings", onClick: action },
            onDismiss: dismiss,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("launcher-notice-permission")).toHaveAttribute("data-tone", "danger");
    fireEvent.click(screen.getByRole("button", { name: "Open System Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(action).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("busy disables Record; defaults seed the options; region mode says Select region", () => {
    const onStart = vi.fn();
    const { unmount } = render(
      <Launcher {...sampleLauncherProps} onStart={onStart} busy busyLabel="Starting…" />,
    );
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    unmount();
    render(
      <Launcher
        {...sampleLauncherProps}
        onStart={onStart}
        defaults={{ mode: "region", fps: 60, countdown: 0, mic: true, hideCursor: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select region" }));
    expect(onStart.mock.calls[0]?.[0]).toMatchObject({
      mode: "region",
      sourceId: "disp-1",
      fps: 60,
      countdown: 0,
      mic: true,
      micDeviceId: "mic-default",
      hideCursor: true,
    });
  });
});
