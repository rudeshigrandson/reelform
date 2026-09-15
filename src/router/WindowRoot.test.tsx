import { render, screen } from "@testing-library/react";
import { type WindowRenderers, WindowRoot } from "./WindowRoot";

const renderers: WindowRenderers = {
  launcher: () => <div>Launcher screen</div>,
  editor: (r) => <div>Editor {r.projectId}</div>,
  hud: (r) => <div>HUD {r.displayId ?? "primary"}</div>,
  "region-overlay": (r) => <div>Overlay {r.displayId}</div>,
  "source-outline": (r) => <div>Outline {r.displayId}</div>,
};

describe("WindowRoot", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("renders the screen for the kind with its params", () => {
    render(<WindowRoot renderers={renderers} search="?window=editor&projectId=abc" />);
    expect(screen.getByText("Editor abc")).toBeInTheDocument();
    expect(document.documentElement.dataset.window).toBe("editor");
  });

  it("reads window.location.search by default", () => {
    window.history.replaceState(null, "", "/?window=region-overlay&displayId=3");
    render(<WindowRoot renderers={renderers} />);
    expect(screen.getByText("Overlay 3")).toBeInTheDocument();
  });

  it("renders the source outline for its display", () => {
    render(<WindowRoot renderers={renderers} search="?window=source-outline&displayId=5" />);
    expect(screen.getByText("Outline 5")).toBeInTheDocument();
    expect(document.body.style.background).toBe("transparent");
  });

  it("falls back to launcher for unknown kinds and kinds without a renderer", () => {
    const { unmount } = render(<WindowRoot renderers={renderers} search="?window=wat" />);
    expect(screen.getByText("Launcher screen")).toBeInTheDocument();
    unmount();
    render(<WindowRoot renderers={renderers} search="?window=settings" />);
    expect(screen.getByText("Launcher screen")).toBeInTheDocument();
    expect(document.documentElement.dataset.window).toBe("launcher");
  });

  it("makes the body transparent for overlay windows and restores on unmount", () => {
    document.body.style.background = "rgb(1, 2, 3)";
    const { unmount } = render(<WindowRoot renderers={renderers} search="?window=hud" />);
    expect(screen.getByText("HUD primary")).toBeInTheDocument();
    expect(document.body.style.background).toBe("transparent");
    unmount();
    expect(document.body.style.background).toBe("rgb(1, 2, 3)");
    expect(document.documentElement.dataset.window).toBeUndefined();
  });
});
