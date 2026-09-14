import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { INSPECTOR_TABS } from "../editor/shell/types";
import { useEditorStore } from "../editor/store";
import { useAppStore } from "./store";

beforeEach(() => {
  useAppStore.setState({
    view: "onboarding",
    recording: null,
    exportOpen: false,
    exportPhase: "idle",
    activeProjectName: null,
  });
});

describe("App shell", () => {
  it("shows onboarding first", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("dev nav switches to the launcher", () => {
    useAppStore.setState({ view: "projects" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Launcher" }));
    // Launcher's primary record action appears
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
  });

  it("opens the export dialog from the editor", () => {
    useAppStore.setState({ view: "editor", activeProjectName: "Demo" });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("editor inspector tabs render their real panels and write to the editor store", () => {
    useEditorStore.getState().reset();
    useAppStore.setState({ view: "editor", activeProjectName: "Demo" });
    render(<App />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).queryByText("Frame inspector")).toBeNull();

    // Every tab mounts without throwing and replaces the placeholder.
    for (const tab of INSPECTOR_TABS) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(within(panel).queryByText(`${tab} inspector`)).toBeNull();
    }

    // A control edit flows into the store.
    fireEvent.click(screen.getByRole("tab", { name: "Cursor" }));
    const before = useEditorStore.getState().cursor.show;
    fireEvent.click(within(panel).getByRole("switch", { name: /show cursor/i }));
    expect(useEditorStore.getState().cursor.show).toBe(!before);
  });

  it("shows the recording HUD while recording, and stopping opens the editor", () => {
    useAppStore.setState({
      view: "launcher",
      recording: {
        phase: "recording",
        elapsedMs: 5000,
        sourceLabel: "Display 1",
        micLevel: 0.5,
      },
    });
    render(<App />);
    // HUD stop button -> stopRecording -> editor view
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(useAppStore.getState().view).toBe("editor");
  });
});
