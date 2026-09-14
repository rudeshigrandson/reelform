import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { initialEditorData } from "../store";
import type { EditorData, EditorState } from "../store";
import type { Command } from "./command";
import { patchCommand } from "./command";
import { DEFAULT_COALESCE_MS, createHistory } from "./history";

/** Real zustand store shaped like the editor store (store.ts is not imported as a singleton). */
function makeStore() {
  return create<EditorState>((set) => ({
    ...initialEditorData(),
    update: (patch) => set(patch),
    reset: () => set(initialEditorData()),
  }));
}

function setup(opts: { cap?: number; coalesceMs?: number } = {}) {
  const store = makeStore();
  let t = 0;
  const clock = {
    set: (ms: number) => {
      t = ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
  const history = createHistory<EditorState>({
    getState: store.getState,
    setState: (s) => store.setState(s, true),
    now: () => t,
    ...opts,
  });
  return { store, history, clock };
}

const data = (s: EditorState): EditorData => {
  const { update: _u, reset: _r, ...rest } = s;
  return structuredClone(rest);
};

const setDuration = (ms: number, key?: string): Command<EditorState> =>
  patchCommand<EditorState>("Set duration", { durationMs: ms }, key);

describe("createHistory basics", () => {
  it("push executes and undo/redo round-trip", () => {
    const { store, history } = setup();
    history.push(setDuration(5000));
    expect(store.getState().durationMs).toBe(5000);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBe(true);
    expect(store.getState().durationMs).toBe(92_000);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toBe(true);
    expect(store.getState().durationMs).toBe(5000);
  });

  it("undo/redo on empty stacks are no-ops returning false", () => {
    const { store, history } = setup();
    const before = store.getState();
    const listener = vi.fn();
    history.subscribe(listener);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("new push clears the redo stack", () => {
    const { history } = setup();
    history.push(setDuration(1));
    history.push(setDuration(2));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.push(setDuration(3));
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it("keeps store actions (functions) intact and does not freeze state", () => {
    const { store, history } = setup();
    history.push(
      patchCommand<EditorState>("Add zoom", {
        zoomRegions: [{ ...zoomRegion(), id: "z1" }],
      }),
    );
    expect(typeof store.getState().update).toBe("function");
    expect(Object.isFrozen(store.getState().zoomRegions)).toBe(false);
    // Non-history update still works alongside history.
    store.getState().update({ selectedZoomId: "z1" });
    history.undo();
    expect(store.getState().zoomRegions).toEqual([]);
    expect(store.getState().selectedZoomId).toBe("z1");
  });

  it("a throwing command leaves state untouched and records nothing", () => {
    const { store, history } = setup();
    const before = store.getState();
    const bad: Command<EditorState> = {
      id: "bad",
      label: "Bad",
      do(d) {
        d.durationMs = 1;
        throw new Error("boom");
      },
      undo() {},
    };
    expect(() => history.push(bad)).toThrow("boom");
    expect(store.getState()).toBe(before);
    expect(history.canUndo()).toBe(false);
  });

  it("undo is applied to current state, preserving unrelated external edits", () => {
    const { store, history } = setup();
    history.push(setDuration(10));
    store.setState({ captionLanguage: "de" });
    history.undo();
    expect(store.getState().durationMs).toBe(92_000);
    expect(store.getState().captionLanguage).toBe("de");
  });
});

function zoomRegion() {
  return {
    id: "z",
    startMs: 0,
    endMs: 1000,
    scale: 2,
    targetX: 0.5,
    targetY: 0.5,
    easing: "smooth",
    mode: "manual",
  } as unknown as EditorData["zoomRegions"][number];
}

describe("labels", () => {
  it("formats undo/redo labels for tooltips", () => {
    const { history } = setup();
    expect(history.undoLabel()).toBeNull();
    expect(history.redoLabel()).toBeNull();
    history.push(patchCommand<EditorState>("Move zoom", { selectedZoomId: "a" }));
    history.push(patchCommand<EditorState>("Change padding", { durationMs: 3 }));
    expect(history.undoLabel()).toBe("Undo: Change padding");
    history.undo();
    expect(history.undoLabel()).toBe("Undo: Move zoom");
    expect(history.redoLabel()).toBe("Redo: Change padding");
  });

  it("coalesced entry takes the latest label", () => {
    const { history, clock } = setup();
    history.push(patchCommand<EditorState>("Drag", { durationMs: 1 }, "k"));
    clock.advance(10);
    history.push(patchCommand<EditorState>("Drag end", { durationMs: 2 }, "k"));
    expect(history.undoLabel()).toBe("Undo: Drag end");
  });
});

describe("coalescing", () => {
  it("merges same key within the window into one entry (first undo, latest do)", () => {
    const { store, history, clock } = setup();
    for (let i = 1; i <= 10; i++) {
      history.push(setDuration(i * 100, "slider"));
      clock.advance(50);
    }
    expect(store.getState().durationMs).toBe(1000);
    history.undo();
    expect(store.getState().durationMs).toBe(92_000);
    expect(history.canUndo()).toBe(false);
    history.redo();
    expect(store.getState().durationMs).toBe(1000);
  });

  it("window boundary: exactly coalesceMs merges, coalesceMs + 1 does not", () => {
    const { history, clock } = setup();
    clock.set(1000);
    history.push(setDuration(1, "k"));
    clock.set(1000 + DEFAULT_COALESCE_MS);
    history.push(setDuration(2, "k"));
    clock.advance(DEFAULT_COALESCE_MS + 1);
    history.push(setDuration(3, "k"));
    history.undo();
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(history.canUndo()).toBe(false);
  });

  it("window slides from the last push (a long drag stays one entry)", () => {
    const { history, clock } = setup();
    for (let i = 0; i < 20; i++) {
      history.push(setDuration(i, "k"));
      clock.advance(DEFAULT_COALESCE_MS);
    }
    history.undo();
    expect(history.canUndo()).toBe(false);
  });

  it("respects a custom coalesceMs", () => {
    const { history, clock } = setup({ coalesceMs: 50 });
    history.push(setDuration(1, "k"));
    clock.advance(51);
    history.push(setDuration(2, "k"));
    history.undo();
    expect(history.canUndo()).toBe(true);
  });

  it("does not merge different keys, missing keys, or a clock going backwards", () => {
    const { history, clock } = setup();
    clock.set(500);
    history.push(setDuration(1, "a"));
    history.push(setDuration(2, "b"));
    history.push(setDuration(3));
    history.push(setDuration(4));
    clock.set(100);
    history.push(setDuration(5, "c"));
    clock.set(0);
    history.push(setDuration(6, "c"));
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(6);
  });

  it("undo, redo and markSaved break the coalescing chain", () => {
    const { store, history, clock } = setup();
    history.push(setDuration(1, "k"));
    history.push(setDuration(2, "k"));
    history.undo();
    history.redo();
    clock.advance(1);
    history.push(setDuration(3, "k"));
    history.markSaved();
    history.push(setDuration(4, "k"));
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(store.getState().durationMs).toBe(3);
    expect(history.isDirty()).toBe(false);
    history.undo();
    expect(store.getState().durationMs).toBe(2);
    history.undo();
    expect(store.getState().durationMs).toBe(92_000);
  });

  it("does not merge across an intervening different command", () => {
    const { history } = setup();
    history.push(setDuration(1, "k"));
    history.push(patchCommand<EditorState>("Other", { captionLanguage: "fr" }));
    history.push(setDuration(2, "k"));
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(3);
  });
});

describe("cap eviction", () => {
  it("keeps only the newest `cap` entries", () => {
    const { store, history } = setup({ cap: 3 });
    for (let i = 1; i <= 5; i++) history.push(setDuration(i));
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(3);
    expect(store.getState().durationMs).toBe(2);
    while (history.redo());
    expect(store.getState().durationMs).toBe(5);
  });

  it("defaults to 100 entries", () => {
    const { history } = setup();
    for (let i = 0; i < 150; i++) history.push(setDuration(i));
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(100);
  });

  it("coalescing does not consume cap slots", () => {
    const { history } = setup({ cap: 2 });
    for (let i = 0; i < 10; i++) history.push(setDuration(i, "k"));
    history.push(setDuration(99));
    let n = 0;
    while (history.undo()) n++;
    expect(n).toBe(2);
  });
});

describe("dirty flag / save point", () => {
  it("clean initially; dirty after push; clean after undo back to save point", () => {
    const { history } = setup();
    expect(history.isDirty()).toBe(false);
    history.push(setDuration(1));
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(history.isDirty()).toBe(false);
    history.redo();
    expect(history.isDirty()).toBe(true);
  });

  it("save point in the middle: undo past it and redo back is clean", () => {
    const { history } = setup();
    history.push(setDuration(1));
    history.push(setDuration(2));
    history.markSaved();
    expect(history.isDirty()).toBe(false);
    history.undo();
    expect(history.isDirty()).toBe(true);
    history.redo();
    expect(history.isDirty()).toBe(false);
    history.push(setDuration(3));
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(history.isDirty()).toBe(false);
  });

  it("save point lost when its branch is discarded by a new push", () => {
    const { history } = setup();
    history.push(setDuration(1));
    history.markSaved();
    history.undo();
    history.push(setDuration(1));
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(history.isDirty()).toBe(true);
  });

  it("save point evicted by cap: bottom of stack stays dirty", () => {
    const { history } = setup({ cap: 2 });
    history.markSaved();
    for (let i = 1; i <= 4; i++) history.push(setDuration(i));
    while (history.undo());
    expect(history.isDirty()).toBe(true);
  });

  it("save point at an evicted-to base remains reachable", () => {
    const { history } = setup({ cap: 2 });
    history.push(setDuration(1));
    history.push(setDuration(2));
    history.markSaved();
    history.push(setDuration(3));
    history.push(setDuration(4));
    // entries left: 3, 4; base state is after 2 = save point
    while (history.undo());
    expect(history.isDirty()).toBe(false);
  });

  it("clear drops stacks and marks clean", () => {
    const { history } = setup();
    history.push(setDuration(1));
    history.push(setDuration(2));
    history.undo();
    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.isDirty()).toBe(false);
  });
});

describe("subscribe / snapshot", () => {
  it("notifies on push/undo/redo/markSaved and unsubscribes", () => {
    const { history } = setup();
    const listener = vi.fn();
    const off = history.subscribe(listener);
    history.push(setDuration(1));
    history.undo();
    history.redo();
    history.markSaved();
    expect(listener).toHaveBeenCalledTimes(4);
    off();
    history.push(setDuration(2));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("snapshot is referentially stable between changes and tracks modifiedAt", () => {
    const { history, clock } = setup();
    const s0 = history.getSnapshot();
    expect(history.getSnapshot()).toBe(s0);
    expect(s0).toEqual({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      dirty: false,
      modifiedAt: null,
    });
    clock.set(42);
    history.push(setDuration(1));
    const s1 = history.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(s1).toMatchObject({
      canUndo: true,
      dirty: true,
      modifiedAt: 42,
      undoLabel: "Undo: Set duration",
    });
    clock.set(77);
    history.undo();
    expect(history.getSnapshot().modifiedAt).toBe(77);
  });
});

describe("properties", () => {
  type Op =
    | { kind: "duration"; value: number; key: string | undefined; dt: number }
    | { kind: "lang"; value: string; key: string | undefined; dt: number }
    | { kind: "zoom"; count: number; key: string | undefined; dt: number }
    | { kind: "frame"; padding: number; key: string | undefined; dt: number };

  const keyArb = fc.option(fc.constantFrom("a", "b"), { nil: undefined });
  const dtArb = fc.integer({ min: 0, max: 600 });
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant("duration" as const),
      value: fc.integer({ min: 0, max: 1e6 }),
      key: keyArb,
      dt: dtArb,
    }),
    fc.record({
      kind: fc.constant("lang" as const),
      value: fc.string({ maxLength: 4 }),
      key: keyArb,
      dt: dtArb,
    }),
    fc.record({
      kind: fc.constant("zoom" as const),
      count: fc.integer({ min: 0, max: 3 }),
      key: keyArb,
      dt: dtArb,
    }),
    fc.record({
      kind: fc.constant("frame" as const),
      padding: fc.integer({ min: 0, max: 50 }),
      key: keyArb,
      dt: dtArb,
    }),
  );

  // Coalescing requires same-key commands to touch the same fields (absolute set).
  const toCommand = (op: Op, s: EditorState): Command<EditorState> => {
    const key = op.key === undefined ? undefined : `${op.kind}:${op.key}`;
    switch (op.kind) {
      case "duration":
        return patchCommand("Duration", { durationMs: op.value }, key);
      case "lang":
        return patchCommand("Language", { captionLanguage: op.value }, key);
      case "zoom":
        return patchCommand(
          "Zooms",
          {
            zoomRegions: Array.from({ length: op.count }, (_, i) => ({
              ...zoomRegion(),
              id: `z${i}`,
            })),
          },
          key,
        );
      case "frame":
        // Nested draft mutation via a hand-written absolute command.
        return {
          id: "frame",
          label: "Frame",
          coalesceKey: key,
          do: (d) => {
            (d.frame as unknown as Record<string, unknown>).padding = op.padding;
          },
          undo: (() => {
            const prev = (s.frame as unknown as Record<string, unknown>).padding;
            return (d: EditorState) => {
              (d.frame as unknown as Record<string, unknown>).padding = prev;
            };
          })(),
        };
    }
  };

  it("pushes then full undo restores initial; full redo restores final", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        const { store, history, clock } = setup();
        const initial = data(store.getState());
        for (const op of ops) {
          clock.advance(op.dt);
          // Hand-written frame commands capture the inverse at creation time, so
          // a coalesced "frame" chain must use the value before the FIRST push.
          history.push(toCommand(op, store.getState()));
        }
        const final = data(store.getState());
        while (history.undo());
        expect(data(store.getState())).toEqual(initial);
        expect(history.isDirty()).toBe(false);
        while (history.redo());
        expect(data(store.getState())).toEqual(final);
        expect(history.isDirty()).toBe(ops.length > 0);
      }),
      { numRuns: 200 },
    );
  });

  it("interleaved undo/redo/push keeps redo-to-top consistent", () => {
    type Step = { t: "push"; op: Op } | { t: "undo" } | { t: "redo" };
    const stepArb: fc.Arbitrary<Step> = fc.oneof(
      opArb.map((op) => ({ t: "push" as const, op })),
      fc.constant({ t: "undo" as const }),
      fc.constant({ t: "redo" as const }),
    );
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const { store, history, clock } = setup();
        const initial = data(store.getState());
        for (const step of steps) {
          if (step.t === "push") {
            clock.advance(step.op.dt);
            history.push(toCommand(step.op, store.getState()));
          } else if (step.t === "undo") history.undo();
          else history.redo();
        }
        while (history.redo());
        const top = data(store.getState());
        while (history.undo());
        expect(data(store.getState())).toEqual(initial);
        while (history.redo());
        expect(data(store.getState())).toEqual(top);
      }),
      { numRuns: 200 },
    );
  });
});

