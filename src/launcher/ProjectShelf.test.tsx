import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Launcher, sampleLauncherProjects, sampleLauncherProps } from "./Launcher";
import { formatEdited, formatTimecode } from "./ProjectShelf";
import { launcherT } from "./i18n";

describe("Launcher shelf (S04/01)", () => {
  it("opens on Recent projects with 2-column cards, duration chips and edited times", () => {
    const onOpen = vi.fn();
    render(
      <Launcher
        {...sampleLauncherProps}
        projects={sampleLauncherProjects}
        onOpenProject={onOpen}
      />,
    );
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /capturable sources/i })).toBeNull();
    const list = screen.getByRole("list", { name: "Projects" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    const first = screen.getByTestId("launcher-project-p1");
    expect(within(first).getByTestId("launcher-project-duration")).toHaveTextContent("00:42.180");
    fireEvent.click(within(first).getByRole("button", { name: /Onboarding flow walkthrough/ }));
    expect(onOpen).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-current", "page");
  });

  it("search filters cards and reports no matches", () => {
    render(<Launcher {...sampleLauncherProps} projects={sampleLauncherProjects} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "cli" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByTestId("launcher-shelf-no-results")).toHaveTextContent("No projects match");
  });

  it("New recording opens the capture setup; close returns to the shelf", () => {
    const onStart = vi.fn();
    render(
      <Launcher {...sampleLauncherProps} onStart={onStart} projects={sampleLauncherProjects} />,
    );
    const pill = screen.getByRole("button", { name: "New recording" });
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("60"));
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ fps: 60, sourceId: "disp-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeInTheDocument();
  });

  it("All projects and Trash nav with counts; menu and Open project… callbacks", () => {
    const onMenu = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <Launcher
        {...sampleLauncherProps}
        projects={sampleLauncherProjects}
        trashedProjects={[]}
        onProjectMenu={onMenu}
        onOpenProjectFile={onOpenFile}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Projects" });
    fireEvent.click(within(nav).getByRole("button", { name: /All projects/ }));
    expect(within(nav).getByRole("button", { name: /All projects/ })).toHaveTextContent("4");
    expect(screen.getByRole("heading", { name: "All projects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions for CLI release demo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate…" }));
    expect(onMenu).toHaveBeenCalledWith("p2", "duplicate");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Trash" }));
    expect(screen.getByTestId("launcher-shelf-trash-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    expect(onOpenFile).toHaveBeenCalledOnce();
  });

  it("footer shows Settings, Help and version", () => {
    const settings = vi.fn();
    const help = vi.fn();
    render(
      <Launcher
        {...sampleLauncherProps}
        onOpenSettings={settings}
        onOpenHelp={help}
        version="1.1.4"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(settings).toHaveBeenCalledOnce();
    expect(help).toHaveBeenCalledOnce();
    expect(screen.getByTestId("launcher-version")).toHaveTextContent("1.1.4");
  });

  it("without projects the capture setup is shown and there is no nav", () => {
    render(<Launcher {...sampleLauncherProps} />);
    expect(screen.getByRole("group", { name: /capturable sources/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to projects" })).toBeNull();
  });

  it("loading and error shelf states", () => {
    const { rerender } = render(
      <Launcher {...sampleLauncherProps} projects={[]} projectsStatus="loading" />,
    );
    expect(screen.getByTestId("launcher-shelf-loading")).toBeInTheDocument();
    rerender(<Launcher {...sampleLauncherProps} projects={[]} projectsStatus="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load projects.");
  });
});

describe("Launcher project card menu", () => {
  function renderWithMenu(extra: Partial<Parameters<typeof Launcher>[0]> = {}) {
    const onMenu = vi.fn();
    render(
      <Launcher
        {...sampleLauncherProps}
        projects={sampleLauncherProjects}
        trashedProjects={[sampleLauncherProjects[0] as (typeof sampleLauncherProjects)[number]]}
        onProjectMenu={onMenu}
        {...extra}
      />,
    );
    return onMenu;
  }

  it("lists shelf actions, with platform reveal wording only when revealing is possible", () => {
    const { unmount } = render(
      <Launcher
        {...sampleLauncherProps}
        projects={sampleLauncherProjects}
        onProjectMenu={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions for CLI release demo" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Rename…",
      "Duplicate…",
      "Move to Trash",
    ]);
    unmount();
    renderWithMenu({ canRevealProjects: true, platform: "win32" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for CLI release demo" }));
    expect(screen.getByRole("menuitem", { name: "Show in Explorer" })).toBeInTheDocument();
  });

  it("is keyboard accessible: focus, arrows, Enter, Escape returns focus", () => {
    const onMenu = renderWithMenu({ canRevealProjects: true, platform: "darwin" });
    const trigger = screen.getByRole("button", { name: "More actions for CLI release demo" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Duplicate…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onMenu).not.toHaveBeenCalled();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
    expect(onMenu).toHaveBeenCalledWith("p2", "reveal");
  });

  it("closes on an outside click", () => {
    renderWithMenu();
    fireEvent.click(screen.getByRole("button", { name: "More actions for CLI release demo" }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Trash cards offer Restore and Delete forever", () => {
    const onMenu = renderWithMenu();
    const nav = screen.getByRole("navigation", { name: "Projects" });
    fireEvent.click(within(nav).getByRole("button", { name: /Trash/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "More actions for Onboarding flow walkthrough" }),
    );
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Restore",
      "Delete forever…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete forever…" }));
    expect(onMenu).toHaveBeenCalledWith("p1", "deleteForever");
  });

  it("renders a real thumbnail when the project has one", () => {
    render(
      <Launcher
        {...sampleLauncherProps}
        projects={[
          {
            ...(sampleLauncherProjects[0] as (typeof sampleLauncherProjects)[number]),
            thumbnailUrl: "reelform-media://p-1/thumbnail.jpg",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("launcher-project-thumbnail").style.backgroundImage).toContain(
      "reelform-media://p-1/thumbnail.jpg",
    );
  });
});

describe("Launcher inset title bar", () => {
  const notice = {
    id: "update",
    tone: "info" as const,
    message: "Update ready",
    onDismiss: () => {},
  };

  it("off by default: no drag strip, notices sit at the top as before", () => {
    render(<Launcher {...sampleLauncherProps} notices={[notice]} />);
    expect(screen.queryByTestId("launcher-titlebar")).toBeNull();
    expect(screen.getByTestId("launcher-notice-update")).toBeInTheDocument();
  });

  it("on: an empty drag strip clears the traffic lights", () => {
    render(<Launcher {...sampleLauncherProps} insetTitleBar />);
    const bar = screen.getByTestId("launcher-titlebar");
    expect(bar).toHaveAttribute("data-app-region", "drag");
    expect(bar.style.paddingLeft).toBe("80px");
    expect(bar.style.minHeight).toBe("40px");
    expect(bar).toBeEmptyDOMElement();
  });

  it("on: notices move into the strip with no-drag controls", () => {
    render(<Launcher {...sampleLauncherProps} insetTitleBar notices={[notice]} />);
    const bar = screen.getByTestId("launcher-titlebar");
    const banner = within(bar).getByTestId("launcher-notice-update");
    const dismiss = within(banner).getByRole("button", { name: "Dismiss" });
    expect(dismiss.closest("[data-app-region]")).toHaveAttribute("data-app-region", "no-drag");
  });
});

describe("Launcher empty + permission revoked (S04/02)", () => {
  it("empty state CTA opens the capture setup", () => {
    render(<Launcher {...sampleLauncherProps} projects={[]} />);
    const empty = screen.getByTestId("launcher-shelf-empty");
    expect(empty).toHaveTextContent("Nothing recorded yet");
    fireEvent.click(within(empty).getByRole("button", { name: "Record your first video" }));
    expect(screen.getByRole("group", { name: /capturable sources/i })).toBeInTheDocument();
  });

  it("newRecordingDisabled disables New recording, the CTA and Record", () => {
    const onStart = vi.fn();
    const { unmount } = render(
      <Launcher
        {...sampleLauncherProps}
        projects={[]}
        newRecordingDisabled
        notices={[
          {
            id: "permission",
            tone: "warning",
            message: "Screen Recording permission was revoked",
            action: { label: "Fix in System Settings", onClick: () => {} },
          },
        ]}
      />,
    );
    expect(screen.getByTestId("launcher-notice-permission")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "New recording" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record your first video" })).toBeDisabled();
    unmount();
    render(<Launcher {...sampleLauncherProps} onStart={onStart} newRecordingDisabled />);
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  });
});

describe("shelf formatting", () => {
  it("formats timecodes and edited times", () => {
    expect(formatTimecode(131_400)).toBe("02:11.400");
    const now = Date.parse("2026-09-15T12:00:00.000Z");
    expect(formatEdited("2026-09-15T10:00:00.000Z", now, launcherT)).toBe("Edited 2 hours ago");
    expect(formatEdited("2026-09-14T11:00:00.000Z", now, launcherT)).toBe("Edited yesterday");
    expect(formatEdited("2026-09-07T12:00:00.000Z", now, launcherT)).toBe("Edited last week");
    expect(formatEdited("2026-09-15T11:59:30.000Z", now, launcherT)).toBe("Edited just now");
  });
});
