import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostRecordCard, type PostRecordCardProps } from "./PostRecordCard";

const handlers = {
  onOpenInEditor: vi.fn(),
  onReveal: vi.fn(),
  onRecordAnother: vi.fn(),
  onDelete: vi.fn(),
  onRetry: vi.fn(),
};

const finalizing: PostRecordCardProps["state"] = {
  phase: "finalizing",
  error: null,
  result: null,
  interrupted: null,
  elapsedMs: 42_000,
};

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion;
});

describe("PostRecordCard — reduce motion", () => {
  it("slides the progress bar while processing, and fades a static bar when motion is reduced", () => {
    const { unmount } = render(<PostRecordCard state={finalizing} {...handlers} />);
    const spinner = screen.getByTestId("post-record-spinner");
    expect(spinner).toHaveAttribute("data-motion", "full");
    expect(spinner.style.animation).toContain("reelform-post-slide");
    unmount();

    document.documentElement.dataset.reduceMotion = "true";
    render(<PostRecordCard state={finalizing} {...handlers} />);
    const still = screen.getByTestId("post-record-spinner");
    expect(still).toHaveAttribute("data-motion", "reduced");
    expect(still.style.animation).not.toContain("slide");
    expect(still.style.animation).toContain("reelform-post-fade");
  });
});
