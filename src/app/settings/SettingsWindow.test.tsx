import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "../../../electron/settings/schema";
import type { OnboardingPort } from "../../onboarding/types";
import type { SettingsServices } from "../../settings/services";
import { useShortcut } from "../../shortcuts/ShortcutsProvider";
import {
  AppShortcutsProvider,
  OnboardingGate,
  SettingsWindow,
  settingsErrorMessage,
} from "./SettingsWindow";
import { APPEARANCE_STYLE_ID, applyAppearance, clearAppearance, useAppearance } from "./appearance";
import { type SettingsSetResult, type SettingsTransport, createAppSettingsStore } from "./store";
import type { UpdaterPort } from "./updater";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  clearAppearance(document.documentElement);
});

const main = createDefaultSettings({ recordingsFolder: "/Users/michi/Movies/Reelform" });

function transport(overrides: Partial<SettingsTransport> = {}, initial = main): SettingsTransport {
  return {
    get: vi.fn(async () => structuredClone(initial)),
    set: vi.fn(
      async (patch): Promise<SettingsSetResult> => ({
        ok: true,
        settings: { ...initial, ...patch } as typeof main,
        changed: Object.keys(patch),
      }),
    ),
    reset: vi.fn(async () => ({ ok: true as const, settings: main, changed: [] })),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };
}

const updaterPort: UpdaterPort = {
  status: async () => null,
  check: async () => null,
  restart: async () => null,
  subscribe: () => () => {},
};

const system = {
  openLogsFolder: vi.fn(async () => true),
  getCacheSize: vi.fn(async () => 1024),
  clearCache: vi.fn(async () => true),
  openExternal: vi.fn(async () => {}),
};

function renderWindow(
  t: SettingsTransport,
  extra: Partial<Parameters<typeof SettingsWindow>[0]> = {},
) {
  const store = createAppSettingsStore(t);
  const utils = render(
    <SettingsWindow
      store={store}
      updaterPort={updaterPort}
      system={system}
      platform="mac"
      appVersion="1.0.0"
      enumerateDevices={async () => []}
      pickFolder={async () => "/Volumes/Work"}
      copyDiagnostics={async () => true}
      {...extra}
    />,
  );
  return { store, ...utils };
}

