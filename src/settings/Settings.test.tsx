import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveShortcuts } from "../shortcuts/registry";
import { Settings, sampleSettings } from "./Settings";
import { formatBytes, parseSettingNumber } from "./controls";
import type { SectionId } from "./sections";
import type { SettingsServices, SystemPort } from "./services";
import type { SettingsPatch, SettingsState, UpdaterState } from "./types";

afterEach(cleanup);

function setup(
  opts: {
    settings?: Partial<SettingsState>;
    services?: SettingsServices;
    section?: SectionId;
    onChangeRecordingsFolder?: () => void;
  } = {},
) {
  const onChange = vi.fn<(patch: SettingsPatch) => void>();
  const utils = render(
    <Settings
      settings={{ ...sampleSettings, ...opts.settings }}
      onChange={onChange}
      services={opts.services}
      initialSection={opts.section}
      onChangeRecordingsFolder={opts.onChangeRecordingsFolder}
    />,
  );
  return { onChange, ...utils };
}

const nav = () => screen.getByRole("navigation", { name: /settings sections/i });

describe("Settings shell", () => {
  it("renders the nine S24 sections and switches pages", () => {
    setup();
    const labels = within(nav())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual([
      "General",
      "Recording",
      "Editor",
      "Shortcuts",
      "Appearance",
      "Updates",
      "Extensions",
      "Advanced",
      "About",
    ]);
    expect(screen.queryByText(/capture backend/i)).not.toBeInTheDocument();
    fireEvent.click(within(nav()).getByRole("button", { name: "Advanced" }));
    expect(screen.getByText(/capture backend/i)).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });
});

