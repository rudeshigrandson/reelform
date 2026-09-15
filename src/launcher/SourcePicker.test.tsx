import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcePicker, groupWindowsByApp, isOwnWindow, matchesQuery } from "./SourcePicker";
import type { PickerSource } from "./types";

const display = (id: string, name: string): PickerSource => ({
  id,
  kind: "display",
  name,
  title: name,
  width: 3024,
  height: 1964,
  minimized: false,
});

const win = (id: string, title: string, appName?: string, minimized = false): PickerSource => ({
  id,
  kind: "window",
  name: appName ? `${appName} — ${title}` : title,
  title,
  width: 1280,
  height: 720,
  minimized,
  ...(appName ? { appName } : {}),
});

const SOURCES: PickerSource[] = [
  display("d1", "Studio Display"),
  display("d2", "LG UltraFine"),
  win("w1", "Onboarding.fig", "Figma"),
  win("w2", "Design system.fig", "Figma"),
  win("w3", "Inbox", "Mail", true),
  win("w4", "Reelform", "Reelform"),
  win("w5", "Reelform"),
];

function renderPicker(props: Partial<Parameters<typeof SourcePicker>[0]> = {}) {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <SourcePicker sources={SOURCES} onSelect={onSelect} onCancel={onCancel} {...props} />,
  );
  return { onSelect, onCancel, ...utils };
}

describe("SourcePicker helpers", () => {
  it("own windows by app name, or by bare title when the backend reports no app", () => {
    expect(isOwnWindow(win("a", "Anything", "Reelform"), "Reelform")).toBe(true);
    expect(isOwnWindow(win("b", "reelform"), "Reelform")).toBe(true);
    expect(isOwnWindow(win("c", "Reelform notes", "Notes"), "Reelform")).toBe(false);
    expect(isOwnWindow(display("d", "Reelform"), "Reelform")).toBe(false);
  });

  it("search matches title or app, case-insensitive; blank matches all", () => {
    expect(matchesQuery(win("a", "Onboarding.fig", "Figma"), "FIG")).toBe(true);
    expect(matchesQuery(win("a", "Onboarding.fig", "Figma"), "board")).toBe(true);
    expect(matchesQuery(win("a", "Onboarding.fig", "Figma"), "mail")).toBe(false);
    expect(matchesQuery(win("a", "x"), "   ")).toBe(true);
  });

  it("groups by app in order of first appearance, unknown apps last-named 'Other windows'", () => {
    const groups = groupWindowsByApp([
      win("1", "a", "Figma"),
      win("2", "b"),
      win("3", "c", "Figma"),
    ]);
    expect(groups.map((g) => [g.app, g.windows.map((w) => w.id)])).toEqual([
      ["Figma", ["1", "3"]],
      ["Other windows", ["2"]],
    ]);
  });
});

describe("SourcePicker", () => {
  it("opens on Displays; Select is disabled until a tile is picked", () => {
    const { onSelect } = renderPicker();
    expect(screen.getByRole("tab", { name: "Displays" })).toHaveAttribute("aria-selected", "true");
    const select = screen.getByRole("button", { name: "Select" });
    expect(select).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "LG UltraFine" }));
    expect(screen.getByRole("button", { name: "LG UltraFine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "d2" }));
  });

  it("opens on Windows for a selected window; groups by app, dims minimized, hides own windows", () => {
    renderPicker({ selectedId: "w1" });
    expect(screen.getByRole("tab", { name: "Windows" })).toHaveAttribute("aria-selected", "true");
    const groups = screen.getAllByTestId("picker-group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Figma", "Mail"]);
    expect(within(groups[0] as HTMLElement).getAllByRole("button")).toHaveLength(2);
    const minimized = screen.getByTestId("picker-source-w3");
    expect(minimized).toHaveAttribute("data-minimized", "true");
    expect(within(minimized).getByText("Minimized")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-source-w4")).toBeNull();
    expect(screen.queryByTestId("picker-source-w5")).toBeNull();
    // Pre-selected window can be confirmed straight away.
    expect(screen.getByRole("button", { name: "Select" })).toBeEnabled();

    fireEvent.click(screen.getByLabelText("Exclude Reelform windows"));
    expect(screen.getByTestId("picker-source-w4")).toBeInTheDocument();
    expect(screen.getByTestId("picker-source-w5")).toBeInTheDocument();
  });

  it("search narrows windows and shows a no-results state", () => {
    renderPicker({ initialTab: "windows" });
    const search = screen.getByRole("searchbox", { name: "Search windows" });
    fireEvent.change(search, { target: { value: "design" } });
    expect(
      screen.getAllByTestId(/^picker-source-/).map((o) => o.getAttribute("aria-label")),
    ).toEqual(["Design system.fig"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByTestId("picker-no-results")).toHaveTextContent("No windows match “zzz”.");
  });

  it("a pick hidden by search can't be selected", () => {
    const { onSelect } = renderPicker({ initialTab: "windows" });
    fireEvent.click(screen.getByRole("button", { name: "Onboarding.fig" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mail" } });
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the pick across a live refresh with new thumbnails", () => {
    const { rerender, onSelect, onCancel } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Studio Display" }));
    const refreshed = SOURCES.map((s) => ({ ...s, thumbnailUrl: `data:image/png;base64,${s.id}` }));
    rerender(<SourcePicker sources={refreshed} onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });

  it("no windows, no displays, loading and error states", () => {
    const { rerender, onSelect, onCancel } = renderPicker({
      sources: [display("d1", "Studio Display"), win("w4", "Reelform", "Reelform")],
      initialTab: "windows",
    });
    expect(screen.getByTestId("picker-no-windows")).toHaveTextContent("No windows to record");
    rerender(<SourcePicker sources={[]} onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("tab", { name: "Displays" }));
    expect(screen.getByTestId("picker-empty")).toHaveTextContent("No displays found");
    rerender(
      <SourcePicker sources={[]} status="loading" onSelect={onSelect} onCancel={onCancel} />,
    );
    expect(screen.getByTestId("picker-loading")).toBeInTheDocument();
    rerender(
      <SourcePicker
        sources={SOURCES}
        status="error"
        error="Screen capture failed"
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Screen capture failed");
  });

  it("Cancel and Escape cancel", () => {
    const { onCancel } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Choose a source" }), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
