import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegionOverlayContainer } from "./RegionOverlayContainer";
import { type RecordingBusMessage, createMemoryBusHub } from "./bus";
import { FakeWindows, drain } from "./testFakes";

function setup(initialBounds = { x: 100, y: 50, width: 640, height: 360 }) {
  const hub = createMemoryBusHub();
  const launcher = hub.endpoint();
  const seen: RecordingBusMessage[] = [];
  launcher.subscribe((m) => seen.push(m));
  const windows = new FakeWindows();
  render(
    <RegionOverlayContainer
      displayId="d1"
      bus={hub.endpoint()}
      windows={windows}
      scaleFactor={2}
      viewport={{ width: 1512, height: 982 }}
      initialBounds={initialBounds}
    />,
  );
  return { launcher, seen, windows };
}

describe("RegionOverlayContainer", () => {
  it("enables mouse selection on its display and posts the region in DIP + pixels", async () => {
    const t = setup();
    await act(async () => drain());
    expect(t.windows.calls).toEqual(["setRegionSelecting:d1:true"]);
    expect(screen.getByTestId("region-hint")).toHaveTextContent("Drag to select a region");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await act(async () => drain());
    expect(t.seen).toEqual([
      {
        type: "regionSelected",
        displayId: "d1",
        region: { x: 100, y: 50, width: 640, height: 360 },
        pixelRegion: { x: 200, y: 100, width: 1280, height: 720 },
        scaleFactor: 2,
      },
    ]);
    expect(screen.queryByTestId("region-overlay")).toBeNull();
  });

  it("Esc cancels", async () => {
    const t = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => drain());
    expect(t.seen).toEqual([{ type: "regionCancelled", displayId: "d1" }]);
  });

  it("a region outside the display is refused with an error", async () => {
    const t = setup({ x: 2000, y: 0, width: 100, height: 100 });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await act(async () => drain());
    expect(screen.getByRole("alert")).toHaveTextContent("Select an area inside this display");
    expect(t.seen).toEqual([]);
  });

  it("hides when another display finishes selection", async () => {
    const t = setup();
    await act(async () => {
      t.launcher.post({ type: "regionCancelled", displayId: "d2" });
      await drain();
    });
    expect(screen.queryByTestId("region-overlay")).toBeNull();
  });
});
