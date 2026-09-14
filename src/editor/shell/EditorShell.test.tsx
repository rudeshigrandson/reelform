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

  it("renders the active tab body through renderInspector", async () => {
    const renderInspector = vi.fn((tab: string) => <p>body:{tab}</p>);
    render(<EditorShell {...sampleEditorShellProps} renderInspector={renderInspector} />);
    const panel = screen.getByRole("tabpanel");

    expect(within(panel).getByText("body:Frame")).toBeInTheDocument();
    expect(within(panel).queryByText("Frame inspector")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Audio" }));
    expect(within(panel).getByText("body:Audio")).toBeInTheDocument();
    expect(renderInspector).toHaveBeenLastCalledWith("Audio");
  });

  it("shows the 5 timeline track lane labels", () => {
    render(<EditorShell {...sampleEditorShellProps} />);
    const timeline = screen.getByRole("region", { name: "Timeline" });
    for (const lane of TIMELINE_LANES) {
      expect(within(timeline).getByText(lane)).toBeInTheDocument();
    }
  });

  describe("render slots", () => {
    it("falls back to placeholders when no slots are given", () => {
      render(<EditorShell {...sampleEditorShellProps} />);
      expect(screen.getByLabelText("Preview")).toHaveTextContent("Preview");
      expect(screen.getByTestId("playhead")).toBeInTheDocument();
      expect(screen.queryByTestId("playback-slot")).toBeNull();
    });

    it("renders the preview slot in place of the placeholder box", () => {
      render(
        <EditorShell
          {...sampleEditorShellProps}
          renderPreview={() => <canvas data-testid="preview-slot" />}
        />,
      );
      expect(screen.getByTestId("preview-slot")).toBeInTheDocument();
      expect(screen.queryByLabelText("Preview")).toBeNull();
    });

    it("renders the timeline slot inside the Timeline region, replacing lanes", () => {
      render(
        <EditorShell
          {...sampleEditorShellProps}
          renderTimeline={() => <div data-testid="timeline-slot" />}
        />,
      );
      const timeline = screen.getByRole("region", { name: "Timeline" });
      expect(within(timeline).getByTestId("timeline-slot")).toBeInTheDocument();
      expect(within(timeline).queryByTestId("playhead")).toBeNull();
      for (const lane of TIMELINE_LANES) {
        expect(within(timeline).queryByText(lane)).toBeNull();
      }
    });

    it("adds a playback row only when the playback bar slot is given", () => {
      render(
        <EditorShell
          {...sampleEditorShellProps}
          renderPlaybackBar={() => <div data-testid="playback-slot" />}
        />,
      );
      expect(screen.getByTestId("playback-slot")).toBeInTheDocument();
      expect(screen.getByTestId("editor-shell").style.gridTemplateRows).toBe("56px 1fr 44px 260px");
      // Transport lives in the bar; the top bar must not duplicate Play.
      expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });

    it("keeps the inspector working alongside all slots", async () => {
      render(
        <EditorShell
          {...sampleEditorShellProps}
          renderPreview={() => <div />}
          renderPlaybackBar={() => <div />}
          renderTimeline={() => <div />}
        />,
      );
      await userEvent.click(screen.getByRole("tab", { name: "Effects" }));
      expect(within(screen.getByRole("tabpanel")).getByRole("heading")).toHaveTextContent(
        "Effects",
      );
    });
  });
});
