import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorShell } from "./EditorShell";
import { sampleEditorShellProps } from "./types";

/** Top-bar project name (S12): edits a draft, commits on blur / Enter, Escape reverts. */

const nameInput = () => screen.getByRole("textbox", { name: "Project name" });

describe("EditorShell rename", () => {
  it("is read-only without onRename", () => {
    render(<EditorShell {...sampleEditorShellProps} />);
    expect(nameInput()).toHaveAttribute("readonly");
  });

  it("typing does not rename; blur commits the trimmed name once", () => {
    const onRename = vi.fn();
    render(<EditorShell {...sampleEditorShellProps} onRename={onRename} />);
    fireEvent.change(nameInput(), { target: { value: "  Launch video " } });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.blur(nameInput());
    expect(onRename).toHaveBeenCalledWith("Launch video");
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("Enter commits; unchanged or empty names do not", () => {
    const onRename = vi.fn();
    render(<EditorShell {...sampleEditorShellProps} onRename={onRename} />);
    nameInput().focus();
    fireEvent.change(nameInput(), { target: { value: "Launch" } });
    fireEvent.keyDown(nameInput(), { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Launch");

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.blur(nameInput());
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(nameInput()).toHaveValue(sampleEditorShellProps.projectName);
  });

  it("Escape reverts the draft without renaming", () => {
    const onRename = vi.fn();
    render(<EditorShell {...sampleEditorShellProps} onRename={onRename} />);
    nameInput().focus();
    fireEvent.change(nameInput(), { target: { value: "Oops" } });
    fireEvent.keyDown(nameInput(), { key: "Escape" });
    fireEvent.blur(nameInput());
    expect(onRename).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue(sampleEditorShellProps.projectName);
  });

  it("a rename that resolves false reverts the field to the current name", async () => {
    const onRename = vi.fn(async () => false);
    render(<EditorShell {...sampleEditorShellProps} onRename={onRename} />);
    fireEvent.change(nameInput(), { target: { value: "Taken" } });
    fireEvent.blur(nameInput());
    expect(onRename).toHaveBeenCalledWith("Taken");
    await waitFor(() => expect(nameInput()).toHaveValue(sampleEditorShellProps.projectName));
  });

  it("follows the project name after a committed rename", () => {
    const { rerender } = render(<EditorShell {...sampleEditorShellProps} onRename={() => {}} />);
    rerender(<EditorShell {...sampleEditorShellProps} projectName="Renamed" onRename={() => {}} />);
    expect(nameInput()).toHaveValue("Renamed");
  });
});
