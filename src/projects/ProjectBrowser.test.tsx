import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectBrowser } from "./ProjectBrowser";
import { sampleProjects } from "./types";
import type { ProjectSummary } from "./types";

function renderBrowser(overrides: Partial<Parameters<typeof ProjectBrowser>[0]> = {}) {
  const props = {
    projects: sampleProjects,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onImport: vi.fn(),
    onCardAction: vi.fn(),
    ...overrides,
  };
  render(<ProjectBrowser {...props} />);
  return props;
}

describe("ProjectBrowser", () => {
  it("renders one card per project", () => {
    renderBrowser();
    for (const p of sampleProjects) {
      expect(screen.getByText(p.name)).toBeInTheDocument();
    }
    // One overflow button per card.
    expect(screen.getAllByRole("button", { name: /Actions for/i })).toHaveLength(
      sampleProjects.length,
    );
  });

  it("shows the empty state and its CTA calls onNew", () => {
    const { onNew } = renderBrowser({ projects: [] });
    expect(screen.getByText("Nothing recorded yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record something" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("filters cards by search text (case-insensitive)", () => {
    renderBrowser();
    const search = screen.getByRole("searchbox", { name: /search projects/i });
    fireEvent.change(search, { target: { value: "dashboard" } });
    expect(screen.getByText("Dashboard demo")).toBeInTheDocument();
    expect(screen.queryByText("Onboarding walkthrough")).not.toBeInTheDocument();
  });

  it("clicking a card calls onOpen with its id", () => {
    const { onOpen } = renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Open Dashboard demo" }));
    expect(onOpen).toHaveBeenCalledWith("p2");
  });

  it("overflow menu click does not trigger onOpen", () => {
    const { onOpen } = renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Dashboard demo" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("delete action opens the dialog and confirming calls onCardAction with 'delete'", () => {
    const { onCardAction } = renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Dashboard demo" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete project?")).toBeInTheDocument();
    expect(onCardAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onCardAction).toHaveBeenCalledWith("p2", "delete");
  });

  it("rename action calls onCardAction with 'rename' immediately", () => {
    const { onCardAction } = renderBrowser();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Dashboard demo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onCardAction).toHaveBeenCalledWith("p2", "rename");
  });

  it("sorting by name orders cards alphabetically", () => {
    const projects: ProjectSummary[] = [
      { id: "a", name: "Zebra", modifiedAt: "2026-09-14T00:00:00.000Z", durationMs: 1000 },
      { id: "b", name: "Apple", modifiedAt: "2026-09-13T00:00:00.000Z", durationMs: 1000 },
    ];
    renderBrowser({ projects });
    fireEvent.click(screen.getByRole("radio", { name: "Name" }));
    const titles = screen.getAllByLabelText(/^Open /).map((el) => el.getAttribute("aria-label"));
    expect(titles).toEqual(["Open Apple", "Open Zebra"]);
  });
});
