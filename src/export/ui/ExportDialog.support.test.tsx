import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportDialog, sampleExportProps } from "./ExportDialog";
import type { ExportUiConfig } from "./types";

describe("ExportDialog — device support, estimates and extras", () => {
  it("greys unsupported codecs, ignores clicks on them and explains why", () => {
    const onExport = vi.fn<(c: ExportUiConfig) => void>();
    render(
      <ExportDialog
        {...sampleExportProps}
        onExport={onExport}
        unsupportedCodecs={{ hevc: "Not supported on this device" }}
      />,
    );
    expect(screen.getByTestId("codec-unsupported-note")).toHaveTextContent(
      "HEVC: Not supported on this device",
    );
    fireEvent.click(screen.getByText("HEVC"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport.mock.calls[0]?.[0].codec).toBe("h264");
  });

  it("switching format picks the first supported codec", () => {
    const onConfigChange = vi.fn<(c: ExportUiConfig) => void>();
    render(
      <ExportDialog
        {...sampleExportProps}
        onConfigChange={onConfigChange}
        initialConfig={{
          format: "webm",
          width: 1920,
          height: 1080,
          fps: 60,
          codec: "vp9",
          quality: "High",
          destinationPath: "",
        }}
        unsupportedCodecs={{ h264: "Not supported on this device" }}
      />,
    );
    fireEvent.click(screen.getByText("MP4"));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ format: "mp4", codec: "hevc" }),
    );
  });

  it("shows the parent's size estimate, controlled destination, issues and extras", () => {
    const onExport = vi.fn<(c: ExportUiConfig) => void>();
    render(
      <ExportDialog
        {...sampleExportProps}
        onExport={onExport}
        sizeEstimate="24 MB"
        destinationPath="/Users/me/Movies"
        issues={["Enter a file name"]}
      >
        <div data-testid="extra-options" />
      </ExportDialog>,
    );
    expect(screen.getByTestId("size-value")).toHaveTextContent("~24 MB");
    expect(screen.getByLabelText("Destination")).toHaveValue("/Users/me/Movies");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a file name");
    expect(screen.getByTestId("extra-options")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport.mock.calls[0]?.[0].destinationPath).toBe("/Users/me/Movies");
  });

  it("GIF uses the provided estimate and Export can be disabled", () => {
    render(<ExportDialog {...sampleExportProps} sizeEstimate="3 MB" exportDisabled />);
    fireEvent.click(screen.getByText("GIF"));
    expect(screen.getByTestId("size-value")).toHaveTextContent("~3 MB");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
