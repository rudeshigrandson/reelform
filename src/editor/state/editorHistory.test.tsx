import { act, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { type EditorData, type EditorState, initialEditorData } from "../store";
import {
  addAtPlayhead,
  deleteSelection,
  splitClipAt,
  trimClipToPlayhead,
} from "../timelineBinding";
import {
  EditorHistoryProvider,
  createDocumentUpdate,
  createEditorHistory,
  useDocumentUpdate,
} from "./editorHistory";

function makeStore() {
  return create<EditorState>((set) => ({
    ...initialEditorData(),
    update: (patch) => set(patch),
    reset: () => set(initialEditorData()),
  }));
}

function setup(cap?: number) {
  const store = makeStore();
  let t = 0;
  const history = createEditorHistory({
    store,
    cap,
    now: () => {
      t += 1000;
      return t;
    },
  });
  return { store, history, update: createDocumentUpdate(history, store) };
}

const docOf = (s: EditorState): EditorData => {
  const { update: _u, reset: _r, ...rest } = s;
  return structuredClone(rest);
};

describe("createDocumentUpdate", () => {
  it("pushes a labelled, undoable entry", () => {
    const { store, history, update } = setup();
    update("Burn in captions", { burnInCaptions: true });
    expect(store.getState().burnInCaptions).toBe(true);
    expect(history.undoLabel()).toBe("Undo: Burn in captions");
    history.undo();
    expect(store.getState().burnInCaptions).toBe(false);
  });

  it("skips patches that change nothing (no empty undo entries)", () => {
    const { store, history, update } = setup();
    update("Nothing", { zoomRegions: store.getState().zoomRegions, captionLanguage: "auto" });
    expect(history.canUndo()).toBe(false);
  });

  it("coalesces slider drags sharing a key", () => {
    const store = makeStore();
    let now = 0;
    const history = createEditorHistory({ store, now: () => now });
    const update = createDocumentUpdate(history, store);
    for (let i = 1; i <= 5; i++) {
      now += 50;
      update("Change language", { captionLanguage: `l${i}` }, "language");
    }
    expect(store.getState().captionLanguage).toBe("l5");
    history.undo();
    expect(history.canUndo()).toBe(false);
    expect(store.getState().captionLanguage).toBe("auto");
  });

  it("without a history applies the patch directly", () => {
    const store = makeStore();
    createDocumentUpdate(null, store)("Rename", { captionLanguage: "de" });
    expect(store.getState().captionLanguage).toBe("de");
  });

  it("honours the settings cap", () => {
    const { history, update } = setup(10);
    for (let i = 0; i < 15; i++) update("Lang", { captionLanguage: `l${i}` });
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(10);
  });
});

describe("revision-pinned save point", () => {
  it("edits made while a save is in flight stay dirty", () => {
    const { history, update } = setup();
    update("A", { captionLanguage: "a" });
    const rev = history.revision();
    update("B", { captionLanguage: "b" });
    history.markSaved(rev);
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(history.isDirty()).toBe(false);
  });
});

describe("useDocumentUpdate", () => {
  function Probe() {
    const update = useDocumentUpdate();
    return (
      <button type="button" onClick={() => update("Set language", { captionLanguage: "fr" })}>
        edit
      </button>
    );
  }

  it("routes through the provided history", () => {
    const store = makeStore();
    const history = createEditorHistory({ store, now: () => 0 });
    // The hook's default store is the app singleton; use a provider over a history
    // bound to it for the no-provider case below.
    render(
      <EditorHistoryProvider history={history}>
        <Probe />
      </EditorHistoryProvider>,
    );
    act(() => screen.getByRole("button", { name: "edit" }).click());
    expect(history.undoLabel()).toBe("Undo: Set language");
  });
});

describe("property: undo all timeline ops restores the initial document", () => {
  type Op =
    | { kind: "split"; t: number }
    | { kind: "trim"; t: number; edge: "start" | "end" }
    | { kind: "add"; t: number; track: "zoom" | "speed" | "captions" }
    | { kind: "deleteFirstClip" };
  const t = fc.integer({ min: 0, max: 92_000 });
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("split" as const), t }),
    fc.record({
      kind: fc.constant("trim" as const),
      t,
      edge: fc.constantFrom("start" as const, "end" as const),
    }),
    fc.record({
      kind: fc.constant("add" as const),
      t,
      track: fc.constantFrom("zoom" as const, "speed" as const, "captions" as const),
    }),
    fc.constant({ kind: "deleteFirstClip" as const }),
  );

  it("undo ×N → initial, redo ×N → final", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 20 }), (ops) => {
        const { store, history, update } = setup(1000);
        const initial = docOf(store.getState());
        let seq = 0;
        const makeId = (p: string) => `${p}-${++seq}`;
        for (const op of ops) {
          const d = store.getState();
          if (op.kind === "split") {
            const patch = splitClipAt(d, op.t, makeId);
            if (patch) update("Split clip", patch);
          } else if (op.kind === "trim") {
            const patch = trimClipToPlayhead(d, op.t, op.edge);
            if (patch) update("Trim clip", patch);
          } else if (op.kind === "add") {
            const res = addAtPlayhead(d, op.track, op.t, makeId);
            if (res) update("Add", res.patch);
          } else {
            const first = d.clips[0];
            const patch = first ? deleteSelection(d, new Set([first.id])) : null;
            if (patch) update("Ripple delete", patch);
          }
        }
        const final = docOf(store.getState());
        while (history.undo());
        expect(docOf(store.getState())).toEqual(initial);
        expect(history.isDirty()).toBe(false);
        while (history.redo());
        expect(docOf(store.getState())).toEqual(final);
      }),
      { numRuns: 100 },
    );
  });
});
