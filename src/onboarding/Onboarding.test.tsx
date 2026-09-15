import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";
import {
  type OnboardingDraft,
  canLeavePermissions,
  finishPatch,
  initialOnboardingState,
  permissionRows,
  reduceOnboarding,
  startStatusPolling,
} from "./machine";
import type { OnboardingPort, PermissionEntry, PermissionsSnapshot } from "./types";

const draft: OnboardingDraft = {
  recordingsFolder: "/Users/michi/Movies/Reelform",
  autoDeleteRawAfterExport: false,
  defaultFps: 60,
  openEditorAfterRecording: true,
};

const e = (
  kind: PermissionEntry["kind"],
  status: PermissionEntry["status"],
  extra: Partial<PermissionEntry> = {},
): PermissionEntry => ({
  kind,
  status,
  required: kind === "screen",
  canRequest: status === "not-determined",
  canOpenSettings: status !== "not-applicable",
  ...extra,
});

function mac(
  overrides: Partial<Record<PermissionEntry["kind"], PermissionEntry["status"]>> = {},
): PermissionsSnapshot {
  const s = (k: PermissionEntry["kind"]) => overrides[k] ?? "not-determined";
  return {
    platform: "darwin",
    permissions: {
      screen: e("screen", s("screen")),
      microphone: e("microphone", s("microphone")),
      camera: e("camera", s("camera")),
      accessibility: e("accessibility", s("accessibility")),
      notifications: e("notifications", s("notifications")),
    },
  };
}

const windows: PermissionsSnapshot = {
  platform: "win32",
  permissions: {
    screen: e("screen", "not-applicable"),
    microphone: e("microphone", "denied", { canRequest: false }),
    camera: e("camera", "granted"),
    accessibility: e("accessibility", "not-applicable"),
    notifications: e("notifications", "not-applicable"),
  },
};

describe("onboarding machine", () => {
  const s0 = initialOnboardingState(draft);

  it("walks welcome → permissions → defaults → done with guards", () => {
    let s = reduceOnboarding(s0, { type: "NEXT" });
    expect(s.step).toBe("permissions");
    expect(reduceOnboarding(s, { type: "NEXT" }).step).toBe("permissions"); // no snapshot yet
    s = reduceOnboarding(s, { type: "SNAPSHOT", snapshot: mac({ screen: "denied" }) });
    expect(reduceOnboarding(s, { type: "NEXT" }).step).toBe("permissions");
    s = reduceOnboarding(s, { type: "SNAPSHOT", snapshot: mac({ screen: "granted" }) });
    s = reduceOnboarding(s, { type: "NEXT" });
    expect(s.step).toBe("defaults");
    expect(reduceOnboarding(s, { type: "NEXT" }).step).toBe("defaults"); // only via save
    expect(reduceOnboarding(s, { type: "SAVE_OK" })).toBe(s); // not saving
    s = reduceOnboarding(s, { type: "SAVE_START" });
    expect(reduceOnboarding(s, { type: "BACK" }).step).toBe("defaults"); // locked while saving
    expect(reduceOnboarding(s, { type: "SAVE_START" })).toBe(s);
    const failed = reduceOnboarding(s, { type: "SAVE_FAILED", message: "x" });
    expect(failed).toMatchObject({ step: "defaults", saving: false, saveError: "x" });
    s = reduceOnboarding(s, { type: "SAVE_OK" });
    expect(s.step).toBe("done");
    expect(reduceOnboarding(s, { type: "BACK" }).step).toBe("done");
  });

  it("unavailable status and non-gating platforms can continue", () => {
    expect(canLeavePermissions({ snapshot: null, unavailable: true })).toBe(true);
    expect(canLeavePermissions({ snapshot: windows, unavailable: false })).toBe(true);
    expect(canLeavePermissions({ snapshot: null, unavailable: false })).toBe(false);
  });

  it("rows hide not-applicable kinds (Windows variant)", () => {
    expect(permissionRows(windows).map((r) => r.kind)).toEqual(["microphone", "camera"]);
    expect(permissionRows(mac()).map((r) => r.kind)).toEqual([
      "screen",
      "microphone",
      "camera",
      "accessibility",
      "notifications",
    ]);
  });

  it("finish patch persists completion", () => {
    expect(finishPatch(draft)).toEqual({ ...draft, onboardingCompleted: true });
  });

  it("a whole settings object as draft is narrowed to the S03 keys", () => {
    const full = { ...draft, theme: "dark", shortcuts: { "editor.save": "" }, launchAtLogin: true };
    expect(Object.keys(initialOnboardingState(full).draft).sort()).toEqual(
      Object.keys(draft).sort(),
    );
    expect(finishPatch(full)).toEqual({ ...draft, onboardingCompleted: true });
  });
});

