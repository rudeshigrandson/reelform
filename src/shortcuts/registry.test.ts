import { describe, expect, it } from "vitest";
import { parseAccelerator, serializeAccelerator } from "./accelerator";
import { conflictsFor, detectConflicts, hasBlockingConflict, scopeRelation } from "./conflicts";
import {
  GLOBAL_SHORTCUT_IDS,
  SHORTCUTS,
  type ShortcutDefinition,
  findShortcut,
  resetShortcutOverride,
  resolveShortcuts,
  setShortcutOverride,
} from "./registry";

const platforms = ["mac", "win"] as const;

describe("registry", () => {
  it("has unique ids and every default parses on both platforms", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of SHORTCUTS) {
      for (const p of platforms) {
        expect(parseAccelerator(def.default[p], p), `${def.id} ${p}`).not.toBeNull();
      }
    }
  });

  it("covers the S24 list", () => {
    for (const id of [
      "record.toggle",
      "record.pause",
      "record.region",
      "editor.playPause",
      "editor.undo",
      "editor.redo",
      "editor.save",
      "editor.export",
      "editor.zoomIn",
      "editor.zoomOut",
      "timeline.split",
      "timeline.trimStart",
      "timeline.trimEnd",
      "timeline.nudgeBack",
      "timeline.nudgeForward",
      "timeline.delete",
      "timeline.selectAll",
    ]) {
      expect(findShortcut(id), id).toBeDefined();
    }
    expect(GLOBAL_SHORTCUT_IDS).toContain("record.toggle");
  });

  it("uses the spec defaults for record and export", () => {
    const mac = resolveShortcuts("mac");
    const win = resolveShortcuts("win");
    const display = (list: typeof mac, id: string) => list.find((r) => r.id === id)?.display;
    expect(display(mac, "record.toggle")).toBe("⇧⌘R");
    expect(display(win, "record.toggle")).toBe("Ctrl+Shift+R");
    expect(display(mac, "editor.export")).toBe("⌘E");
    expect(display(win, "editor.export")).toBe("Ctrl+E");
    expect(display(mac, "timeline.trimStart")).toBe("[");
  });

  it("defaults have no blocking conflicts on either platform", () => {
    for (const p of platforms) {
      const conflicts = detectConflicts(resolveShortcuts(p));
      expect(
        conflicts.filter((c) => c.kind === "duplicate"),
        p,
      ).toEqual([]);
      // ← shadows editor frame-step inside the timeline by design.
      expect(conflicts).toContainEqual({
        ids: ["editor.frameBack", "timeline.nudgeBack"],
        accelerator: "ArrowLeft",
        kind: "shadow",
      });
    }
  });
});

describe("overrides", () => {
  it("merges valid overrides, unbinds empty, ignores invalid and unknown ids", () => {
    const resolved = resolveShortcuts("win", {
      "editor.export": "Ctrl+Shift+E",
      "editor.save": "",
      "editor.undo": "Nope+Z",
      "not.a.shortcut": "Ctrl+Q",
    });
    const by = (id: string) => resolved.find((r) => r.id === id);
    expect(by("editor.export")).toMatchObject({ source: "override", display: "Ctrl+Shift+E" });
    expect(by("editor.save")).toMatchObject({ source: "unbound", accelerator: null, display: "" });
    expect(by("editor.undo")).toMatchObject({ source: "invalid-override", display: "Ctrl+Z" });
    expect(resolved.find((r) => r.id === "not.a.shortcut")).toBeUndefined();
    expect(resolved).toHaveLength(SHORTCUTS.length);
  });

  it("setting the default removes the override; reset removes it too", () => {
    const def = findShortcut("editor.export") as ShortcutDefinition;
    const custom = parseAccelerator("Ctrl+Shift+E", "win");
    const withCustom = setShortcutOverride({}, def, custom, "win");
    expect(withCustom).toEqual({ "editor.export": "Ctrl+Shift+E" });
    const back = setShortcutOverride(withCustom, def, parseAccelerator("Ctrl+E", "win"), "win");
    expect(back).toEqual({});
    expect(setShortcutOverride({}, def, null, "mac")).toEqual({ "editor.export": "" });
    expect(resetShortcutOverride(withCustom, "editor.export")).toEqual({});
    // Stored form is platform-neutral.
    const macOverride = setShortcutOverride({}, def, parseAccelerator("⇧⌘E", "mac"), "mac");
    expect(macOverride["editor.export"]).toBe("Shift+Meta+E");
  });
});

describe("conflicts", () => {
  it("scope relation matrix", () => {
    expect(scopeRelation("editor", "editor")).toBe("duplicate");
    expect(scopeRelation("global", "canvas")).toBe("duplicate");
    expect(scopeRelation("editor", "timeline")).toBe("shadow");
    expect(scopeRelation("canvas", "editor")).toBe("shadow");
    expect(scopeRelation("timeline", "canvas")).toBeNull();
  });

  it("flags a user override that duplicates another shortcut in the same scope", () => {
    const resolved = resolveShortcuts("mac", { "editor.export": "Meta+S" });
    const conflicts = detectConflicts(resolved);
    expect(conflicts).toContainEqual({
      ids: ["editor.save", "editor.export"],
      accelerator: "Meta+S",
      kind: "duplicate",
    });
    expect(hasBlockingConflict(conflicts)).toBe(true);
  });

  it("flags an editor key that collides with a global shortcut", () => {
    const resolved = resolveShortcuts("win", { "editor.export": "Ctrl+Shift+R" });
    expect(hasBlockingConflict(detectConflicts(resolved))).toBe(true);
  });

  it("timeline and canvas can share keys (default Delete)", () => {
    const conflicts = detectConflicts(resolveShortcuts("win"));
    expect(
      conflicts.find((c) => c.ids.includes("canvas.delete") && c.ids.includes("timeline.delete")),
    ).toBeUndefined();
  });

  it("countdown-only Esc does not collide with editor Esc but does with another global", () => {
    const base = resolveShortcuts("mac");
    expect(detectConflicts(base).some((c) => c.ids.includes("record.cancelCountdown"))).toBe(false);
    const esc = parseAccelerator("Escape", "mac");
    if (!esc) throw new Error("parse");
    // An always-on global Esc collides with the countdown Esc and steals the editor's Esc.
    expect(conflictsFor("record.pause", esc, base)).toEqual([
      { ids: ["record.pause", "record.cancelCountdown"], accelerator: "Escape", kind: "duplicate" },
      { ids: ["record.pause", "editor.clearSelection"], accelerator: "Escape", kind: "duplicate" },
    ]);
  });

  it("conflictsFor ignores the shortcut's own binding and unbound shortcuts", () => {
    const resolved = resolveShortcuts("win", { "editor.save": "" });
    const ctrlE = parseAccelerator("Ctrl+E", "win");
    const ctrlS = parseAccelerator("Ctrl+S", "win");
    if (!ctrlE || !ctrlS) throw new Error("parse");
    expect(conflictsFor("editor.export", ctrlE, resolved)).toEqual([]);
    expect(conflictsFor("editor.export", ctrlS, resolved)).toEqual([]);
    expect(conflictsFor("unknown", ctrlS, resolved)).toEqual([]);
    expect(serializeAccelerator(ctrlS)).toBe("Ctrl+S");
  });
});
