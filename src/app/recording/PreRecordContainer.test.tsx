import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PreRecordContainer,
  type PreRecordContainerProps,
  recordShortcutLabel,
} from "./PreRecordContainer";
import { type RecordingBusMessage, type SnapshotPhase, createMemoryBusHub } from "./bus";
import { SOURCES, drain, fakePreRecordDeps } from "./testFakes";

async function flushUi(rounds = 40) {
  await act(async () => {
    await drain(rounds);
  });
}

function setup(
  opts: {
    fake?: ReturnType<typeof fakePreRecordDeps>;
    withBus?: boolean;
    props?: Partial<PreRecordContainerProps>;
  } = {},
) {
  const fake = opts.fake ?? fakePreRecordDeps();
  const hub = createMemoryBusHub();
  const bus = hub.endpoint();
  const launcher = hub.endpoint();
  const seen: RecordingBusMessage[] = [];
  launcher.subscribe((m) => seen.push(m));
  let hide = false;
  const startRef: { current: (() => void) | null } = { current: null };
  const element = (flowPhase: SnapshotPhase | null) => (
    <PreRecordContainer
      deps={fake.deps}
      bus={opts.withBus === false ? undefined : bus}
      flowPhase={flowPhase}
      startRef={startRef}
      hideHudWhileRecording={hide}
      onHideHudWhileRecordingChange={(v) => {
        hide = v;
      }}
      {...opts.props}
    />
  );
  const utils = render(element(null));
  return {
    ...fake,
    ...utils,
    seen,
    startRef,
    hidden: () => hide,
    setFlowPhase: async (phase: SnapshotPhase | null) => {
      utils.rerender(element(phase));
      await flushUi();
    },
    tick: async () => {
      await act(async () => {
        fake.timers.tick();
        await drain(40);
      });
    },
  };
}

const startRequests = (seen: RecordingBusMessage[]) =>
  seen.filter(
    (m): m is Extract<RecordingBusMessage, { type: "startRequest" }> => m.type === "startRequest",
  );

describe("PreRecordContainer — sources, chips and window growth", () => {
  it("loads sources and devices; fallback chip grows the window with the pill anchored", async () => {
    const t = setup();
    await flushUi();
    expect(t.log).toEqual(expect.arrayContaining(["listSources", "enumerateDevices"]));
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Studio Display");
    expect(screen.getByTestId("hud-chip-fallback")).toHaveTextContent(
      "Native capture unavailable — using fallback, cursor may be visible.",
    );
    // macOS + Electron backend: system audio disabled with the reason.
    expect(screen.getByRole("button", { name: "System audio" })).toBeDisabled();
    expect(t.windows.calls).toEqual(["collapse", "expand:560x104"]);
    const stage = screen.getByTestId("hud-stage");
    expect(stage).toHaveAttribute("data-expanded", "true");
    expect(stage).toHaveStyle({ width: "560px", height: "104px" });
    expect(screen.getByTestId("hud-pill-slot")).toHaveStyle({ left: "0px", top: "40px" });
    expect(screen.getByRole("button", { name: "Start recording" })).toHaveAttribute(
      "title",
      "Start recording ⌘⇧R",
    );
  });

  it("native backend on Linux: no chips, bare pill, system audio available", async () => {
    const fake = fakePreRecordDeps({ platform: "linux" });
    fake.state.sources = { ...SOURCES, backend: "electron" };
    setup({ fake });
    await flushUi();
    expect(screen.queryByTestId("hud-chips")).toBeNull();
    expect(fake.windows.calls).toEqual(["collapse"]);
    expect(screen.getByTestId("hud-stage")).toHaveAttribute("data-expanded", "false");
    expect(screen.getByRole("button", { name: "System audio" })).toBeEnabled();
    expect(recordShortcutLabel("linux")).toBe("Ctrl+Shift+R");
  });

  it("a sources error shows a danger chip", async () => {
    const fake = fakePreRecordDeps({ platform: "linux" });
    fake.state.sourcesError = { code: "X", message: "Screen capture failed" };
    setup({ fake });
    await flushUi();
    expect(screen.getByTestId("hud-chip-sources")).toHaveTextContent("Screen capture failed");
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Finding sources…");
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
  });

  it("works without a windows port (menus render in flow)", async () => {
    const fake = fakePreRecordDeps({ windows: undefined, platform: "linux" });
    setup({ fake });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menu", { name: "More options" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Settings…" })).toBeNull();
  });

  it("unmount collapses the window back to the pill", async () => {
    const t = setup();
    await flushUi();
    t.unmount();
    await flushUi();
    expect(t.windows.calls.at(-1)).toBe("collapse");
  });
});

