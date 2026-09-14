import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingFlow, sampleOnboardingProps } from "./OnboardingFlow";
import type { OnboardingProps } from "./types";

function makeProps(overrides: Partial<OnboardingProps> = {}): OnboardingProps {
  return { ...sampleOnboardingProps, ...overrides };
}

describe("OnboardingFlow", () => {
  it("starts on the Welcome step", () => {
    render(<OnboardingFlow {...makeProps()} />);
    expect(screen.getByRole("heading", { name: "Reelform" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("advances to Permissions when Get started is clicked", () => {
    render(<OnboardingFlow {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByRole("heading", { name: /needs a few permissions/i })).toBeInTheDocument();
  });

  it("keeps Continue disabled until Screen Recording is granted", () => {
    render(<OnboardingFlow {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("calls onRequestPermission('screen') when Grant is clicked on Screen Recording", () => {
    const onRequestPermission = vi.fn();
    render(<OnboardingFlow {...makeProps({ onRequestPermission })} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /grant screen recording/i }));
    expect(onRequestPermission).toHaveBeenCalledWith("screen");
  });

  it("advances to Defaults after screen recording is granted", () => {
    const { rerender } = render(<OnboardingFlow {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    rerender(
      <OnboardingFlow
        {...makeProps({
          permissions: { screen: "granted", microphone: "needed", accessibility: "needed" },
        })}
      />,
    );

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);
    expect(screen.getByRole("heading", { name: /set your defaults/i })).toBeInTheDocument();
  });

  it("calls onDefaultsChange when the fps is changed", () => {
    const onDefaultsChange = vi.fn();
    const { rerender } = render(<OnboardingFlow {...makeProps({ onDefaultsChange })} />);
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    rerender(
      <OnboardingFlow
        {...makeProps({
          onDefaultsChange,
          permissions: { screen: "granted", microphone: "needed", accessibility: "needed" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(screen.getByRole("radio", { name: "60" }));
    expect(onDefaultsChange).toHaveBeenCalledWith({ fps: 60 });
  });

  it("reaches Done and calls onFinish when Start recording is clicked", () => {
    const onFinish = vi.fn();
    const grantedPerms = {
      screen: "granted" as const,
      microphone: "needed" as const,
      accessibility: "needed" as const,
    };
    render(<OnboardingFlow {...makeProps({ onFinish, permissions: grantedPerms })} />);

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i })); // permissions -> defaults
    fireEvent.click(screen.getByRole("button", { name: /continue/i })); // defaults -> done

    const start = screen.getByRole("button", { name: /start recording/i });
    expect(start).toBeInTheDocument();
    fireEvent.click(start);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