describe("SettingsWindow", () => {
  it("shows loading, then the pages; writes go through settings:set", async () => {
    const t = transport();
    renderWindow(t);
    expect(screen.getByText("Loading settings…")).toBeInTheDocument();
    await screen.findByRole("navigation", { name: /settings sections/i });
    fireEvent.click(screen.getByRole("switch", { name: "Launch at login" }));
    expect(t.set).toHaveBeenCalledWith({ launchAtLogin: true });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Launch at login" })).toBeChecked(),
    );
  });

  it("rolls back a rejected shortcut write and explains why", async () => {
    const t = transport({
      set: vi.fn(async () => ({
        ok: false as const,
        error: { code: "SHORTCUT_CONFLICT" as const, message: "Shortcut already in use" },
      })),
    });
    renderWindow(t, { initialSection: "appearance" });
    await screen.findByRole("navigation", { name: /settings sections/i });
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("already in use");
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("load failure shows an error with retry", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(main);
    renderWindow(transport({ get }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load settings: disk");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("navigation", { name: /settings sections/i });
  });

  it("offline mode is flagged", async () => {
    renderWindow(transport({ get: vi.fn(async () => null) }));
    expect(await screen.findByText(/not connected to reelform/i)).toBeInTheDocument();
  });

  it("Change… picks a folder and patches it", async () => {
    const t = transport();
    renderWindow(t);
    await screen.findByRole("navigation", { name: /settings sections/i });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Change…" })));
    expect(t.set).toHaveBeenCalledWith({ recordingsFolder: "/Volumes/Work" });
  });

  it("Run setup again shows onboarding in-window and returns", async () => {
    const port: OnboardingPort = {
      status: async () => null,
      request: async () => null,
      openSettings: async () => false,
      pickFolder: async () => null,
      saveSettings: vi.fn(async () => true),
    };
    renderWindow(transport(), { onboardingPort: port });
    await screen.findByRole("navigation", { name: /settings sections/i });
    fireEvent.click(screen.getByRole("button", { name: /run setup again/i }));
    expect(screen.getByRole("heading", { name: "Record something great" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await screen.findByText(/managed by the desktop app/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Finish" })));
    expect(port.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingCompleted: true, defaultFps: 60 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();
  });

  it("maps every error code to copy", () => {
    expect(settingsErrorMessage({ code: "INVALID_PATCH", message: "" })).toMatch(/isn't allowed/);
    expect(settingsErrorMessage({ code: "WRITE_FAILED", message: "" })).toMatch(/undone/);
    expect(settingsErrorMessage({ code: "IPC_FAILED", message: "boom" })).toMatch(/boom/);
  });
});

describe("AppShortcutsProvider", () => {
  it("applies overrides from synced settings", async () => {
    const t = transport({}, { ...main, shortcuts: { "editor.save": "Meta+Shift+S" } });
    const store = createAppSettingsStore(t);
    const save = vi.fn();
    function Bind() {
      useShortcut("editor.save", () => void save());
      return null;
    }
    render(
      <AppShortcutsProvider store={store} platform="mac">
        <Bind />
      </AppShortcutsProvider>,
    );
    await act(async () => {});
    fireEvent.keyDown(document.body, { key: "s", code: "KeyS", metaKey: true });
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "S", code: "KeyS", metaKey: true, shiftKey: true });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingGate", () => {
  const port: OnboardingPort = {
    status: async () => null,
    request: async () => null,
    openSettings: async () => false,
    pickFolder: async () => null,
    saveSettings: async () => true,
  };

  it("shows onboarding until completed, then the app", async () => {
    render(
      <OnboardingGate store={createAppSettingsStore(transport())} port={port}>
        <p>Launcher</p>
      </OnboardingGate>,
    );
    expect(
      await screen.findByRole("heading", { name: "Record something great" }),
    ).toBeInTheDocument();
    cleanup();
    render(
      <OnboardingGate
        store={createAppSettingsStore(transport({}, { ...main, onboardingCompleted: true }))}
        port={port}
      >
        <p>Launcher</p>
      </OnboardingGate>,
    );
    expect(await screen.findByText("Launcher")).toBeInTheDocument();
  });

  it("writes completion through the store with the default IPC-backed port", async () => {
    const t = transport();
    render(
      <OnboardingGate store={createAppSettingsStore(t)}>
        <p>Launcher</p>
      </OnboardingGate>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Get started" }));
    // Outside Electron invoke() resolves null → informational permissions step.
    await screen.findByText(/managed by the desktop app/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Finish" })));
    expect(t.set).toHaveBeenCalledWith(expect.objectContaining({ onboardingCompleted: true }));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(screen.getByText("Launcher")).toBeInTheDocument();
  });
});

describe("appearance", () => {
  it("applies density, reduce motion and accent overrides; indigo clears them", () => {
    const root = document.createElement("div");
    applyAppearance(root, { accentColor: "pink", density: "compact", reduceMotion: true });
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-reduce-motion")).toBe("true");
    expect(root.style.getPropertyValue("--accent")).toContain("oklch");
    applyAppearance(root, { accentColor: "indigo", density: "comfortable", reduceMotion: false });
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.style.getPropertyValue("--accent-theme")).toBe("");
    expect(root.hasAttribute("data-reduce-motion")).toBe(false);
  });

  it("injects the density / reduce-motion rules once", () => {
    const root = document.createElement("div");
    applyAppearance(root, { accentColor: "indigo", density: "compact", reduceMotion: true });
    applyAppearance(root, { accentColor: "blue", density: "compact", reduceMotion: true });
    const styles = document.head.querySelectorAll(`#${APPEARANCE_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('[data-density="compact"]');
    expect(styles[0]?.textContent).toContain('[data-reduce-motion="true"]');
    expect(styles[0]?.textContent).toContain("transition-duration");
  });

  it("useAppearance sets the theme and restores on unmount", () => {
    const root = document.createElement("div");
    function Probe() {
      useAppearance(
        { theme: "light", accentColor: "green", density: "compact", reduceMotion: false },
        root,
      );
      return null;
    }
    const { unmount } = render(<Probe />);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.getAttribute("data-density")).toBe("compact");
    unmount();
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.hasAttribute("data-density")).toBe(false);
  });

  it("services typing stays satisfiable without optional ports", () => {
    const s: SettingsServices = {};
    expect(s).toEqual({});
  });
});
