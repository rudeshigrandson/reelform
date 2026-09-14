import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeInfo } from "./fixtures";
import { ProjectInspector, type ProjectInspectorProps } from "./index";

function setup(overrides: Partial<ProjectInspectorProps> = {}) {
  const props: ProjectInspectorProps = {
    info: makeInfo(),
    onRename: vi.fn(),
    onReveal: vi.fn(),
    onRelink: vi.fn(),
    saveRaw: true,
    onSaveRawChange: vi.fn(),
    trimSavingsBytes: 1.2 * 1024 ** 3,
    onTrim: vi.fn(),
    onDelete: vi.fn(),
    locale: "en-US",
    timeZone: "UTC",
    ...overrides,
  };
  const utils = render(<ProjectInspector {...props} />);
  return { props, ...utils };
}

describe("ProjectInspector", () => {
  it("renders project and recording info", () => {
    setup();
    expect(screen.getByLabelText("Name")).toHaveValue("Onboarding flow walkthrough");
    expect(screen.getByTestId("project-location")).toHaveTextContent(
      "/Users/me/Movies/Reelform/Onboarding flow walkthrough.reelform",
    );
    expect(screen.getByText(/^Sep 14, 2026,?\s3:04\sPM$/)).toBeInTheDocument();
    expect(screen.getByText("recording/screen.mp4")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("3024 × 1964")).toBeInTheDocument();
    expect(screen.getByText("60 fps")).toBeInTheDocument();
    expect(screen.getByText("00:42.180")).toBeInTheDocument();
    expect(screen.getByText("ScreenCaptureKit")).toBeInTheDocument();
    expect(screen.getByText("2,531 points")).toBeInTheDocument();
    expect(screen.getByText("MacBook Pro Microphone")).toBeInTheDocument();
    expect(screen.getByText("System audio")).toBeInTheDocument();
  });

  it("renders unknown recording metadata gracefully", () => {
    const base = makeInfo();
    setup({
      info: { ...base, recording: { ...base.recording, captureBackend: null, cursorPointCount: null, audioTracks: [] } },
    });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getAllByText("None")).toHaveLength(2);
  });

  it("renames on Enter / blur with trimmed value and ignores empty or unchanged", () => {
    const { props } = setup();
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "  Launch demo  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("Launch demo");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(props.onRename).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Onboarding flow walkthrough");

    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("Onboarding flow walkthrough");
    fireEvent.blur(input);
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it("reveals the project location and the source file", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(props.onReveal).toHaveBeenCalledWith("/Users/me/Movies/Reelform/Onboarding flow walkthrough.reelform");
    fireEvent.click(screen.getByRole("button", { name: "Reveal recording/screen.mp4" }));
    expect(props.onReveal).toHaveBeenLastCalledWith(
      "/Users/me/Movies/Reelform/Onboarding flow walkthrough.reelform/recording/screen.mp4",
    );
  });

  it("toggles save raw", () => {
    const { props } = setup({ saveRaw: false });
    fireEvent.click(screen.getByRole("switch", { name: "Save raw with project" }));
    expect(props.onSaveRawChange).toHaveBeenCalledWith(true);
  });

  it("shows missing-media state with relink emphasis", () => {
    const base = makeInfo();
    const src = base.sources[0]!;
    const { props } = setup({ info: { ...base, sources: [{ ...src, missing: true, sizeBytes: null }] } });
    expect(screen.getByText("Media offline")).toBeInTheDocument();
    const row = screen.getByTestId("source-recording/screen.mp4");
    expect(within(row).getByText("Missing")).toBeInTheDocument();
    expect(within(row).getByText(src.absolutePath)).toBeInTheDocument();
    const relink = within(row).getByRole("button", { name: "Relink media…" });
    expect(relink).toHaveClass("btn-primary");
    expect(within(row).queryByRole("button", { name: /Reveal/ })).toBeNull();
    fireEvent.click(relink);
    expect(props.onRelink).toHaveBeenCalledWith("recording/screen.mp4");
    // Can't trim a source that isn't there.
    expect(screen.getByRole("button", { name: /Trim source/ })).toBeDisabled();
  });

  it("relink is secondary when media is present", () => {
    setup();
    expect(screen.getByRole("button", { name: "Relink media…" })).toHaveClass("btn-secondary");
    expect(screen.queryByText("Media offline")).toBeNull();
  });

  it("trim button shows savings and fires onTrim", () => {
    const { props } = setup();
    const btn = screen.getByRole("button", { name: "Trim source to used range (saves 1.2 GB)" });
    fireEvent.click(btn);
    expect(props.onTrim).toHaveBeenCalledOnce();
  });

  it("trim button is disabled with zero savings and hidden when unknown", () => {
    const { rerender, props } = setup({ trimSavingsBytes: 0 });
    expect(screen.getByRole("button", { name: "Trim source to used range" })).toBeDisabled();
    rerender(<ProjectInspector {...props} trimSavingsBytes={null} />);
    expect(screen.queryByRole("button", { name: /Trim source/ })).toBeNull();
  });

  it("delete: cancel closes without deleting", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete project?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("delete: Escape closes without deleting", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("delete: confirm calls onDelete with the recordings option", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith({ alsoDeleteRecordings: false });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Also delete recording files"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenLastCalledWith({ alsoDeleteRecordings: true });
  });

  it("resets the recordings checkbox after cancel", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    fireEvent.click(screen.getByLabelText("Also delete recording files"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(screen.getByLabelText("Also delete recording files")).not.toBeChecked();
  });
});
