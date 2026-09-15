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

  describe("project chrome", () => {
    it("Back calls onBack; dirty shows the unsaved dot", async () => {
      const onBack = vi.fn();
      const { rerender } = render(<EditorShell {...sampleEditorShellProps} onBack={onBack} />);
      expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onBack).toHaveBeenCalledTimes(1);
      rerender(<EditorShell {...sampleEditorShellProps} onBack={onBack} dirty />);
      expect(screen.getByLabelText("Unsaved changes")).toHaveTextContent("•");
    });

    it("undo/redo buttons carry the history labels as tooltips and disable when empty", async () => {
      const onUndo = vi.fn();
      const onRedo = vi.fn();
      const { rerender } = render(
        <EditorShell
          {...sampleEditorShellProps}
          history={{
            canUndo: true,
            canRedo: false,
            undoLabel: "Undo: Move zoom",
            redoLabel: null,
            onUndo,
            onRedo,
          }}
        />,
      );
      const undo = screen.getByRole("button", { name: "Undo" });
      expect(undo).toHaveAttribute("title", "Undo: Move zoom");
      expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
      await userEvent.click(undo);
      expect(onUndo).toHaveBeenCalledTimes(1);
      rerender(
        <EditorShell
          {...sampleEditorShellProps}
          history={{
            canUndo: false,
            canRedo: true,
            undoLabel: null,
            redoLabel: "Redo: Split clip",
            onUndo,
            onRedo,
          }}
        />,
      );
      expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
        "title",
        "Nothing to undo",
      );
      await userEvent.click(screen.getByRole("button", { name: "Redo" }));
      expect(onRedo).toHaveBeenCalledTimes(1);
    });

    it("hides undo/redo when no history is given", () => {
      render(<EditorShell {...sampleEditorShellProps} />);
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
  });

  describe("controlled tab", () => {
    it("follows activeTab and reports clicks through onTabChange", async () => {
      const onTabChange = vi.fn();
      const { rerender } = render(
        <EditorShell {...sampleEditorShellProps} activeTab="Zoom" onTabChange={onTabChange} />,
      );
      const panel = () => screen.getByRole("tabpanel");
      expect(within(panel()).getByRole("heading")).toHaveTextContent("Zoom");
      await userEvent.click(screen.getByRole("tab", { name: "Audio" }));
      expect(onTabChange).toHaveBeenCalledWith("Audio");
      // Still controlled: the parent has not changed activeTab yet.
      expect(within(panel()).getByRole("heading")).toHaveTextContent("Zoom");
      rerender(
        <EditorShell {...sampleEditorShellProps} activeTab="Captions" onTabChange={onTabChange} />,
      );
      expect(within(panel()).getByRole("heading")).toHaveTextContent("Captions");
    });
  });

  describe("narrow layout (guide S12 state 14)", () => {
    it("collapses the inspector to a rail with a toggling popover and a 180px timeline", async () => {
      render(
        <EditorShell
          {...sampleEditorShellProps}
          narrow
          renderPlaybackBar={() => <div />}
          renderInspector={(tab) => <p>body:{tab}</p>}
        />,
      );
      const shell = screen.getByTestId("editor-shell");
      expect(shell.dataset.layout).toBe("narrow");
      expect(shell.style.gridTemplateRows).toBe("56px 1fr 44px 180px");
      expect(screen.queryByRole("tabpanel")).toBeNull();
      expect(screen.getAllByRole("tab")).toHaveLength(9);

      await userEvent.click(screen.getByRole("tab", { name: "Zoom" }));
      expect(screen.getByRole("tabpanel", { name: "Zoom panel" })).toHaveTextContent("body:Zoom");
      expect(screen.getByRole("tab", { name: "Zoom" })).toHaveAttribute("aria-expanded", "true");

      await userEvent.click(screen.getByRole("tab", { name: "Audio" }));
      expect(screen.getByRole("tabpanel", { name: "Audio panel" })).toBeInTheDocument();

      await userEvent.click(screen.getByRole("tab", { name: "Audio" }));
      expect(screen.queryByRole("tabpanel")).toBeNull();

      await userEvent.click(screen.getByRole("tab", { name: "Frame" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("tabpanel")).toBeNull();
    });

    it("follows matchMedia when narrow is not given", () => {
      const listeners = new Set<() => void>();
      const mql = {
        matches: true,
        addEventListener: (_: string, l: () => void) => listeners.add(l),
        removeEventListener: (_: string, l: () => void) => listeners.delete(l),
      };
      const original = window.matchMedia;
      window.matchMedia = vi.fn(() => mql) as unknown as typeof window.matchMedia;
      try {
        render(<EditorShell {...sampleEditorShellProps} />);
        expect(screen.getByTestId("editor-shell").dataset.layout).toBe("narrow");
        expect(screen.getByTestId("editor-shell").style.gridTemplateRows).toBe("56px 1fr 180px");
      } finally {
        window.matchMedia = original;
      }
    });
  });
});
