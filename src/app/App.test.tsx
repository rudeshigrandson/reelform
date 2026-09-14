import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
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
