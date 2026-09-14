import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorShell } from "./EditorShell";
import { INSPECTOR_TABS, TIMELINE_LANES, sampleEditorShellProps } from "./types";

describe("EditorShell", () => {
  it("renders the top bar with an Export button that calls onExport", async () => {
    const onExport = vi.fn();
    render(<EditorShell {...sampleEditorShellProps} onExport={onExport} />);

    const exportBtn = screen.getByRole("button", { name: "Export" });
    expect(exportBtn).toBeInTheDocument();

    await userEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("renders all 9 inspector tabs", () => {
    render(<EditorShell {...sampleEditorShellProps} />);
    const tablist = screen.getByRole("tablist");
    for (const tab of INSPECTOR_TABS) {
      expect(within(tablist).getByRole("tab", { name: tab })).toBeInTheDocument();
    }
    expect(within(tablist).getAllByRole("tab")).toHaveLength(9);
  });

  it("switches the active tab when a tab is clicked (heading changes)", async () => {
    render(<EditorShell {...sampleEditorShellProps} />);
    const panel = screen.getByRole("tabpanel");

    // Default active tab is Frame.
    expect(within(panel).getByRole("heading")).toHaveTextContent("Frame");

    await userEvent.click(screen.getByRole("tab", { name: "Captions" }));
    expect(within(panel).getByRole("heading")).toHaveTextContent("Captions");

    await userEvent.click(screen.getByRole("tab", { name: "Zoom" }));
    expect(within(panel).getByRole("heading")).toHaveTextContent("Zoom");
  });

  it("shows the 5 timeline track lane labels", () => {
    render(<EditorShell {...sampleEditorShellProps} />);
    const timeline = screen.getByRole("region", { name: "Timeline" });
    for (const lane of TIMELINE_LANES) {
      expect(within(timeline).getByText(lane)).toBeInTheDocument();
    }
  });
});
