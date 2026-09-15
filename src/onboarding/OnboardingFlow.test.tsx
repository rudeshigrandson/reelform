import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow, sampleOnboardingProps } from "./OnboardingFlow";
import type { OnboardingProps } from "./types";

afterEach(cleanup);

function makeProps(overrides: Partial<OnboardingProps> = {}): OnboardingProps {
  return { ...sampleOnboardingProps, ...overrides };
}

const granted = { screen: "granted", microphone: "needed", accessibility: "needed" } as const;

describe("OnboardingFlow (legacy props)", () => {
  it("starts on the Welcome step", () => {
    render(<OnboardingFlow {...makeProps()} />);
    expect(screen.getByRole("heading", { name: "Record something great" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("advances to Permissions and keeps Continue disabled until Screen Recording is granted", () => {
    render(<OnboardingFlow {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByRole("heading", { name: /needs a few permissions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByRole("listitem", { name: "Camera" })).not.toBeInTheDocument();
  });

  it("calls onRequestPermission('screen') from Allow…", () => {
    const onRequestPermission = vi.fn();
    render(<OnboardingFlow {...makeProps({ onRequestPermission })} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: "Allow Screen Recording" }));
    expect(onRequestPermission).toHaveBeenCalledWith("screen");
  });

  it("follows permission prop changes and offers Skip for now", () => {
    const { rerender } = render(<OnboardingFlow {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    rerender(<OnboardingFlow {...makeProps({ permissions: granted })} />);
    const row = screen.getByRole("listitem", { name: "Screen Recording" });
    expect(within(row).getByText(/granted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: /where should recordings go/i }),
    ).toBeInTheDocument();
  });

  it("maps S03 edits to onDefaultsChange and finishes", () => {
    const onDefaultsChange = vi.fn();
    const onFinish = vi.fn();
    render(<OnboardingFlow {...makeProps({ onDefaultsChange, onFinish, permissions: granted })} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("radio", { name: "60" }));
    expect(onDefaultsChange).toHaveBeenCalledWith({ fps: 60 });
    fireEvent.click(screen.getByRole("switch", { name: /auto-delete raw/i }));
    expect(onDefaultsChange).toHaveBeenCalledWith({ autoDeleteRawAfterExport: true });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("Back returns to the previous step", () => {
    render(<OnboardingFlow {...makeProps({ permissions: granted })} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: /needs a few permissions/i })).toBeInTheDocument();
  });
});
