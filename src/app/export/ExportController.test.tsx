import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../../editor/store";
import { ExportCancelledError } from "../../export/engine/cancel";
import { initialProjectSession, useProjectSession } from "../project/session";
import { ExportController } from "./ExportController";
import { createEncoderCapabilityCache } from "./capabilities";
import type { ExportRunnerDeps, GifRouteArgs, SinkTarget, VideoRouteArgs } from "./runner";
import { FakeFlowSink, deferred, fakeSystemPort, progressAt } from "./testFakes";
import { useExportProgress } from "./useExportProgress";

/** h264: hw+sw · hevc/av1: none · vp9: software only. */
const caps = () =>
  createEncoderCapabilityCache({
    isConfigSupported: async (config) => ({
      supported:
        config.codec.startsWith("avc1") ||
        (config.codec.startsWith("vp09") && config.hardwareAcceleration === "prefer-software"),
      config,
    }),
  });

function harness() {
  const control = {
    gate: deferred(),
    fail: null as unknown,
    video: [] as VideoRouteArgs[],
    gif: [] as GifRouteArgs[],
    targets: [] as SinkTarget[],
    sinks: [] as FakeFlowSink[],
  };
  const createDeps = (_s: unknown, base: { system: ExportRunnerDeps["system"]; now(): number }) =>
    ({
      runVideo: async (args: VideoRouteArgs) => {
        control.video.push(args);
        await args.sink.begin({
          container: "mp4",
          codec: "h264",
          width: 2,
          height: 2,
          fps: 30,
          encoder: "hardware",
        });
        args.onProgress(
          progressAt(0.5, { encoder: args.preferHardware ? "hardware" : "software" }),
        );
        await Promise.race([
          control.gate.promise,
          new Promise((_, reject) =>
            args.signal.addEventListener("abort", () => reject(new ExportCancelledError())),
          ),
        ]);
        if (control.fail) throw control.fail;
        await args.sink.writeChunk(new Uint8Array(2_400_000));
        const { path } = await args.sink.finish();
        return { path, encoder: "hardware" as const, attempts: 1, pcmAudio: null };
      },
      runGif: async (args: GifRouteArgs) => {
        control.gif.push(args);
        await args.sink.begin({ container: "gif" });
        const { path } = await args.sink.finish();
        return { path, bytes: 1234, frames: 3 };
      },
      createSink: (t: SinkTarget) => {
        control.targets.push(t);
        const sink = new FakeFlowSink(`/exports/${t.finalName}`);
        control.sinks.push(sink);
        return sink;
      },
      writeFile: async (t: SinkTarget) => `/exports/${t.finalName}`,
      streamFile: async (t: SinkTarget) => `/exports/${t.finalName}`,
      system: base.system,
      onChange: () => undefined,
      now: base.now,
    }) satisfies ExportRunnerDeps;
  const system = fakeSystemPort();
  const onClose = { count: 0 };
  const props = {
    open: true,
    onClose: () => {
      onClose.count++;
    },
    systemPort: system,
    createDeps,
    capabilities: caps(),
    now: () => 0,
  };
  const view = render(<ExportController {...props} />);
  return { control, system, props, view, onClose };
}

const exportButton = () => screen.getByRole("button", { name: "Export" });

beforeEach(() => {
  useEditorStore.getState().reset();
  useProjectSession.setState({
    ...initialProjectSession(),
    status: "ready",
    projectId: "p1",
    videoUrl: "reelform-media://root/video.mp4",
    sourceSize: { width: 1920, height: 1080 },
  });
  useExportProgress.getState().reset();
});

