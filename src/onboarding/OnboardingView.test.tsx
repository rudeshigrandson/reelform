import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingView, type OnboardingViewProps } from "./OnboardingView";
import { type OnboardingState, initialOnboardingState } from "./machine";
import type { PermissionEntry, PermissionsSnapshot } from "./types";

afterEach(cleanup);

const draft = {
  recordingsFolder: "/Users/me/Movies/Reelform",
  autoDeleteRawAfterExport: false,
  defaultFps: 60 as const,
  openEditorAfterRecording: true,
};

const e = (kind: PermissionEntry["kind"], status: PermissionEntry["status"]): PermissionEntry => ({
  kind,
  status,
  required: kind === "screen",
  canRequest: status === "not-determined",
  canOpenSettings: true,
});

const snapshot: PermissionsSnapshot = {
  platform: "darwin",
  permissions: {
    screen: e("screen", "granted"),
    microphone: e("microphone", "not-determined"),
    camera: e("camera", "not-determined"),
    accessibility: e("accessibility", "denied"),
    notifications: e("notifications", "not-determined"),
  },
};

function renderView(state: Partial<OnboardingState>, props: Partial<OnboardingViewProps> = {}) {
  const full: OnboardingViewProps = {
    state: { ...initialOnboardingState(draft), ...state },
    onNext: vi.fn(),
    onBack: vi.fn(),
    onRequest: vi.fn(),
    onOpenSettings: vi.fn(),
    onDraft: vi.fn(),
    onSaveDefaults: vi.fn(),
    onFinish: vi.fn(),
    ...props,
  };
  render(<OnboardingView {...full} />);
  return full;
}

describe("OnboardingView (design layout)", () => {
  it("welcome footer shows version and Terms · Privacy links", () => {
    const onOpenTerms = vi.fn();
    const onOpenPrivacy = vi.fn();
    renderView({}, { appVersion: "1.0.0", onOpenTerms, onOpenPrivacy });
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));
    fireEvent.click(screen.getByRole("button", { name: "Terms" }));
    expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
    expect(onOpenTerms).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Step 1 of 3")).not.toBeInTheDocument();
  });

  it("permissions: step counter, required/optional marks, one primary Allow, denied action", () => {
    const props = renderView({ step: "permissions", snapshot });
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    const indicator = screen.getByRole("list", { name: "Step indicator" });
    expect(within(indicator).getByRole("listitem", { current: "step" })).toHaveAttribute(
      "aria-label",
      "Step 2: permissions",
    );
    expect(screen.getByText(/granted once/i)).toBeInTheDocument();
    const screenRow = screen.getByRole("listitem", { name: "Screen Recording" });
    expect(screenRow).toHaveTextContent("· required");
    expect(within(screenRow).getByText("Granted")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Notifications" })).toHaveTextContent("· optional");
    expect(screen.getByRole("button", { name: "Allow Microphone" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Allow Camera" })).toHaveClass("btn-secondary");
    const denied = screen.getByRole("listitem", { name: "Accessibility" });
    fireEvent.click(within(denied).getByRole("button", { name: /open system settings/i }));
    expect(props.onOpenSettings).toHaveBeenCalledWith("accessibility");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("defaults: subtitle, toggle descriptions, fps radios, Back disabled while saving", () => {
    const props = renderView({ step: "defaults", saving: true });
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/change any of this later/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /auto-delete raw/i })).toHaveAccessibleDescription(
      /source file is removed/i,
    );
    expect(screen.getByRole("switch", { name: /open editor/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "60" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "30" }));
    expect(props.onDraft).toHaveBeenCalledWith({ defaultFps: 30 });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });
});
