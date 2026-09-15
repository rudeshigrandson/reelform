import { afterEach, describe, expect, it } from "vitest";
import { type Translate, setActiveLanguage } from "../i18n";
import { assertValidMessage } from "../i18n/format";
import shortcutsEn from "../i18n/locales/en.shortcuts.json";
import {
  SHORTCUT_GROUP_KEYS,
  shortcutGroupLabel,
  shortcutLabel,
  st,
  translateShortcuts,
} from "./i18n";
import { evaluateRecordedKey, filterShortcuts, shortcutLabelFor } from "./recorder";
import { SHORTCUTS, resolveShortcuts } from "./registry";

afterEach(() => setActiveLanguage("en"));

describe("shortcuts i18n", () => {
  it.each(Object.entries(shortcutsEn))("en.shortcuts.json %s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("uses the window translator when the catalog has the key", () => {
    const translate: Translate = (key, vars) => `[${key}:${vars?.query ?? ""}]`;
    expect(translateShortcuts(translate, "shortcuts.overlay.noMatch", { query: "x" })).toBe(
      "[shortcuts.overlay.noMatch:x]",
    );
  });

  it("falls back to the namespace English when the catalog returns the raw key", () => {
    const echo: Translate = (key) => key;
    expect(translateShortcuts(echo, "shortcuts.overlay.noMatch", { query: "zz" })).toBe(
      "No shortcuts match “zz”.",
    );
    setActiveLanguage("xx");
    expect(st("shortcuts.group.timeline")).toBe("Timeline");
  });

  it("every registry entry has a label key whose English is its label", () => {
    const ids = new Set<string>();
    for (const def of SHORTCUTS) {
      expect(def.labelKey).toBe(`shortcuts.label.${def.id}`);
      expect(def.label).toBe(shortcutLabel(def));
      ids.add(def.id);
    }
    expect(shortcutLabel({ labelKey: "shortcuts.label.editor.export" })).toBe("Export…");
    expect(shortcutGroupLabel("Editor")).toBe("Editor");
    expect(ids.size).toBe(SHORTCUTS.length);
  });

  it("labels, search and the invalid-global message use the given translator", () => {
    const upper = (key: string) => `${key.toUpperCase()}!`;
    const mac = resolveShortcuts("mac");
    expect(shortcutLabelFor("editor.undo", mac, upper)).toBe("SHORTCUTS.LABEL.EDITOR.UNDO!");
    expect(shortcutLabelFor("nope", mac, upper)).toBe("nope");
    expect(filterShortcuts(mac, "label.editor.undo!", upper).map((r) => r.id)).toEqual([
      "editor.undo",
    ]);
    const key = {
      key: "r",
      code: "KeyR",
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    };
    expect(evaluateRecordedKey("record.toggle", key, mac, "mac")).toMatchObject({
      message: "Global shortcuts need ⌘, ⌥ or ⌃ so they don't take over typing in other apps.",
    });
    expect(evaluateRecordedKey("record.toggle", key, resolveShortcuts("win"), "win")).toMatchObject(
      {
        message: "Global shortcuts need Ctrl or Alt so they don't take over typing in other apps.",
      },
    );
  });

  it("every namespace key is used", () => {
    const used = new Set<string>([
      ...SHORTCUTS.map((d) => d.labelKey),
      ...Object.values(SHORTCUT_GROUP_KEYS),
      "shortcuts.invalid.globalModifiers.mac",
      "shortcuts.invalid.globalModifiers.win",
      "shortcuts.overlay.title",
      "shortcuts.overlay.search",
      "shortcuts.overlay.customize",
      "shortcuts.overlay.close",
      "shortcuts.overlay.noMatch",
      "shortcuts.overlay.unassigned",
    ]);
    expect(Object.keys(shortcutsEn).filter((k) => !used.has(k))).toEqual([]);
  });
});