describe("ExportController", () => {
  it("greys codecs this device can't encode and keeps the selection valid", async () => {
    const t = harness();
    expect(await screen.findByTestId("codec-unsupported-note")).toHaveTextContent(
      "HEVC, AV1: Not supported on this device",
    );
    fireEvent.click(screen.getByText("HEVC"));
    fireEvent.click(exportButton());
    await screen.findByTestId("export-progress");
    expect(t.control.video[0]?.config.codec).toBe("h264");
  });

  it("runs an export through progress to done, then Reveal / Copy / Export another", async () => {
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    expect(await screen.findByTestId("export-progress-label")).toHaveTextContent(
      "Rendering frames 50 / 100",
    );
    expect(screen.getByTestId("export-speed")).toHaveTextContent("2.0× realtime");
    expect(screen.getByTestId("export-eta")).toHaveTextContent("0:01 left");
    expect(useExportProgress.getState()).toMatchObject({ activity: "running", fraction: 0.5 });
    await act(async () => t.control.gate.resolve());
    const done = await screen.findByTestId("export-done");
    expect(within(done).getByText("Export.mp4")).toBeInTheDocument();
    expect(done).toHaveTextContent("2 MB");
    fireEvent.click(within(done).getByText("Reveal"));
    fireEvent.click(within(done).getByText("Copy"));
    expect(await screen.findByText("Copied to clipboard")).toBeInTheDocument();
    expect(t.system.calls).toEqual([
      ["reveal", "/exports/Export.mp4"],
      ["clipboardWriteFile", "/exports/Export.mp4"],
    ]);
    fireEvent.click(within(done).getByText("Export another"));
    expect(await screen.findByTestId("export-options")).toBeInTheDocument();
    expect(t.control.targets[0]).toEqual({
      projectId: "p1",
      destinationDir: null,
      finalName: "Export.mp4",
    });
  });

  it("falls back to copying the path when the file can't go on the clipboard", async () => {
    const t = harness();
    t.system.clipboardWriteFile = async () => {
      throw new Error("no clipboard");
    };
    t.control.gate.resolve();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    const done = await screen.findByTestId("export-done");
    fireEvent.click(within(done).getByText("Copy"));
    expect(await screen.findByText("File path copied")).toBeInTheDocument();
  });

  it("Cancel aborts, deletes the temp file and returns to the form", async () => {
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    await screen.findByTestId("export-progress");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Export cancelled")).toBeInTheDocument();
    expect(t.control.sinks[0]?.events).toContain("cancel");
    expect(useExportProgress.getState().activity).toBe("cancelled");
  });

  it("a failure offers software retry and diagnostics", async () => {
    const t = harness();
    t.control.fail = Object.assign(new Error("encoder crashed"), { code: "ENCODER_FAILED" });
    t.control.gate.resolve();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    const failed = await screen.findByTestId("export-failed");
    expect(failed).toHaveTextContent("encoder crashed");
    fireEvent.click(within(failed).getByText("Copy diagnostics"));
    expect(await screen.findByText("Diagnostics copied")).toBeInTheDocument();
    expect(String(t.system.calls[0]?.[1])).toContain("ENCODER_FAILED");
    t.control.fail = null;
    fireEvent.click(within(failed).getByText("Retry with software encoder"));
    await screen.findByTestId("export-done");
    expect(t.control.video.map((v) => v.preferHardware)).toEqual([true, false]);
  });

  it("low disk lets the user pick another folder and export there", async () => {
    const t = harness();
    t.control.fail = Object.assign(new Error("Writing the export failed"), {
      code: "EXPORT_WRITE_FAILED",
      details: { errno: "ENOSPC" },
    });
    t.control.gate.resolve();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    const low = await screen.findByTestId("export-low-disk");
    t.control.fail = null;
    fireEvent.click(within(low).getByText("Choose another folder"));
    await screen.findByTestId("export-options");
    expect(screen.getByLabelText("Destination")).toHaveValue("/picked");
    fireEvent.click(exportButton());
    await screen.findByTestId("export-done");
    expect(t.control.targets[1]?.destinationDir).toBe("/picked");
  });

  it("keeps exporting in the background with a cancellable progress toast", async () => {
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    await screen.findByTestId("export-progress");
    fireEvent.click(screen.getByText("Run in background"));
    expect(t.onClose.count).toBe(1);
    t.view.rerender(<ExportController {...t.props} open={false} />);
    const toast = screen.getByTestId("export-toast");
    expect(toast).toHaveTextContent("Exporting 50% · 0:01 left");
    expect(screen.queryByTestId("export-progress")).toBeNull();
    fireEvent.click(within(toast).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("export-toast")).toBeNull());
  });

  it("shows a success toast when a background export finishes", async () => {
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(exportButton());
    await screen.findByTestId("export-progress");
    t.view.rerender(<ExportController {...t.props} open={false} />);
    await act(async () => t.control.gate.resolve());
    const toast = await screen.findByText("Exported · Export.mp4 (2 MB)");
    fireEvent.click(within(toast.parentElement as HTMLElement).getByText("Reveal"));
    expect(t.system.calls[0]).toEqual(["reveal", "/exports/Export.mp4"]);
  });

  it("blocks Export when the chosen range doesn't exist", async () => {
    harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(screen.getByText("Selection"));
    expect(screen.getAllByText("Select a range on the timeline first").length).toBeGreaterThan(0);
    expect(exportButton()).toBeDisabled();
  });

  it("uses the software encoder when the codec has no hardware encoder", async () => {
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    fireEvent.click(screen.getByText("WebM"));
    fireEvent.click(exportButton());
    await screen.findByTestId("export-progress");
    expect(t.control.video[0]?.config).toMatchObject({ container: "webm", codec: "vp9" });
    expect(t.control.video[0]?.preferHardware).toBe(false);
    expect(screen.getByRole("note")).toHaveTextContent("using the software encoder");
  });

  it("exports a GIF with the GIF options", async () => {
    const t = harness();
    fireEvent.click(screen.getByText("GIF"));
    fireEvent.click(screen.getByText("Small 480p"));
    fireEvent.click(exportButton());
    await screen.findByTestId("export-done");
    expect(t.control.gif[0]?.options).toMatchObject({ width: 854, height: 480, fps: 15 });
    expect(t.control.targets[0]?.finalName).toBe("Export.gif");
  });

  it("shows the empty state without a project", () => {
    useProjectSession.setState({ ...initialProjectSession() });
    harness();
    expect(screen.getByTestId("export-empty")).toBeInTheDocument();
  });

  it("uses the project name as the default file name", async () => {
    useProjectSession.setState({
      meta: { name: "Onboarding" } as never,
    });
    const t = harness();
    await screen.findByTestId("codec-unsupported-note");
    expect(screen.getByLabelText("Filename")).toHaveValue("Onboarding");
    t.control.gate.resolve();
    fireEvent.click(exportButton());
    await screen.findByTestId("export-done");
    expect(t.control.targets[0]?.finalName).toBe("Onboarding.mp4");
  });
});
