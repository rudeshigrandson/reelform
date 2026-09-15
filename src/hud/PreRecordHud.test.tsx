import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { HudChips, PreRecordHud, PreRecordMenuPanel } from "./PreRecordHud";
import type { PreRecordHudProps, PreRecordMenu } from "./types";

function baseProps(overrides: Partial<PreRecordHudProps> = {}): PreRecordHudProps {
  return {
    mode: "screen",
    onModeChange: vi.fn(),
    sourceLabel: "Studio Display",
    onOpenSourcePicker: vi.fn(),
    micOn: true,
    micDeviceId: "mic-1",
    micDevices: [
      { id: "mic-1", label: "MacBook Pro Microphone" },
      { id: "mic-2", label: "Shure MV7" },
    ],
    micLevel: 0.6,
    onMicChange: vi.fn(),
    systemAudio: false,
    systemAudioSupported: true,
    onSystemAudioChange: vi.fn(),
    cameraOn: false,
    cameraDeviceId: "cam-1",
    cameraDevices: [{ id: "cam-1", label: "FaceTime HD Camera" }],
    onCameraChange: vi.fn(),
    onShowPreview: vi.fn(),
    options: { countdown: 3, hideCursor: false, fps: 30, hideHudWhileRecording: false },
    onOptionsChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onRecord: vi.fn(),
    recordShortcut: "⌘⇧R",
    openMenu: null,
    onMenuChange: vi.fn(),
    ...overrides,
  };
}

/** Pill + menu panel with the menu state held locally, as the container does. */
function Harness(overrides: Partial<PreRecordHudProps>) {
  const [openMenu, setOpenMenu] = useState<PreRecordMenu | null>(null);
  const props = baseProps({ ...overrides, openMenu, onMenuChange: setOpenMenu });
  return (
    <>
      <PreRecordHud {...props} />
      <PreRecordMenuPanel {...props} />
    </>
  );
}

