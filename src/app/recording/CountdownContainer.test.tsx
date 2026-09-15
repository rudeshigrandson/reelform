import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakePort } from "../../recording/testFakes";
import { CountdownContainer } from "./CountdownContainer";
import { type RecordingBusMessage, createMemoryBusHub } from "./bus";
import { FakeWindows, drain } from "./testFakes";

function setup() {
  const port = new FakePort();
  const windows = new FakeWindows();
  const hub = createMemoryBusHub();
  const launcher = hub.endpoint();
  const utils = render(<CountdownContainer port={port} bus={hub.endpoint()} windows={windows} />);
  const emit = async (e: Parameters<FakePort["emit"]>[0]) => {
    await act(async () => {
      port.emit(e);
      await drain();
    });
  };
  const post = async (m: RecordingBusMessage) => {
    await act(async () => {
      launcher.post(m);
      await drain();
    });
  };
  return { port, windows, emit, post, ...utils };
}

const snap = (remaining: number) =>
  ({
    type: "snapshot",
    snapshot: {
      sessionId: "s1",
      phase: "countdown",
      countdownRemaining: remaining,
      countdownTotal: 5,
      sourceLabel: "Studio Display",
      displayId: "d1",
      webcamDeviceId: null,
    },
  }) as const;

describe("CountdownContainer", () => {
  it("waits for a count, seeds from the snapshot and follows main ticks", async () => {
    const t = setup();
    expect(screen.getByTestId("countdown-waiting")).toBeInTheDocument();
    await t.post(snap(5));
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("5");
    expect(screen.getByTestId("countdown-progress")).toHaveAttribute("data-progress", "0.000");
    await t.emit({ sessionId: "s1", type: "countdown", remaining: 4 });
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("4");
    // A stale snapshot never moves the count backwards.
    await t.post(snap(5));
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("4");
    await t.emit({ sessionId: "other", type: "countdown", remaining: 1 });
    expect(screen.getByTestId("countdown-number")).toHaveTextContent("4");
  });

  it("Esc discards the session in main and closes the window", async () => {
    const t = setup();
    await t.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
      await drain();
    });
    expect(t.port.calls).toEqual(["discard:s1"]);
    expect(t.windows.calls).toEqual(["closeKind:countdown"]);
    expect(screen.queryByTestId("countdown-overlay")).toBeNull();
  });

  it("a failed cancel stays open with an error", async () => {
    const t = setup();
    t.port.failNext = "discard";
    await t.emit({ sessionId: "s1", type: "countdown", remaining: 3 });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
      await drain();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("discard failed");
    expect(screen.getByTestId("countdown-overlay")).toBeInTheDocument();
  });

  it.each(["started", "discarded", "error"] as const)("closes on %s", async (type) => {
    const t = setup();
    await t.emit({ sessionId: "s1", type: "countdown", remaining: 2 });
    const e =
      type === "started"
        ? ({ sessionId: "s1", type, backend: "electron" } as const)
        : type === "error"
          ? ({ sessionId: "s1", type, code: "X", message: "x" } as const)
          : ({ sessionId: "s1", type } as const);
    await t.emit(e);
    expect(t.windows.calls).toEqual(["closeKind:countdown"]);
    expect(screen.queryByTestId("countdown-overlay")).toBeNull();
  });

  it("closes when the snapshot says recording already started", async () => {
    const t = setup();
    await t.post({ type: "snapshot", snapshot: { ...snap(0).snapshot, phase: "recording" } });
    expect(t.windows.calls).toEqual(["closeKind:countdown"]);
  });
});