describe("PreRecordContainer — source picker", () => {
  it("opens from the chip at 720x420, refreshes every 2 s only while open, selects a window", async () => {
    const t = setup();
    await flushUi();
    const listCalls = () => t.log.filter((c) => c === "listSources").length;
    await t.tick();
    expect(listCalls()).toBe(1); // closed: devices only

    fireEvent.click(screen.getByTestId("hud-source-chip"));
    await flushUi();
    expect(screen.getByRole("dialog", { name: "Choose a source" })).toBeInTheDocument();
    expect(t.windows.calls.at(-1)).toBe("expand:720x532");
    expect(screen.getByTestId("hud-pill-slot")).toHaveStyle({ left: "80px", top: "468px" });
    expect(listCalls()).toBe(2); // immediate refresh on open
    await t.tick();
    await t.tick();
    expect(listCalls()).toBe(4);

    fireEvent.click(screen.getByRole("tab", { name: "Windows" }));
    fireEvent.click(screen.getByRole("button", { name: "Onboarding.fig" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    await flushUi();
    expect(screen.queryByRole("dialog", { name: "Choose a source" })).toBeNull();
    expect(screen.getByLabelText("Window")).toBeChecked();
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Figma — Onboarding.fig");
    expect(t.windows.calls.at(-1)).toBe("expand:560x104");
    await t.tick();
    expect(listCalls()).toBe(4); // closed again: no more thumbnail refreshes
  });

  it("Escape and a click on the transparent grown area dismiss popovers", async () => {
    setup();
    await flushUi();
    fireEvent.click(screen.getByTestId("hud-source-chip"));
    await flushUi();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    await flushUi();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("hud-stage"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("region mode labels the display and keeps it when a display is picked", async () => {
    setup();
    await flushUi();
    fireEvent.click(screen.getByLabelText("Region"));
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Region on Studio Display");
    fireEvent.click(screen.getByTestId("hud-source-chip"));
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "LG UltraFine" }));
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByLabelText("Region")).toBeChecked();
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("Region on LG UltraFine");
  });

  it("window mode with no windows says so and disables Record", async () => {
    const fake = fakePreRecordDeps({ platform: "linux" });
    fake.state.sources = { ...SOURCES, windows: [] };
    setup({ fake });
    await flushUi();
    fireEvent.click(screen.getByLabelText("Window"));
    expect(screen.getByTestId("hud-source-chip")).toHaveTextContent("No windows");
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
  });
});

describe("PreRecordContainer — devices", () => {
  it("mic on opens a live meter; switching devices restarts it; Off stops it", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    await flushUi();
    expect(t.windows.calls.at(-1)).toBe("expand:560x392");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shure MV7" }));
    await flushUi();
    expect(t.log).toContain("mic.open:mic-2");
    await act(async () => {
      t.state.levelHandlers?.onLevel(0.6);
    });
    expect(screen.getByTestId("pre-mic-meter").querySelectorAll('[data-lit="true"]')).toHaveLength(
      3,
    );
    fireEvent.click(screen.getByRole("button", { name: "Microphone on" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    await flushUi();
    expect(t.log).toContain("mic.stop:mic-2");
    expect(screen.getByTestId("pre-mic-meter").querySelectorAll('[data-lit="true"]')).toHaveLength(
      0,
    );
  });

  it("a disconnected mic shows a warning chip and falls back to the first device", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shure MV7" }));
    await flushUi();
    t.state.devices = t.state.devices.filter((d) => d.deviceId !== "mic-2");
    await t.tick();
    expect(screen.getByTestId("hud-chip-mic")).toHaveTextContent(
      "Microphone disconnected — using MacBook Pro Microphone",
    );
    expect(t.log).toEqual(expect.arrayContaining(["mic.stop:mic-2", "mic.open:mic-1"]));
    // Fallback + mic chips stack in two rows: the window grows for both.
    expect(t.windows.calls.at(-1)).toBe("expand:560x144");
    expect(screen.getByTestId("hud-pill-slot")).toHaveStyle({ top: "80px" });
  });

  it("a failing mic device and an ended track show the device error chip", async () => {
    const t = setup();
    await flushUi();
    t.state.micError = { code: "NotReadableError", message: "Device in use" };
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "MacBook Pro Microphone" }));
    await flushUi();
    expect(screen.getByTestId("hud-chip-mic")).toHaveTextContent(
      "Microphone unavailable — Device in use",
    );
    t.state.micError = null;
    fireEvent.click(screen.getByRole("button", { name: "Microphone on" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    await flushUi();
    expect(screen.queryByTestId("hud-chip-mic")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "MacBook Pro Microphone" }));
    await flushUi();
    await act(async () => {
      t.state.levelHandlers?.onEnded();
    });
    expect(screen.getByTestId("hud-chip-mic")).toHaveTextContent("Microphone disconnected");
  });

  it("camera: Show preview opens the bubble, Off closes it; a vanished camera warns", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Camera off" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show preview" }));
    await flushUi();
    expect(t.windows.calls).toContain("openWebcamBubble");
    expect(screen.getByRole("button", { name: "Camera on" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Camera on" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    await flushUi();
    expect(t.windows.calls).toContain("closeKind:webcam-bubble");

    fireEvent.click(screen.getByRole("button", { name: "Camera off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "FaceTime HD Camera" }));
    t.state.devices = t.state.devices.filter((d) => d.kind !== "videoinput");
    await t.tick();
    expect(screen.getByTestId("hud-chip-camera")).toHaveTextContent("Camera disconnected");
  });

  it("overflow Settings… opens settings; Hide HUD while recording is lifted to the HUD", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hide HUD while recording" }));
    expect(t.hidden()).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings…" }));
    await flushUi();
    expect(t.windows.calls).toContain("openSettings");
  });
});

describe("PreRecordContainer — start", () => {
  it("Record posts a startRequest with the chosen options and waits for the flow", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shure MV7" }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "60 fps" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Off" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Hide" }));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await flushUi();
    expect(startRequests(t.seen).map((m) => m.setup)).toEqual([
      {
        sourceId: "d1",
        mode: "screen",
        mic: true,
        micDeviceId: "mic-2",
        systemAudio: false,
        webcam: false,
        fps: 60,
        countdown: 0,
        hideCursor: true,
      },
    ]);
    // Menus close; Record is busy until the flow answers.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Starting…" }));
    t.startRef.current?.();
    await flushUi();
    expect(startRequests(t.seen)).toHaveLength(1);

    await t.setFlowPhase("starting");
    act(() => t.timers.runTimeouts());
    expect(screen.queryByTestId("hud-chip-start")).toBeNull();
  });

  it("no answer from the launcher: timeout chip and Record re-enabled", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await flushUi();
    act(() => t.timers.runTimeouts());
    expect(screen.getByTestId("hud-chip-start")).toHaveTextContent(
      "Couldn't reach the Reelform launcher. Open it and try again.",
    );
    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  });

  it("a start the flow accepted that ends without a session shows a failure chip", async () => {
    const t = setup();
    await flushUi();
    t.startRef.current?.();
    await flushUi();
    await t.setFlowPhase("starting");
    await t.setFlowPhase(null);
    expect(screen.getByTestId("hud-chip-start")).toHaveTextContent("Recording didn't start");
    // Retrying clears the chip.
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await flushUi();
    expect(screen.queryByTestId("hud-chip-start")).toBeNull();
    expect(startRequests(t.seen)).toHaveLength(2);
  });

  it("region: selecting label while the overlays are up; cancelling is not an error", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByLabelText("Region"));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await flushUi();
    expect(startRequests(t.seen)[0]?.setup).toMatchObject({ mode: "region", sourceId: "d1" });
    await t.setFlowPhase("selectingRegion");
    expect(screen.getByRole("button", { name: "Selecting region…" })).toBeDisabled();
    await t.setFlowPhase(null);
    expect(screen.queryByTestId("hud-chip-start")).toBeNull();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  });

  it("without a bus Record is disabled", async () => {
    const t = setup({ withBus: false });
    await flushUi();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
    t.startRef.current?.();
    expect(startRequests(t.seen)).toHaveLength(0);
  });
});