describe("PreRecordHud pill", () => {
  it("renders mode, source chip, record tooltip and the 560x64 pill", () => {
    const props = baseProps();
    render(<PreRecordHud {...props} />);
    const pill = screen.getByTestId("pre-record-hud");
    expect(pill).toHaveStyle({ width: "560px", height: "64px" });
    // Draggable (guide S05): the grip is the window's drag region.
    expect(screen.getByTestId("hud-grip")).toHaveAttribute("data-app-region", "drag");
    expect(screen.getByLabelText("Display")).toBeChecked();
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Studio Display");
    const record = screen.getByRole("button", { name: "Start recording" });
    expect(record).toHaveAttribute("title", "Start recording ⌘⇧R");
    fireEvent.click(record);
    expect(props.onRecord).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Window"));
    expect(props.onModeChange).toHaveBeenCalledWith("window");
    fireEvent.click(screen.getByTestId("hud-source-chip"));
    expect(props.onOpenSourcePicker).toHaveBeenCalledOnce();
  });

  it("window and region selected states", () => {
    const { rerender } = render(
      <PreRecordHud {...baseProps({ mode: "window", sourceLabel: "Figma — Onboarding.fig" })} />,
    );
    expect(screen.getByTestId("pre-record-hud")).toHaveAttribute("data-mode", "window");
    expect(screen.getByLabelText("Window")).toBeChecked();
    rerender(
      <PreRecordHud {...baseProps({ mode: "region", sourceLabel: "Region on Studio Display" })} />,
    );
    expect(screen.getByLabelText("Region")).toBeChecked();
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Region on Studio Display");
  });

  it("mic on lights the 5-bar meter; mic off shows no level", () => {
    const { rerender } = render(<PreRecordHud {...baseProps({ micLevel: 0.6 })} />);
    const meter = () => screen.getByTestId("pre-mic-meter");
    expect(meter().querySelectorAll("span")).toHaveLength(5);
    expect(meter().querySelectorAll('[data-lit="true"]')).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Microphone on" })).toBeInTheDocument();
    rerender(<PreRecordHud {...baseProps({ micOn: false, micLevel: 0.9 })} />);
    expect(meter().querySelectorAll('[data-lit="true"]')).toHaveLength(0);
    expect(meter()).toHaveAttribute("aria-label", "Microphone off");
    expect(screen.getByRole("button", { name: "Microphone off" })).toBeInTheDocument();
    rerender(<PreRecordHud {...baseProps({ micLevel: 7 })} />);
    expect(meter().querySelectorAll('[data-lit="true"]')).toHaveLength(5);
  });

  it("system audio toggles; disabled with the reason when unsupported", () => {
    const props = baseProps();
    const { rerender } = render(<PreRecordHud {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "System audio" }));
    expect(props.onSystemAudioChange).toHaveBeenCalledWith(true);
    rerender(
      <PreRecordHud
        {...baseProps({
          systemAudio: true,
          systemAudioSupported: false,
          systemAudioNote: "Unavailable with fallback capture on macOS",
        })}
      />,
    );
    const btn = screen.getByRole("button", { name: "System audio" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Unavailable with fallback capture on macOS");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("busy disables Record and shows the busy label", () => {
    render(<PreRecordHud {...baseProps({ recordDisabled: true, busyLabel: "Starting…" })} />);
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });
});

describe("PreRecordHud menus", () => {
  it("mic menu lists devices and Off", () => {
    const onMicChange = vi.fn();
    render(<Harness onMicChange={onMicChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Microphone on" }));
    const menu = screen.getByRole("menu", { name: "Microphone" });
    expect(screen.getByRole("menuitemradio", { name: "MacBook Pro Microphone" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shure MV7" }));
    expect(onMicChange).toHaveBeenLastCalledWith("mic-2");
    expect(menu).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Microphone on" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    expect(onMicChange).toHaveBeenLastCalledWith(null);
  });

  it("camera menu: device, Off and Show preview; empty device list", () => {
    const onCameraChange = vi.fn();
    const onShowPreview = vi.fn();
    const { unmount } = render(
      <Harness onCameraChange={onCameraChange} onShowPreview={onShowPreview} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Camera off" }));
    expect(screen.getByRole("menuitemradio", { name: "Off" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "FaceTime HD Camera" }));
    expect(onCameraChange).toHaveBeenCalledWith("cam-1");
    fireEvent.click(screen.getByRole("button", { name: "Camera off" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show preview" }));
    expect(onShowPreview).toHaveBeenCalledOnce();
    unmount();
    render(<Harness cameraDevices={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera off" }));
    expect(screen.getByText("No cameras found")).toBeInTheDocument();
  });

  it("overflow: countdown, cursor, fps, hide HUD, Settings", () => {
    const onOptionsChange = vi.fn();
    const onOpenSettings = vi.fn();
    render(<Harness onOptionsChange={onOptionsChange} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitemradio", { name: "3s" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "10s" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hide" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "60 fps" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hide HUD while recording" }));
    expect(onOptionsChange.mock.calls.map((c) => c[0])).toEqual([
      { countdown: 0 },
      { countdown: 10 },
      { hideCursor: true },
      { fps: 60 },
      { hideHudWhileRecording: true },
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings…" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking the open menu's button closes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("HudChips", () => {
  it("renders warning and danger chips; nothing when empty", () => {
    const { rerender, container } = render(<HudChips chips={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <HudChips
        chips={[
          { id: "fallback", tone: "warning", message: "Native capture unavailable" },
          { id: "start", tone: "danger", message: "Recording didn't start" },
        ]}
      />,
    );
    expect(screen.getByTestId("hud-chip-fallback")).toHaveAttribute("data-tone", "warning");
    // Stacked one per row, so long messages are never squeezed into one line.
    expect(screen.getByTestId("hud-chips")).toHaveStyle({ flexDirection: "column" });
    expect(screen.getByRole("alert")).toHaveTextContent("Recording didn't start");
  });
});
