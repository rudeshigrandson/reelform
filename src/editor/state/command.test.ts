import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { patchCommand } from "./command";

interface Doc {
  a: number;
  nested: { x: number; list: number[] };
  opt?: string | undefined;
}

const base = (): Doc => ({ a: 1, nested: { x: 1, list: [1, 2] } });

describe("patchCommand", () => {
  it("applies the patch and restores overwritten values on undo", () => {
    const cmd = patchCommand<Doc>("Edit", { a: 5, nested: { x: 9, list: [] } });
    const s0 = base();
    const s1 = produce(s0, (d) => cmd.do(d));
    expect(s1).toEqual({ a: 5, nested: { x: 9, list: [] } });
    const s2 = produce(s1, (d) => cmd.undo(d));
    expect(s2).toEqual(s0);
  });

  it("removes keys that were absent before the patch", () => {
    const cmd = patchCommand<Doc>("Set opt", { opt: "hi" });
    const s1 = produce(base(), (d) => cmd.do(d));
    expect(s1.opt).toBe("hi");
    const s2 = produce(s1, (d) => cmd.undo(d));
    expect(Object.hasOwn(s2, "opt")).toBe(false);
  });

  it("restores a key that existed with value undefined", () => {
    const cmd = patchCommand<Doc>("Set opt", { opt: "hi" });
    const s0: Doc = { ...base(), opt: undefined };
    const s1 = produce(s0, (d) => cmd.do(d));
    const s2 = produce(s1, (d) => cmd.undo(d));
    expect(Object.hasOwn(s2, "opt")).toBe(true);
    expect(s2.opt).toBeUndefined();
  });

  it("inverse holds plain (non-draft) snapshots, safe after produce finishes", () => {
    const cmd = patchCommand<Doc>("Replace nested", { nested: { x: 2, list: [3] } });
    const s0 = base();
    const s1 = produce(s0, (d) => cmd.do(d));
    // Revoked proxies would throw on access here.
    const s2 = produce(s1, (d) => cmd.undo(d));
    expect(s2.nested).toEqual({ x: 1, list: [1, 2] });
    expect(s2.nested.list.length).toBe(2);
  });

  it("re-captures the inverse on redo and stays correct", () => {
    const cmd = patchCommand<Doc>("Edit", { a: 7 });
    let s = base();
    for (let i = 0; i < 3; i++) {
      s = produce(s, (d) => cmd.do(d));
      expect(s.a).toBe(7);
      s = produce(s, (d) => cmd.undo(d));
      expect(s.a).toBe(1);
    }
  });

  it("assigns unique ids and carries label/coalesceKey", () => {
    const a = patchCommand<Doc>("A", { a: 1 }, "drag");
    const b = patchCommand<Doc>("B", { a: 2 });
    expect(a.id).not.toBe(b.id);
    expect(a.label).toBe("A");
    expect(a.coalesceKey).toBe("drag");
    expect(b.coalesceKey).toBeUndefined();
  });

  it("empty patch is a no-op both ways", () => {
    const cmd = patchCommand<Doc>("Nothing", {});
    const s0 = base();
    expect(produce(s0, (d) => cmd.do(d))).toBe(s0);
    expect(produce(s0, (d) => cmd.undo(d))).toBe(s0);
  });
});
