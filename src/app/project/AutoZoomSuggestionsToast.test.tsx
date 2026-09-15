import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedZoom } from "../../editor/autozoom";
import { useEditorStore, useEditorUiStore } from "../../editor/store";
import { AutoZoomSuggestionsToast } from "./AutoZoomSuggestionsToast";

/** Pending suggestions drive the timeline ghosts only until a decision (§8). */

const suggestion = (id: string, startMs: number): SuggestedZoom =>
  ({
    id,
    startMs,
    endMs: startMs + 2000,
    level: 2,
    focus: { mode: "fixed", x: 0.5, y: 0.5 },
    easeInMs: 600,
    easeOutMs: 700,
    curve: "ease-out-cubic",
    source: "auto",
    reason: "3 clicks",
  }) as SuggestedZoom;

const pending = () => [...useEditorUiStore.getState().pendingSuggestionIds];

function setup() {
  const suggestions = [suggestion("a", 1000), suggestion("b", 5000)];
  useEditorStore.setState({ zoomRegions: suggestions.map((s) => ({ ...s })) });
  const onClose = vi.fn();
  const documentUpdate = vi.fn();
  const utils = render(
    <AutoZoomSuggestionsToast
      suggestions={suggestions}
      documentUpdate={documentUpdate}
      seek={() => {}}
      onClose={onClose}
    />,
  );
  return { onClose, documentUpdate, ...utils };
}

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorUiStore.getState().clearPendingSuggestions();
});
afterEach(() => useEditorUiStore.getState().clearPendingSuggestions());

describe("AutoZoomSuggestionsToast pending suggestions", () => {
  it("marks the offered suggestions pending; Keep all clears them", () => {
    const { onClose } = setup();
    expect(pending()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    expect(pending()).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Dismiss clears them and removes the untouched suggestions", () => {
    const { documentUpdate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(pending()).toEqual([]);
    expect(documentUpdate).toHaveBeenCalledWith("Dismiss zoom suggestions", { zoomRegions: [] });
  });

  it("Review clears them; unmounting also clears", () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(pending()).toEqual([]);
    unmount();
    setup().unmount();
    expect(pending()).toEqual([]);
  });
});