describe("General page", () => {
  it("switches and selects patch their keys", () => {
    const onFolder = vi.fn();
    const { onChange } = setup({
      onChangeRecordingsFolder: onFolder,
      services: { platform: "win" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Launch at login" }));
    expect(onChange).toHaveBeenCalledWith({ launchAtLogin: true });
    fireEvent.click(screen.getByRole("switch", { name: "Show in tray" }));
    expect(onChange).toHaveBeenCalledWith({ showInTray: false });
    fireEvent.click(screen.getByRole("switch", { name: "Send anonymous usage stats" }));
    expect(onChange).toHaveBeenCalledWith({ sendUsageStats: true });
    fireEvent.click(screen.getByRole("switch", { name: /auto-prune/i }));
    expect(onChange).toHaveBeenCalledWith({ autoPrune: false });
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
    expect(onChange).toHaveBeenCalledWith({ language: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(onFolder).toHaveBeenCalled();
  });

  it("number fields only patch valid values and flag invalid input", () => {
    const { onChange } = setup();
    const days = screen.getByLabelText("Prune after (days)");
    fireEvent.change(days, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith({ autoPruneDays: 30 });
    onChange.mockClear();
    fireEvent.change(days, { target: { value: "0" } });
    fireEvent.change(days, { target: { value: "2.5" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(days).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("whole number from 1 to 365");
  });

  it("offers Run setup again only when onboarding can be re-entered", () => {
    const runOnboarding = vi.fn();
    setup({ services: { runOnboarding } });
    fireEvent.click(screen.getByRole("button", { name: /run setup again/i }));
    expect(runOnboarding).toHaveBeenCalled();
  });
});

describe("Recording page", () => {
  it("lists devices from enumerateDevices and patches ids (None → null)", async () => {
    const enumerateDevices = vi.fn(async () => [
      { deviceId: "mic-1", kind: "audioinput" as const, label: "MacBook Pro Microphone" },
      { deviceId: "cam-1", kind: "videoinput" as const, label: "Logi 4K Brio" },
    ]);
    const { onChange } = setup({
      section: "recording",
      services: { enumerateDevices },
      settings: { defaultCameraId: "cam-1" },
    });
    expect(screen.getByText(/looking for devices/i)).toBeInTheDocument();
    const mic = await screen.findByRole("option", { name: "MacBook Pro Microphone" });
    fireEvent.change(mic.closest("select") as HTMLSelectElement, { target: { value: "mic-1" } });
    expect(onChange).toHaveBeenCalledWith({ defaultMicId: "mic-1" });
    fireEvent.change(screen.getByLabelText("Default camera"), { target: { value: "__none__" } });
    expect(onChange).toHaveBeenCalledWith({ defaultCameraId: null });
  });

  it("shows error, hidden-label and unavailable states", async () => {
    setup({
      section: "recording",
      services: {
        enumerateDevices: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    expect(await screen.findByText(/couldn't list devices/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Default microphone")).toBeDisabled();
    cleanup();

    setup({
      section: "recording",
      services: {
        enumerateDevices: async () => [{ deviceId: "a", kind: "audioinput", label: "" }],
      },
      settings: { defaultMicId: "gone" },
    });
    expect(await screen.findByText(/names are hidden/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Microphone 1" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Microphone (not connected)" })).toBeInTheDocument();
    cleanup();

    setup({ section: "recording" });
    expect(screen.getByText(/available in the desktop app/i)).toBeInTheDocument();
  });

  it("segmented controls and switches patch", () => {
    const { onChange } = setup({ section: "recording" });
    fireEvent.click(screen.getByRole("radio", { name: "Region" }));
    expect(onChange).toHaveBeenCalledWith({ defaultSource: "region" });
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    expect(onChange).toHaveBeenCalledWith({ defaultFps: 30 });
    fireEvent.click(screen.getByRole("radio", { name: "10s" }));
    expect(onChange).toHaveBeenCalledWith({ defaultCountdown: 10 });
    fireEvent.click(screen.getByRole("switch", { name: "Do Not Disturb while recording" }));
    expect(onChange).toHaveBeenCalledWith({ doNotDisturbWhileRecording: true });
    fireEvent.change(screen.getByLabelText("Max recording length"), { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith({ maxLengthHours: 1.5 });
  });
});

describe("Editor page", () => {
  it("patches editor defaults", () => {
    const { onChange } = setup({ section: "editor" });
    fireEvent.change(screen.getByLabelText("Default frame preset"), {
      target: { value: "minimal" },
    });
    expect(onChange).toHaveBeenCalledWith({ defaultFramePreset: "minimal" });
    fireEvent.click(screen.getByRole("radio", { name: "1:1" }));
    expect(onChange).toHaveBeenCalledWith({ defaultAspect: "1:1" });
    fireEvent.change(screen.getByLabelText("Autosave"), { target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith({ autosaveIntervalSec: 60 });
    fireEvent.change(screen.getByLabelText("Auto-zoom sensitivity"), { target: { value: "0.75" } });
    expect(onChange).toHaveBeenCalledWith({ autoZoomSensitivity: 0.75 });
    fireEvent.click(screen.getByRole("radio", { name: "Half" }));
    expect(onChange).toHaveBeenCalledWith({ previewQuality: "half" });
    fireEvent.change(screen.getByLabelText("Undo history size"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith({ undoHistorySize: 500 });
  });

  it("sensitivity is disabled when auto-zoom is off", () => {
    setup({ section: "editor", settings: { autoZoomOnNewRecording: false } });
    expect(screen.getByLabelText("Auto-zoom sensitivity")).toBeDisabled();
  });
});

describe("Shortcuts page", () => {
  const services: SettingsServices = { platform: "mac" };
  const button = (label: string) =>
    screen.getByRole("button", { name: new RegExp(`^${label} shortcut`) });

  it("groups rows and records new keys inline", () => {
    const { onChange } = setup({ section: "shortcuts", services });
    const table = screen.getByRole("table", { name: "Keyboard shortcuts" });
    for (const g of ["Global", "Editor", "Timeline"]) {
      expect(within(table).getByRole("columnheader", { name: g })).toBeInTheDocument();
    }
    fireEvent.click(button("Play / pause"));
    expect(button("Play / pause")).toHaveTextContent("Press keys…");
    fireEvent.keyDown(button("Play / pause"), { key: "Shift", code: "ShiftLeft", shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(button("Play / pause"), { key: "p", code: "KeyP" });
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch?.shortcuts).toBeDefined();
    const resolved = resolveShortcuts("mac", patch?.shortcuts);
    expect(resolved.find((r) => r.id === "editor.playPause")?.display).toBe("P");
    expect(button("Play / pause")).not.toHaveTextContent("Press keys…");
  });

  it("warns inline and does not save a blocking conflict; Esc cancels", () => {
    const { onChange } = setup({ section: "shortcuts", services });
    fireEvent.click(button("Export…"));
    fireEvent.keyDown(button("Export…"), { key: "s", code: "KeyS", metaKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("⌘S is already used by “Save”");
    expect(button("Export…")).toHaveTextContent("Press keys…");
    fireEvent.keyDown(button("Export…"), { key: "Escape", code: "Escape" });
    expect(button("Export…")).toHaveTextContent("⌘E");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refuses a modifier-less global shortcut inline", () => {
    const { onChange } = setup({ section: "shortcuts", services });
    fireEvent.click(button("Start / stop recording"));
    fireEvent.keyDown(button("Start / stop recording"), { key: "r", code: "KeyR" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("R can't be used");
    expect(button("Start / stop recording")).toHaveTextContent("Press keys…");
  });

  it("saves a shadow conflict with a hint", () => {
    const { onChange } = setup({ section: "shortcuts", services });
    fireEvent.click(button("Split at playhead"));
    fireEvent.keyDown(button("Split at playhead"), { key: " ", code: "Space" });
    expect(onChange).toHaveBeenCalledWith({ shortcuts: { "timeline.split": "Space" } });
    expect(screen.getByText(/also used by “Play \/ pause”/)).toBeInTheDocument();
  });

  it("reset, reset all and unassign produce override patches", () => {
    const { onChange } = setup({
      section: "shortcuts",
      services,
      settings: { shortcuts: { "editor.undo": "Meta+U", "editor.redo": "" } },
    });
    expect(screen.getByRole("button", { name: "Reset Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset Undo" }));
    expect(onChange).toHaveBeenCalledWith({ shortcuts: { "editor.redo": "" } });
    expect(button("Redo")).toHaveTextContent("Unassigned");
    fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
    expect(onChange).toHaveBeenCalledWith({ shortcuts: {} });
    fireEvent.click(button("Save"));
    fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
    expect(onChange).toHaveBeenLastCalledWith({
      shortcuts: { "editor.undo": "Meta+U", "editor.redo": "", "editor.save": "" },
    });
  });

  it("reports existing conflicts and invalid overrides", () => {
    setup({
      section: "shortcuts",
      services,
      settings: { shortcuts: { "editor.export": "Meta+S", "editor.undo": "Hyper+Q" } },
    });
    expect(screen.getByText(/one shortcut conflict/i)).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
  });
});

describe("Appearance page", () => {
  it("patches theme, accent, density and reduce motion", () => {
    const { onChange } = setup({ section: "appearance" });
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith({ theme: "dark" });
    const swatches = screen.getByRole("radiogroup", { name: "Accent color" });
    expect(within(swatches).getAllByRole("radio")).toHaveLength(6);
    expect(within(swatches).getByRole("radio", { name: "Indigo" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(swatches).getByRole("radio", { name: "Pink" }));
    expect(onChange).toHaveBeenCalledWith({ accentColor: "pink" });
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(onChange).toHaveBeenCalledWith({ density: "compact" });
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(onChange).toHaveBeenCalledWith({ reduceMotion: true });
  });
});

describe("Updates page", () => {
  const state: UpdaterState = {
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
    releaseNotes: "<p>New <em>zoom</em></p><script>x()</script>",
  };

  it("shows the unavailable state without an updater", () => {
    setup({ section: "updates", services: { appVersion: "0.9.0" } });
    expect(screen.getByText("0.9.0")).toBeInTheDocument();
    expect(screen.getByText(/unavailable in this build/i)).toBeInTheDocument();
  });

  it("channel, check now, and restart when downloaded", async () => {
    const check = vi.fn(async () => {});
    const restart = vi.fn(async () => {});
    const { onChange, rerender } = setup({
      section: "updates",
      services: { updater: { state, check, restart } },
    });
    expect(screen.getByText("Not checked yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith({ updateChannel: "beta" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(check).toHaveBeenCalled();

    rerender(
      <Settings
        settings={sampleSettings}
        onChange={onChange}
        initialSection="updates"
        services={{ updater: { state: { ...state, phase: "downloaded", info }, check, restart } }}
      />,
    );
    expect(screen.getByText(/1\.2\.0 is ready/)).toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Restart to update" })),
    );
    expect(restart).toHaveBeenCalled();
    const notes = screen.getByText("Release notes for 1.2.0").closest("details") as HTMLElement;
    expect(notes).toHaveTextContent("New zoom");
    expect(notes.querySelector("script, em")).toBeNull();
  });

  it("disables Check now while checking, shows progress and errors", async () => {
    const controls = {
      check: vi.fn(async () => {
        throw new Error("offline");
      }),
      restart: async () => {},
    };
    const { rerender, onChange } = setup({
      section: "updates",
      services: { updater: { ...controls, state: { ...state, phase: "checking" } } },
    });
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    const render2 = (s: UpdaterState) =>
      rerender(
        <Settings
          settings={sampleSettings}
          onChange={onChange}
          initialSection="updates"
          services={{ updater: { ...controls, state: s } }}
        />,
      );
    render2({
      ...state,
      phase: "downloading",
      info,
      progress: { percent: 42.4, bytesPerSecond: 1, transferred: 1, total: 2 },
    });
    expect(screen.getByText(/Downloading Reelform 1\.2\.0 — 42%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Download progress" })).toBeInTheDocument();
    render2({ ...state, phase: "error", error: "net::ERR" });
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("net::ERR");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check now" })));
    expect(screen.getByText("offline")).toBeInTheDocument();
  });
});

describe("Extensions page", () => {
  it("shows the 1.2 empty state", () => {
    setup({ section: "extensions" });
    expect(screen.getByRole("heading", { name: "Extensions arrive in 1.2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install from file…" })).toBeDisabled();
  });
});

describe("Advanced page", () => {
  function system(overrides: Partial<SystemPort> = {}): SystemPort {
    return {
      openLogsFolder: vi.fn(async () => true),
      getCacheSize: vi.fn(async () => 5 * 1024 * 1024),
      clearCache: vi.fn(async () => true),
      openExternal: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("patches backend, GPU export and log level", () => {
    const { onChange } = setup({ section: "advanced" });
    fireEvent.click(screen.getByRole("radio", { name: "Fallback" }));
    expect(onChange).toHaveBeenCalledWith({ captureBackend: "electron" });
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(onChange).toHaveBeenCalledWith({ gpuExport: "off" });
    fireEvent.change(screen.getByLabelText("Log level"), { target: { value: "debug" } });
    expect(onChange).toHaveBeenCalledWith({ logLevel: "debug" });
    expect(screen.getByRole("list", { name: "Hardware encoders" })).toBeInTheDocument();
    expect(screen.getByTestId("cache-size")).toHaveTextContent("Unavailable");
    expect(screen.getByRole("button", { name: "Open logs folder" })).toBeDisabled();
  });

  it("cache size, clear cache (refreshes) and open logs failure", async () => {
    const sys = system({ openLogsFolder: vi.fn(async () => false) });
    setup({ section: "advanced", services: { system: sys } });
    expect(screen.getByTestId("cache-size")).toHaveTextContent("Calculating…");
    await waitFor(() => expect(screen.getByTestId("cache-size")).toHaveTextContent("5.0 MB"));
    vi.mocked(sys.getCacheSize).mockResolvedValueOnce(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear cache" })));
    await waitFor(() => expect(screen.getByTestId("cache-size")).toHaveTextContent("0 B"));
    expect(sys.clearCache).toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Open logs folder" })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't open the logs folder.");
  });

  it("unknown cache size and confirmed reset all", async () => {
    const resetAll = vi.fn(async () => true);
    setup({
      section: "advanced",
      services: { system: system({ getCacheSize: async () => null }), resetAll },
    });
    await waitFor(() => expect(screen.getByTestId("cache-size")).toHaveTextContent("Unknown"));
    fireEvent.click(screen.getByRole("button", { name: "Reset all settings…" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(resetAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset all settings…" }));
    await act(async () =>
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset" })),
    );
    expect(resetAll).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Settings were reset to defaults.")).toBeInTheDocument();
  });
});

describe("About page", () => {
  it("shows version, opens licenses, copies diagnostics", async () => {
    const copyDiagnostics = vi.fn(async () => true);
    const openExternal = vi.fn(async () => {});
    setup({
      section: "about",
      services: {
        appVersion: "1.0.3",
        copyDiagnostics,
        system: {
          openExternal,
          openLogsFolder: async () => true,
          getCacheSize: async () => 0,
          clearCache: async () => true,
        },
      },
    });
    expect(screen.getByText("Version 1.0.3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Licenses" }));
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining("NOTICE"));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })),
    );
    expect(screen.getByText(/diagnostics copied/i)).toBeInTheDocument();
  });

  it("reports a failed copy and disables without the service", async () => {
    setup({
      section: "about",
      services: {
        copyDiagnostics: async () => {
          throw new Error("x");
        },
      },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't copy diagnostics.");
    cleanup();
    setup({ section: "about" });
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeDisabled();
  });
});

describe("control helpers", () => {
  it("parseSettingNumber enforces range and integrality", () => {
    expect(parseSettingNumber("", { min: 0, max: 1 })).toBeNull();
    expect(parseSettingNumber("abc", { min: 0, max: 1 })).toBeNull();
    expect(parseSettingNumber("1e3", { min: 0, max: 1000, integer: true })).toBe(1000);
    expect(parseSettingNumber("1.5", { min: 0, max: 2, integer: true })).toBeNull();
    expect(parseSettingNumber("Infinity", { min: 0, max: Number.MAX_VALUE })).toBeNull();
  });
  it("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 ** 3)).toBe("20 GB");
  });
});
