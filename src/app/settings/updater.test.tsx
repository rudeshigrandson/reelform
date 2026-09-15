import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseNotesToText } from "../../settings/releaseNotes";
import type { UpdaterState } from "../../settings/types";
import {
  LauncherUpdateNotice,
  UpdateBanner,
  UpdateReadyDialog,
  type UpdaterPort,
  useUpdater,
} from "./updater";

afterEach(cleanup);

const base: UpdaterState = {
  phase: "idle",
  currentVersion: "1.0.0",
  channel: "stable",
  info: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
};
const info = {
  version: "1.2.0",
  releaseName: null,
  releaseDate: null,
  releaseNotes: "<p>Faster <b>export</b></p><script>alert(1)</script>",
};
const downloaded: UpdaterState = { ...base, phase: "downloaded", info };

function fakePort(initial: UpdaterState | null = base) {
  let listener: ((s: UpdaterState) => void) | null = null;
  const port: UpdaterPort = {
    status: vi.fn(async () => initial),
    check: vi.fn(async () => ({ ...base, phase: "checking" as const })),
    restart: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn((l) => {
      listener = l;
      return () => {
        listener = null;
      };
    }),
  };
  return { port, push: (s: UpdaterState) => listener?.(s), subscribed: () => listener !== null };
}

describe("UpdateBanner", () => {
  it.each(["idle", "checking", "available", "downloading", "error"] as const)(
    "is hidden while %s",
    (phase) => {
      const { container } = render(
        <UpdateBanner
          state={{ ...base, phase, info: phase === "idle" ? null : info }}
          onRestart={() => {}}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("is hidden without state", () => {
    const { container } = render(<UpdateBanner state={null} onRestart={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the version and restarts when downloaded", () => {
    const onRestart = vi.fn();
    render(<UpdateBanner state={downloaded} onRestart={onRestart} />);
    expect(screen.getByRole("region", { name: "Update available" })).toHaveTextContent(
      "Reelform 1.2.0 is available — Restart to update",
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateReadyDialog", () => {
  it("renders sanitized notes as text and wires both actions", () => {
    const onRestart = vi.fn();
    const onLater = vi.fn();
    render(
      <UpdateReadyDialog
        open
        version="1.2.0"
        releaseNotes={info.releaseNotes}
        onRestart={onRestart}
        onLater={onLater}
      />,
    );
    const notes = screen.getByLabelText("Release notes");
    expect(notes).toHaveTextContent("Faster export");
    expect(notes.innerHTML).not.toContain("<b>");
    expect(notes).not.toHaveTextContent("alert");
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("handles missing notes", () => {
    render(
      <UpdateReadyDialog
        open
        version="1.2.0"
        releaseNotes={null}
        onRestart={() => {}}
        onLater={() => {}}
      />,
    );
    expect(screen.getByText(/no release notes/i)).toBeInTheDocument();
  });
});

describe("releaseNotesToText", () => {
  it("strips tags, scripts, handlers and decodes entities into lines", () => {
    expect(
      releaseNotesToText(
        '<h3>1.2.0</h3>\n<ul><li>Zoom &amp; pan</li><li><a href="javascript:x" onclick="y">Link</a></li></ul><style>p{}</style><!-- c --><p>&lt;3 &#x1F600;</p><img src=x onerror=alert(1)',
      ),
    ).toEqual(["1.2.0", "• Zoom & pan", "• Link", "<3 😀"]);
    expect(releaseNotesToText(null)).toEqual([]);
    expect(releaseNotesToText("Plain\n\nmarkdown")).toEqual(["Plain", "markdown"]);
  });
});

describe("useUpdater", () => {
  it("loads status, follows updater:changed, and unsubscribes", async () => {
    const { port, push, subscribed } = fakePort();
    const { result, unmount } = renderHook(() => useUpdater(port));
    await waitFor(() => expect(result.current.state?.phase).toBe("idle"));
    act(() => push(downloaded));
    expect(result.current.state?.phase).toBe("downloaded");
    unmount();
    expect(subscribed()).toBe(false);
  });

  it("a push that beats the initial status read wins", async () => {
    let resolve!: (s: UpdaterState) => void;
    const { port, push } = fakePort();
    vi.mocked(port.status).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useUpdater(port));
    act(() => push(downloaded));
    await act(async () => resolve(base));
    expect(result.current.state?.phase).toBe("downloaded");
  });

  it("check adopts the returned state; failed restart throws", async () => {
    const { port } = fakePort();
    vi.mocked(port.restart).mockResolvedValueOnce({ ok: false });
    const { result } = renderHook(() => useUpdater(port));
    await act(() => result.current.check());
    expect(result.current.state?.phase).toBe("checking");
    await expect(result.current.restart()).rejects.toThrow(/restart/i);
  });

  it("stays null outside Electron", async () => {
    const { port } = fakePort(null);
    const { result } = renderHook(() => useUpdater(port));
    await act(async () => {});
    expect(result.current.state).toBeNull();
  });
});

describe("LauncherUpdateNotice", () => {
  it("opens notes, restarts, and dismisses per version", async () => {
    const restart = vi.fn(async () => {});
    const controls = { state: downloaded, check: async () => {}, restart };
    const { rerender } = render(<LauncherUpdateNotice updater={controls} />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Update ready");
    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));
    expect(restart).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss update banner" }));
    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();

    rerender(
      <LauncherUpdateNotice
        updater={{ ...controls, state: { ...downloaded, info: { ...info, version: "1.3.0" } } }}
      />,
    );
    expect(screen.getByRole("region", { name: "Update available" })).toHaveTextContent("1.3.0");
  });

  it("shows a restart failure", async () => {
    const controls = {
      state: downloaded,
      check: async () => {},
      restart: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    render(<LauncherUpdateNotice updater={controls} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });
});
