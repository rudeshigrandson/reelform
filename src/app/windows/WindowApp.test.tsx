import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Heavy screens are stubbed: this test covers routing and wiring, not the screens.
const projectEditorProps = vi.fn();
const launcherProps = vi.fn();
const hudProps = vi.fn();
const i18nLanguages = vi.fn();
const recordingSettings = {
  undoHistorySize: 150,
  defaultSource: "window",
  defaultFps: 60,
  defaultCountdown: 5,
  defaultMicId: "mic-2",
  defaultCameraId: null,
  defaultSystemAudio: false,
  hideCursorByDefault: true,
};
const exportControllerProps = vi.fn();

vi.mock("../ipc", () => ({
  getAppVersion: async () => "1.2.3",
  invoke: vi.fn(async () => null),
  onEvent: () => () => {},
  isBridged: () => true,
}));

vi.mock("../../i18n", () => ({
  I18nProvider: ({ language, children }: { language: string; children: ReactNode }) => {
    i18nLanguages(language);
    return <div data-testid="i18n">{children}</div>;
  },
}));

vi.mock("../settings", () => ({
  useSyncedSettings: () => ({ settings: { theme: "system", language: "de" } }),
  useAppSettings: Object.assign(
    (sel: (s: { settings: typeof recordingSettings }) => unknown) =>
      sel({ settings: recordingSettings }),
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
const actualDefaults = await vi.hoisted(async () => import("../recording/settingsDefaults"));
vi.mock("../recording", () => {
  const bus = () => ({ post: () => {}, subscribe: () => () => {}, close: () => {} });
  return {
    createIpcRecordingPort: () => ({}),
    createIpcWindowsPort: () => ({}),
    createIpcProjectPort: () => ({}),
    createIpcSystemPort: () => ({}),
    createBroadcastRecordingBus: bus,
    createRecordingFlow: () => ({ dispose: flowDispose }),
    LauncherContainer: (props: Record<string, unknown>) => {
      launcherProps(props);
      return <div data-testid="launcher" />;
    },
    HudContainer: (props: Record<string, unknown>) => {
      hudProps(props);
      return <div data-testid="hud" />;
    },
    SourceOutlineContainer: ({ displayId }: { displayId: string }) => (
      <div data-testid="source-outline">outline {displayId}</div>
    ),
    createBrowserPreRecordDeps: () => ({ platform: "darwin", windows: {} }),
    launcherDefaultsFromSettings: actualDefaults.launcherDefaultsFromSettings,
    launcherDefaultsKey: actualDefaults.launcherDefaultsKey,
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
      ["?window=source-outline&displayId=d-3", "source-outline"],
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

describe("WindowApp settings wiring", () => {
  const expected = {
    mode: "window",
    fps: 60,
    countdown: 5,
    mic: true,
    micDeviceId: "mic-2",
    webcam: false,
    systemAudio: false,
    hideCursor: true,
  };

  it("mounts the i18n provider with the settings language", async () => {
    render(<WindowApp search="?window=settings" />);
    const provider = await screen.findByTestId("i18n");
    expect(provider).toContainElement(screen.getByTestId("settings-window"));
    expect(i18nLanguages).toHaveBeenLastCalledWith("de");
  });

  it("passes recording defaults from Settings to the launcher and the HUD pre-record deps", async () => {
    render(<WindowApp search="?window=launcher" />);
    await screen.findByTestId("launcher");
    expect(launcherProps.mock.lastCall?.[0]).toMatchObject({ defaults: expected });

    render(<WindowApp search="?window=hud" />);
    await screen.findByTestId("hud");
    const pre = (hudProps.mock.lastCall?.[0] as { preRecord: Record<string, unknown> }).preRecord;
    expect(pre).toMatchObject({ platform: "darwin", defaults: expected });
  });

  it("keeps the same defaults object while settings are unchanged", async () => {
    const { rerender } = render(<WindowApp search="?window=hud" />);
    await screen.findByTestId("hud");
    const first = (hudProps.mock.lastCall?.[0] as { preRecord: unknown }).preRecord;
    rerender(<WindowApp search="?window=hud" />);
    const second = (hudProps.mock.lastCall?.[0] as { preRecord: unknown }).preRecord;
    expect(second).toBe(first);
  });
});

describe("detectPlatform", () => {
  it("maps user agents to capture platforms", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe("darwin");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("win32");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});