describe("startStatusPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const timer = {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };

  it("reads now and every 2s, skips overlapping ticks, stops cleanly", async () => {
    let resolve: ((s: PermissionsSnapshot | null) => void) | null = null;
    const read = vi.fn(
      () =>
        new Promise<PermissionsSnapshot | null>((r) => {
          resolve = r;
        }),
    );
    const onSnapshot = vi.fn();
    const onUnavailable = vi.fn();
    const handle = startStatusPolling({ read, onSnapshot, onUnavailable, onError: vi.fn(), timer });
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(1); // in flight
    await act(async () => resolve?.(mac()));
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2);
    handle.stop();
    await act(async () => resolve?.(null));
    expect(onUnavailable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reports errors and keeps polling", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("EPERM")).mockResolvedValue(mac());
    const onError = vi.fn();
    const onSnapshot = vi.fn();
    const handle = startStatusPolling({ read, onSnapshot, onUnavailable: vi.fn(), onError, timer });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith("EPERM");
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSnapshot).toHaveBeenCalled();
    handle.stop();
  });
});

describe("<Onboarding> container", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function makePort(
    snapshots: Array<PermissionsSnapshot | null> = [mac()],
  ): OnboardingPort & { calls: () => number } {
    let i = 0;
    const status = vi.fn(async () => {
      const snap = snapshots[Math.min(i, snapshots.length - 1)] ?? null;
      i++;
      return snap;
    });
    return {
      status,
      request: vi.fn(async (kind) => ({
        kind,
        status: "granted" as const,
        outcome: "prompted" as const,
      })),
      openSettings: vi.fn(async () => true),
      pickFolder: vi.fn(async () => "/Volumes/Work/Demos"),
      saveSettings: vi.fn(async () => true),
      calls: () => status.mock.calls.length,
    };
  }

  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  async function toPermissions(
    port: OnboardingPort,
    extra: Partial<Parameters<typeof Onboarding>[0]> = {},
  ) {
    const onFinish = vi.fn();
    const utils = render(
      <Onboarding port={port} initialDraft={draft} onFinish={onFinish} {...extra} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    return { onFinish, ...utils };
  }

  it("does not poll on welcome; polls every 2s on permissions; stops after leaving", async () => {
    const port = makePort([mac(), mac({ screen: "granted" })]);
    render(<Onboarding port={port} initialDraft={draft} onFinish={() => {}} appVersion="1.0.0" />);
    expect(screen.getByText("Version 1.0.0")).toBeInTheDocument();
    await tick(5000);
    expect(port.calls()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByText("Checking permissions…")).toBeInTheDocument();
    await flush();
    expect(port.calls()).toBe(1);
    expect(
      within(screen.getByRole("list", { name: "Permissions" })).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(screen.getByText(/ask you to restart Reelform/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await tick(2000);
    expect(port.calls()).toBe(2);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: /where should recordings go/i }),
    ).toBeInTheDocument();
    await tick(10_000);
    expect(port.calls()).toBe(2);
  });

  it("stops polling on unmount", async () => {
    const port = makePort();
    const { unmount } = await toPermissions(port);
    await flush();
    unmount();
    await tick(10_000);
    expect(port.calls()).toBe(1);
  });

  it("Allow… requests and refreshes status immediately", async () => {
    const port = makePort([mac(), mac({ microphone: "granted" })]);
    await toPermissions(port);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Allow Microphone" }));
    expect(screen.getByRole("button", { name: "Allow Microphone" })).toHaveTextContent("Waiting…");
    await flush();
    expect(port.request).toHaveBeenCalledWith("microphone");
    expect(port.calls()).toBe(2);
    expect(
      within(screen.getByRole("listitem", { name: "Microphone" })).getByText(/granted/i),
    ).toBeInTheDocument();
  });

  it("denied state shows Open System Settings with an explanation", async () => {
    const port = makePort([mac({ screen: "denied" })]);
    await toPermissions(port);
    await flush();
    const row = screen.getByRole("listitem", { name: "Screen Recording" });
    expect(within(row).getByText(/access was denied/i)).toHaveTextContent(
      "System Settings › Privacy & Security › Screen Recording",
    );
    fireEvent.click(within(row).getByRole("button", { name: /open system settings/i }));
    expect(port.openSettings).toHaveBeenCalledWith("screen");
  });

  it("Windows variant shows only microphone/camera and can continue", async () => {
    const port = makePort([windows]);
    await toPermissions(port);
    await flush();
    const rows = within(screen.getByRole("list", { name: "Permissions" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Microphone", "Camera"]);
    expect(screen.getByText(/needs no permission on Windows/)).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Open Settings for Microphone" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeEnabled();
  });

  it("outside Electron the permissions step is informational", async () => {
    const port = makePort([null]);
    await toPermissions(port);
    await flush();
    expect(screen.getByText(/managed by the desktop app/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("status errors show a retrying message", async () => {
    const port = makePort();
    vi.mocked(port.status).mockRejectedValueOnce(new Error("helper crashed"));
    await toPermissions(port);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("helper crashed");
    await tick(2000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("defaults: picks a folder, edits, saves with completion, then finishes", async () => {
    const port = makePort([mac({ screen: "granted" })]);
    const { onFinish } = await toPermissions(port);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    await flush();
    expect(port.pickFolder).toHaveBeenCalledWith(draft.recordingsFolder);
    expect(screen.getByLabelText("Recordings folder")).toHaveTextContent("/Volumes/Work/Demos");
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    fireEvent.click(screen.getByRole("switch", { name: /auto-delete raw/i }));
    fireEvent.click(screen.getByRole("switch", { name: /open editor automatically/i }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await flush();
    expect(port.saveSettings).toHaveBeenCalledWith({
      recordingsFolder: "/Volumes/Work/Demos",
      defaultFps: 30,
      autoDeleteRawAfterExport: true,
      openEditorAfterRecording: false,
      onboardingCompleted: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("a double click on Finish writes once", async () => {
    const port = makePort([mac({ screen: "granted" })]);
    let release: (ok: boolean) => void = () => {};
    vi.mocked(port.saveSettings).mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          release = r;
        }),
    );
    await toPermissions(port);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const finish = screen.getByRole("button", { name: "Finish" });
    act(() => {
      finish.click();
      finish.click();
    });
    await act(async () => release(true));
    await flush();
    expect(port.saveSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("a failed save stays on defaults with an error; cancelled picker keeps the folder", async () => {
    const port = makePort([mac({ screen: "granted" })]);
    vi.mocked(port.saveSettings).mockResolvedValueOnce(false);
    vi.mocked(port.pickFolder).mockResolvedValueOnce(null);
    await toPermissions(port);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    await flush();
    expect(screen.getByLabelText("Recordings folder")).toHaveTextContent(draft.recordingsFolder);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(
      screen.getByRole("heading", { name: /where should recordings go/i }),
    ).toBeInTheDocument();
  });
});
