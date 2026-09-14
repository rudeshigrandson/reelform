import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ExportDialog, sampleExportProps } from "./ExportDialog";
import type { ExportUiConfig } from "./types";

/** Read the Mbps number out of the bitrate readout ("16.0 Mbps" → 16). */
function readMbps(): number {
  const el = screen.getByTestId("bitrate-value");
  const match = el.textContent?.match(/([\d.]+)\s*Mbps/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

/** Click a Segmented option by its visible label. */
function selectSegment(label: string): void {
  fireEvent.click(screen.getByText(label));
}

describe("ExportDialog", () => {
  it("renders the format and quality Segmented controls", () => {
    render(<ExportDialog {...sampleExportProps} />);
    // Format options
    expect(screen.getByText("MP4")).toBeInTheDocument();
    expect(screen.getByText("GIF")).toBeInTheDocument();
    expect(screen.getByText("WebM")).toBeInTheDocument();
    // Quality options
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Max")).toBeInTheDocument();
  });

  it("updates the bitrate readout when quality changes High → Max", () => {
    render(<ExportDialog {...sampleExportProps} />);
    const high = readMbps();
    selectSegment("Max");
    const max = readMbps();
    expect(max).toBeGreaterThan(high);
  });

  it("hides the codec Segmented for GIF", () => {
    render(<ExportDialog {...sampleExportProps} />);
    // H.264 codec option present for the default MP4 format.
    expect(screen.getByText("H.264")).toBeInTheDocument();
    selectSegment("GIF");
    expect(screen.queryByText("H.264")).not.toBeInTheDocument();
    // And the readout falls back to "size varies".
    expect(screen.getByTestId("size-value")).toHaveTextContent("size varies");
  });

  it("calls onExport with the chosen config", () => {
    const onExport = vi.fn<(c: ExportUiConfig) => void>();
    render(<ExportDialog {...sampleExportProps} onExport={onExport} />);

    selectSegment("Max");
    selectSegment("30");
    selectSegment("HEVC");

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalledTimes(1);
    const config = onExport.mock.calls[0]?.[0];
    expect(config).toMatchObject({
      format: "mp4",
      quality: "Max",
      fps: 30,
      codec: "hevc",
    });
  });

  it("shows the progress view with phase label and percent when rendering", () => {
    render(
      <ExportDialog {...sampleExportProps} phase="rendering" progress={0.42} />,
    );
    expect(screen.getByTestId("progress-phase")).toHaveTextContent("Rendering");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
    // The configuration form is gone (no format Segmented).
    expect(screen.queryByText("MP4")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
  });

  it("renders the success actions when done", () => {
    render(<ExportDialog {...sampleExportProps} phase="done" />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Reveal in Finder")).toBeInTheDocument();
    expect(within(dialog).getByText("Copy")).toBeInTheDocument();
    expect(within(dialog).getByText("Close")).toBeInTheDocument();
  });
});
