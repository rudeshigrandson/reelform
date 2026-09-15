import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Heavy screens are stubbed: this test covers routing and wiring, not the screens.
const projectEditorProps = vi.fn();
const exportControllerProps = vi.fn();

vi.mock("../ipc", () => ({
  getAppVersion: async () => "1.2.3",
  invoke: vi.fn(async () => null),
  onEvent: () => () => {},
  isBridged: () => true,
}));

vi.mock("../settings", () => ({
  useSyncedSettings: () => ({ settings: { theme: "system" } }),
  useAppSettings: Object.assign(
    (sel: (s: { settings: { undoHistorySize: number } }) => unknown) =>
      sel({ settings: { undoHistorySize: 150 } }),
    { getState: () => ({ settings: { openEditorAfterRecording: true } }) },
  ),
  useUpdater: () => ({ state: null }),
  LauncherUpdateNotice: () => <div data-testid="update-notice" />,
  OnboardingGate: ({ children }: { children: ReactNode }) => (
    <div data-testid="onboarding-gate">{children}</div>
  ),
  SettingsWindow: ({ appVersion }: { appVersion: string | null }) => (
    <div data-testid="settings-window">settings {appVersion}</div>
  ),
  AppShortcutsProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="shortcuts-provider">{children}</div>
  ),
}));

vi.mock("../project/ProjectEditor", () => ({
  ProjectEditor: (props: Record<string, unknown>) => {
    projectEditorProps(props);
    return <div data-testid="project-editor">editor {String(props.projectId)}</div>;
  },
}));

vi.mock("../export", () => ({
  ExportController: (props: Record<string, unknown>) => {
    exportControllerProps(props);
    return <div data-testid="export-controller" />;
  },
  createIpcSystemPort: () => ({}),
}));

vi.mock("../../shortcuts/ShortcutsOverlay", () => ({
  ShortcutsOverlayHost: () => <div data-testid="shortcuts-overlay" />,
}));

vi.mock("../../projects/ProjectsContainer", () => ({
  ProjectsContainer: () => <div data-testid="projects" />,
}));

const flowDispose = vi.fn();
vi.mock("../recording", () => {
  const bus = () => ({ post: () => {}, subscribe: () => () => {}, close: () => {} });
  return {
    createIpcRecordingPort: () => ({}),
    createIpcWindowsPort: () => ({}),
    createIpcProjectPort: () => ({}),
    createIpcSystemPort: () => ({}),
    createBroadcastRecordingBus: bus,
    createRecordingFlow: () => ({ dispose: flowDispose }),
    LauncherContainer: () => <div data-testid="launcher" />,
    HudContainer: () => <div data-testid="hud" />,
    CountdownContainer: () => <div data-testid="countdown" />,
    RegionOverlayContainer: ({ displayId }: { displayId: string }) => (
      <div data-testid="region-overlay">region {displayId}</div>
    ),
    WebcamBubbleContainer: () => <div data-testid="webcam-bubble" />,
  };
});

vi.mock("../../recording", () => ({ startCapture: vi.fn(), browserCaptureDeps: () => ({}) }));

vi.mock("../inspector/createInspectorHost", () => ({
  createInspectorHost: vi.fn((deps: unknown) => ({ deps })),
}));

const { WindowApp, detectPlatform } = await import("./WindowApp");

beforeEach(() => {
  projectEditorProps.mockClear();
  exportControllerProps.mockClear();
});

describe("WindowApp routing", () => {
  it("launcher: onboarding gate wraps the update notice, recorder and projects", async () => {
    render(<WindowApp search="?window=launcher" />);
    const gate = await screen.findByTestId("onboarding-gate");
    expect(gate).toContainElement(screen.getByTestId("launcher"));
    expect(gate).toContainElement(screen.getByTestId("projects"));
    expect(gate).toContainElement(screen.getByTestId("update-notice"));
  });

  it("unknown or missing window kinds fall back to the launcher", async () => {
    render(<WindowApp search="?window=nope" />);
    expect(await screen.findByTestId("launcher")).toBeInTheDocument();
  });

  it("editor: project editor + export controller + shortcuts overlay under the shortcuts provider", async () => {
    render(<WindowApp search="?window=editor&projectId=p-42" />);
    const provider = await screen.findByTestId("shortcuts-provider");
    expect(provider).toContainElement(screen.getByTestId("project-editor"));
    expect(provider).toContainElement(screen.getByTestId("export-controller"));
    expect(provider).toContainElement(screen.getByTestId("shortcuts-overlay"));
    expect(screen.getByText("editor p-42")).toBeInTheDocument();

    const props = projectEditorProps.mock.lastCall?.[0] as {
      undoHistorySize: number;
      createInspectorHost: (h: unknown) => { deps: Record<string, unknown> };
    };
    expect(props.undoHistorySize).toBe(150);
    const host = props.createInspectorHost({ push: vi.fn() });
    expect(Object.keys(host.deps).sort()).toEqual(
      ["documentUpdate", "metaUpdate", "platform", "system"].sort(),
    );
    expect(exportControllerProps.mock.lastCall?.[0]).toMatchObject({ open: false });
  });

  it("editor inspector host factory is stable across re-renders", async () => {
    const { rerender } = render(<WindowApp search="?window=editor&projectId=p-1" />);
    await screen.findByTestId("project-editor");
    const first = (projectEditorProps.mock.lastCall?.[0] as { createInspectorHost: unknown })
      .createInspectorHost;
    rerender(<WindowApp search="?window=editor&projectId=p-1" />);
    const second = (projectEditorProps.mock.lastCall?.[0] as { createInspectorHost: unknown })
      .createInspectorHost;
    expect(second).toBe(first);
  });

  it("settings window receives the app version", async () => {
    render(<WindowApp search="?window=settings" />);
    await waitFor(() => expect(screen.getByTestId("settings-window")).toHaveTextContent("1.2.3"));
  });

  it("recording overlay windows map to their containers", async () => {
    const cases: Array<[string, string]> = [
      ["?window=hud", "hud"],
      ["?window=countdown", "countdown"],
      ["?window=region-overlay&displayId=d-2", "region-overlay"],
      ["?window=webcam-bubble", "webcam-bubble"],
    ];
    for (const [search, testId] of cases) {
      const { unmount } = render(<WindowApp search={search} />);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
      unmount();
    }
    render(<WindowApp search="?window=region-overlay&displayId=d-2" />);
    expect(await screen.findByText("region d-2")).toBeInTheDocument();
  });
});

describe("detectPlatform", () => {
  it("maps user agents to capture platforms", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe("darwin");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win32");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});