describe("robustness", () => {
  it("a very long coalesced drag undoes without deep recursion", () => {
    let s = { v: 0 };
    let t = 0;
    const h = createHistory<{ v: number }>({
      getState: () => s,
      setState: (n) => {
        s = n;
      },
      now: () => t,
    });
    for (let i = 1; i <= 50_000; i++) {
      h.push(patchCommand("Drag", { v: i }, "k"));
      t += 1;
    }
    expect(h.undo()).toBe(true);
    expect(s.v).toBe(0);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(s.v).toBe(50_000);
  });

  it("store subscribers see updated history state during setState", () => {
    const { store, history } = setup();
    const seen: { dirty: boolean; canUndo: boolean; canRedo: boolean }[] = [];
    store.subscribe(() => {
      seen.push({
        dirty: history.isDirty(),
        canUndo: history.canUndo(),
        canRedo: history.canRedo(),
      });
    });
    history.push(setDuration(1));
    history.undo();
    history.redo();
    expect(seen).toEqual([
      { dirty: true, canUndo: true, canRedo: false },
      { dirty: false, canUndo: false, canRedo: true },
      { dirty: true, canUndo: true, canRedo: false },
    ]);
  });

  it("a throwing undo leaves stacks and state untouched", () => {
    const { store, history } = setup();
    const cmd: Command<EditorState> = {
      id: "u",
      label: "Fragile",
      do(d) {
        d.durationMs = 5;
      },
      undo() {
        throw new Error("nope");
      },
    };
    history.push(cmd);
    const before = store.getState();
    expect(() => history.undo()).toThrow("nope");
    expect(store.getState()).toBe(before);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("invalid cap / coalesceMs fall back to sane values", () => {
    const nan = setup({ cap: Number.NaN, coalesceMs: Number.NaN });
    for (let i = 0; i < 150; i++) nan.history.push(setDuration(i));
    let n = 0;
    while (nan.history.undo()) n++;
    expect(n).toBe(100);

    const zero = setup({ cap: 0 });
    zero.history.push(setDuration(1));
    zero.history.push(setDuration(2));
    expect(zero.history.undo()).toBe(true);
    expect(zero.history.undo()).toBe(false);
    expect(zero.store.getState().durationMs).toBe(1);
  });

  it("clear breaks coalescing and the next push is undoable to the cleared state", () => {
    const { store, history } = setup();
    history.push(setDuration(1, "k"));
    history.clear();
    history.push(setDuration(2, "k"));
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(store.getState().durationMs).toBe(1);
    expect(history.isDirty()).toBe(false);
    expect(history.canUndo()).toBe(false);
  });
});
