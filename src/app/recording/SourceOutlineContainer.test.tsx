import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceOutlineContainer } from "./SourceOutlineContainer";
import { type RecordingBusMessage, createMemoryBusHub } from "./bus";
import { drain } from "./testFakes";

function setup(displayId = "d1") {
  const hub = createMemoryBusHub();
  const hud = hub.endpoint();
  const utils = render(<SourceOutlineContainer displayId={displayId} bus={hub.endpoint()} />);
  const post = async (m: RecordingBusMessage) => {
    await act(async () => {
      hud.post(m);
      await drain();
    });
  };
  return { post, ...utils };
}

describe("SourceOutlineContainer", () => {
  it("draws the outline published for its display and follows updates", async () => {
    const t = setup();
    expect(screen.queryByTestId("source-outline")).toBeNull();
    await t.post({
      type: "hud:sourceOutline",
      displayId: "d1",
      bounds: { x: 100, y: 100, width: 1280, height: 720 },
      label: "Figma — Onboarding.fig",
    });
    expect(screen.getByTestId("source-outline-rect")).toHaveStyle({
      left: "100px",
      width: "1280px",
    });
    expect(screen.getByTestId("source-outline-label")).toHaveTextContent("Figma — Onboarding.fig");
    await t.post({
      type: "hud:sourceOutline",
      displayId: "d1",
      bounds: { x: 140, y: 100, width: 1280, height: 720 },
      label: "Figma — Onboarding.fig",
    });
    expect(screen.getByTestId("source-outline-rect")).toHaveStyle({ left: "140px" });
  });

  it("hides for null bounds or when the source moved to another display", async () => {
    const t = setup();
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    await t.post({ type: "hud:sourceOutline", displayId: "d1", bounds });
    expect(screen.getByTestId("source-outline")).toBeInTheDocument();
    await t.post({ type: "hud:sourceOutline", displayId: "d2", bounds });
    expect(screen.queryByTestId("source-outline")).toBeNull();
    await t.post({ type: "hud:sourceOutline", displayId: "d1", bounds });
    await t.post({ type: "hud:sourceOutline", displayId: "d1", bounds: null });
    expect(screen.queryByTestId("source-outline")).toBeNull();
    await t.post({ type: "hud:setMicMuted", muted: true });
    expect(screen.queryByTestId("source-outline")).toBeNull();
  });
});
