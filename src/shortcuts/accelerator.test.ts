import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Accelerator,
  NAMED_KEY_NAMES,
  acceleratorFromEvent,
  acceleratorsEqual,
  formatAccelerator,
  normalizeKey,
  parseAccelerator,
  serializeAccelerator,
  shortcutPlatformFor,
  toElectronAccelerator,
} from "./accelerator";

const acc = (key: string, mods: Partial<Omit<Accelerator, "key">> = {}): Accelerator => ({
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
  key,
});

const keyArb = fc.oneof(
  fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
  fc.integer({ min: 1, max: 24 }).map((n) => `F${n}`),
  fc.constantFrom(...NAMED_KEY_NAMES),
);

const accelArb: fc.Arbitrary<Accelerator> = fc.record({
  ctrl: fc.boolean(),
  alt: fc.boolean(),
  shift: fc.boolean(),
  meta: fc.boolean(),
  key: keyArb,
});

const platformArb = fc.constantFrom("mac" as const, "win" as const);

describe("formatAccelerator", () => {
  it("renders mac glyphs in Apple order and win names", () => {
    const a = acc("R", { shift: true, meta: true });
    expect(formatAccelerator(a, "mac")).toBe("⇧⌘R");
    expect(formatAccelerator(acc("R", { shift: true, ctrl: true }), "win")).toBe("Ctrl+Shift+R");
    expect(
      formatAccelerator(acc("K", { ctrl: true, alt: true, shift: true, meta: true }), "mac"),
    ).toBe("⌃⌥⇧⌘K");
    expect(formatAccelerator(acc("ArrowLeft", { shift: true }), "mac")).toBe("⇧←");
    expect(formatAccelerator(acc("ArrowLeft", { shift: true }), "win")).toBe("Shift+Left");
    expect(formatAccelerator(acc("Plus", { ctrl: true }), "win")).toBe("Ctrl+Plus");
    expect(formatAccelerator(acc("Plus", { meta: true }), "mac")).toBe("⌘+");
  });
});

describe("parseAccelerator", () => {
  it("parses mac glyph, win and Electron forms", () => {
    expect(parseAccelerator("⇧⌘R", "mac")).toEqual(acc("R", { shift: true, meta: true }));
    expect(parseAccelerator("Ctrl+Shift+R", "win")).toEqual(acc("R", { shift: true, ctrl: true }));
    expect(parseAccelerator("CommandOrControl+Shift+R", "mac")).toEqual(
      acc("R", { shift: true, meta: true }),
    );
    expect(parseAccelerator("CmdOrCtrl+Shift+R", "win")).toEqual(
      acc("R", { shift: true, ctrl: true }),
    );
    expect(parseAccelerator("ctrl+=", "win")).toEqual(acc("=", { ctrl: true }));
    expect(parseAccelerator("Ctrl+-", "win")).toEqual(acc("-", { ctrl: true }));
    expect(parseAccelerator("Ctrl++", "win")).toEqual(acc("Plus", { ctrl: true }));
    expect(parseAccelerator("+", "win")).toEqual(acc("Plus"));
    expect(parseAccelerator("⌘+", "mac")).toEqual(acc("Plus", { meta: true }));
    expect(parseAccelerator(" esc ", "mac")).toEqual(acc("Escape"));
    expect(parseAccelerator("⌫", "mac")).toEqual(acc("Backspace"));
    expect(parseAccelerator("f12", "win")).toEqual(acc("F12"));
    expect(parseAccelerator("⌘Space", "mac")).toEqual(acc("Space", { meta: true }));
  });

  it("rejects empty, modifier-only, unknown tokens", () => {
    for (const bad of [
      "",
      "   ",
      "Shift",
      "⇧⌘",
      "Ctrl+",
      "Hyper+R",
      "Ctrl+Foo",
      "F25",
      "é",
      "Ctrl++Shift",
    ]) {
      expect(parseAccelerator(bad, "win"), bad).toBeNull();
    }
  });

  it("normalizeKey lowercases letters to upper and keeps punctuation", () => {
    expect(normalizeKey("a")).toBe("A");
    expect(normalizeKey("[")).toBe("[");
    expect(normalizeKey("pageup")).toBe("PageUp");
    expect(normalizeKey("?")).toBeNull();
  });

  it("property: parse(format(a, p), p) round-trips on both platforms", () => {
    fc.assert(
      fc.property(accelArb, platformArb, (a, p) => {
        const parsed = parseAccelerator(formatAccelerator(a, p), p);
        expect(parsed).not.toBeNull();
        expect(acceleratorsEqual(parsed as Accelerator, a)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("property: canonical serialization parses identically on every platform", () => {
    fc.assert(
      fc.property(accelArb, platformArb, (a, p) => {
        expect(parseAccelerator(serializeAccelerator(a), p)).toEqual(a);
      }),
      { numRuns: 500 },
    );
  });

  it("property: format is idempotent through parse (display → parse → display)", () => {
    fc.assert(
      fc.property(accelArb, platformArb, (a, p) => {
        const once = formatAccelerator(a, p);
        const parsed = parseAccelerator(once, p);
        expect(parsed && formatAccelerator(parsed, p)).toBe(once);
      }),
    );
  });
});

describe("toElectronAccelerator", () => {
  it("maps meta to Command on mac, Super elsewhere, and arrows to Electron names", () => {
    expect(toElectronAccelerator(acc("R", { meta: true, shift: true }), "mac")).toBe(
      "Command+Shift+R",
    );
    expect(toElectronAccelerator(acc("R", { ctrl: true, shift: true }), "win")).toBe(
      "Control+Shift+R",
    );
    expect(toElectronAccelerator(acc("ArrowUp", { meta: true }), "win")).toBe("Super+Up");
    expect(toElectronAccelerator(acc("Escape"), "mac")).toBe("Escape");
  });

  it("platform mapping", () => {
    expect(shortcutPlatformFor("darwin")).toBe("mac");
    expect(shortcutPlatformFor("win32")).toBe("win");
    expect(shortcutPlatformFor("linux")).toBe("win");
  });
});

describe("acceleratorFromEvent", () => {
  const ev = (
    key: string,
    code: string,
    mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
  ) => ({ key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

  it("uses the layout key for letters and the physical code for altered characters", () => {
    expect(acceleratorFromEvent(ev("e", "KeyE", { metaKey: true }))).toEqual(
      acc("E", { meta: true }),
    );
    // Option+A on mac produces "å".
    expect(acceleratorFromEvent(ev("å", "KeyA", { altKey: true }))).toEqual(
      acc("A", { alt: true }),
    );
    // Shift+[ produces "{".
    expect(acceleratorFromEvent(ev("{", "BracketLeft", { shiftKey: true }))).toEqual(
      acc("[", { shift: true }),
    );
    expect(acceleratorFromEvent(ev("?", "Slash", { shiftKey: true }))).toEqual(
      acc("/", { shift: true }),
    );
    // Option+E on mac is a dead key; the physical code still identifies it.
    expect(acceleratorFromEvent(ev("Dead", "KeyE", { altKey: true }))).toEqual(
      acc("E", { alt: true }),
    );
    expect(acceleratorFromEvent(ev(" ", "Space"))).toEqual(acc("Space"));
    expect(acceleratorFromEvent(ev("ArrowLeft", "ArrowLeft"))).toEqual(acc("ArrowLeft"));
  });

  it("ignores modifier-only presses and unidentifiable keys", () => {
    expect(acceleratorFromEvent(ev("Shift", "ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev("Meta", "MetaLeft", { metaKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev("Dead", "IntlRo"))).toBeNull();
  });
});
