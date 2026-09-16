import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REDUCED_MOTION_QUERY,
  prefersReducedMotion,
  usePrefersReducedMotion,
} from "./reducedMotion";

function Probe() {
  return <span data-testid="probe">{usePrefersReducedMotion() ? "reduced" : "full"}</span>;
}

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion;
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("is on for the OS preference or the in-app setting", () => {
    const root = { dataset: {} as DOMStringMap };
    const media = (matches: boolean) => (q: string) => ({
      matches: q === REDUCED_MOTION_QUERY && matches,
    });
    expect(prefersReducedMotion({ matchMedia: media(false), root })).toBe(false);
    expect(prefersReducedMotion({ matchMedia: media(true), root })).toBe(true);
    root.dataset.reduceMotion = "true";
    expect(prefersReducedMotion({ matchMedia: media(false), root })).toBe(true);
    expect(prefersReducedMotion({})).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("unsupported");
        },
      }),
    ).toBe(false);
  });

  it("the hook follows the root attribute set by the appearance layer", async () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("full");
    await act(async () => {
      document.documentElement.dataset.reduceMotion = "true";
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("reduced");
  });

  it("the hook reads matchMedia and follows its change events", () => {
    let listener: (() => void) | null = null;
    const mql = {
      matches: true,
      addEventListener: (_: string, l: () => void) => {
        listener = l;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => mql);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("reduced");
    mql.matches = false;
    act(() => listener?.());
    expect(screen.getByTestId("probe")).toHaveTextContent("full");
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });
});
