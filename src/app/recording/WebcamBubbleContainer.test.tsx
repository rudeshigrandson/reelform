import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type PreviewStream,
  WebcamBubbleContainer,
  type WebcamPreviewConstraints,
  previewStatusForError,
} from "./WebcamBubbleContainer";
import { createMemoryBusHub } from "./bus";
import { FakeWindows, drain } from "./testFakes";

function fakeStream() {
  const track = {
    stopped: false,
    stop: vi.fn(() => {
      track.stopped = true;
    }),
  };
  const stream: PreviewStream = { getTracks: () => [track] };
  return { stream, track };
}

function deferredGum() {
  const calls: {
    constraints: WebcamPreviewConstraints;
    resolve: (s: PreviewStream) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const getUserMedia = (constraints: WebcamPreviewConstraints) =>
    new Promise<PreviewStream>((resolve, reject) => calls.push({ constraints, resolve, reject }));
  return { calls, getUserMedia };
}

describe("previewStatusForError", () => {
  it("maps getUserMedia errors to states", () => {
    expect(previewStatusForError({ name: "NotAllowedError" })).toBe("denied");
    expect(previewStatusForError({ name: "NotFoundError" })).toBe("no-camera");
    expect(previewStatusForError({ name: "OverconstrainedError" })).toBe("no-camera");
    expect(previewStatusForError(new Error("boom"))).toBe("error");
    expect(previewStatusForError(null)).toBe("error");
  });
});

describe("WebcamBubbleContainer", () => {
  it("starting → live preview bound to the video, tracks stopped on unmount", async () => {
    const gum = deferredGum();
    const attach = vi.fn();
    const { unmount } = render(
      <WebcamBubbleContainer
        getUserMedia={gum.getUserMedia}
        deviceId="cam-1"
        attachStream={attach}
      />,
    );
    expect(screen.getByTestId("webcam-status")).toHaveTextContent("Starting camera…");
    expect(gum.calls[0]?.constraints).toEqual({
      audio: false,
      video: { deviceId: { exact: "cam-1" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const { stream, track } = fakeStream();
    await act(async () => {
      gum.calls[0]?.resolve(stream);
      await drain();
    });
    const video = screen.getByTestId("webcam-video");
    expect(video).toHaveAttribute("data-mirrored", "true");
    expect(attach).toHaveBeenCalledWith(video, stream);
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("a stream that arrives after unmount is stopped immediately", async () => {
    const gum = deferredGum();
    const { unmount } = render(
      <WebcamBubbleContainer getUserMedia={gum.getUserMedia} attachStream={vi.fn()} />,
    );
    unmount();
    const { stream, track } = fakeStream();
    await act(async () => {
      gum.calls[0]?.resolve(stream);
      await drain();
    });
    expect(track.stop).toHaveBeenCalled();
  });

  it.each([
    ["NotAllowedError", "Camera access denied"],
    ["NotFoundError", "No camera"],
    ["AbortError", "Camera unavailable"],
  ])("%s → %s", async (name, copy) => {
    const gum = deferredGum();
    render(<WebcamBubbleContainer getUserMedia={gum.getUserMedia} attachStream={vi.fn()} />);
    await act(async () => {
      gum.calls[0]?.reject({ name });
      await drain();
    });
    expect(screen.getByTestId("webcam-status")).toHaveTextContent(copy);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("hover controls: mirror, size, shape and hide", async () => {
    const gum = deferredGum();
    const windows = new FakeWindows();
    render(
      <WebcamBubbleContainer
        getUserMedia={gum.getUserMedia}
        windows={windows}
        attachStream={vi.fn()}
      />,
    );
    await act(async () => {
      gum.calls[0]?.resolve(fakeStream().stream);
      await drain();
    });
    expect(screen.queryByTestId("webcam-controls")).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId("webcam-bubble-container"));
    fireEvent.click(screen.getByRole("button", { name: "Mirror" }));
    expect(screen.getByTestId("webcam-video")).toHaveAttribute("data-mirrored", "false");
    fireEvent.click(screen.getByRole("button", { name: "Size L" }));
    expect(screen.getByTestId("webcam-bubble").style.width).toBe("240px");
    fireEvent.click(screen.getByRole("button", { name: "Rounded square" }));
    expect(screen.getByTestId("webcam-bubble")).toHaveAttribute("data-shape", "rounded");
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    await act(async () => drain());
    expect(windows.calls).toEqual(["closeKind:webcam-bubble"]);
  });

  it("switches to the device from the launcher snapshot, stopping the old stream", async () => {
    const gum = deferredGum();
    const hub = createMemoryBusHub();
    const launcher = hub.endpoint();
    render(
      <WebcamBubbleContainer
        getUserMedia={gum.getUserMedia}
        bus={hub.endpoint()}
        attachStream={vi.fn()}
      />,
    );
    const first = fakeStream();
    await act(async () => {
      gum.calls[0]?.resolve(first.stream);
      await drain();
    });
    await act(async () => {
      launcher.post({
        type: "snapshot",
        snapshot: {
          sessionId: "s1",
          phase: "countdown",
          countdownRemaining: 3,
          countdownTotal: 3,
          sourceLabel: "x",
          displayId: null,
          webcamDeviceId: "cam-usb",
        },
      });
      await drain();
    });
    expect(first.track.stop).toHaveBeenCalled();
    expect(gum.calls.at(-1)?.constraints.video.deviceId).toEqual({ exact: "cam-usb" });
  });
});
