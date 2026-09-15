import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator, setActiveLanguage } from "../../i18n";
import { assertValidMessage } from "../../i18n/format";
import inspectorEn from "../../i18n/locales/en.inspector.json";
import {
  type InspectorMessageKey,
  ti,
  translateInspector,
  translatedRecord,
  withDetail,
} from "./i18n";

const messages = inspectorEn as Record<string, string>;
const KEY_LITERAL = /["'`](inspector\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

const sources = walk(__dirname).map((file) => ({ file, text: readFileSync(file, "utf8") }));

afterEach(() => setActiveLanguage("en"));

describe("inspector i18n", () => {
  it.each(Object.entries(messages))("%s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("every key is namespaced under inspector.", () => {
    expect(Object.keys(messages).filter((k) => !k.startsWith("inspector."))).toEqual([]);
  });

  it("every inspector key used in src/editor/inspector exists in the namespace file", () => {
    const missing: string[] = [];
    for (const { file, text } of sources)
      for (const m of text.matchAll(KEY_LITERAL))
        if (!((m[1] as string) in messages)) missing.push(`${relative(__dirname, file)}: ${m[1]}`);
    expect(missing).toEqual([]);
  });

  it("every key in the namespace file is used (no dead strings)", () => {
    const used = new Set<string>();
    for (const { text } of sources)
      for (const m of text.matchAll(KEY_LITERAL)) used.add(m[1] as string);
    expect(Object.keys(messages).filter((k) => !used.has(k))).toEqual([]);
  });

  it("falls back to the namespace file while the shared catalog lacks the key", () => {
    expect(ti("inspector.zoom.suggestions.count", { count: 3 })).toBe("We suggested 3 zooms");
    expect(ti("inspector.multiSelect.items", { count: 1 })).toBe("1 item");
    setActiveLanguage("xx");
    expect(ti("inspector.common.delete")).toBe("Delete");
  });

  it("prefers the window translator when it knows the key", () => {
    const translate = ((key: string) =>
      key === "inspector.common.delete" ? "Löschen" : key) as Parameters<
      typeof translateInspector
    >[0];
    expect(translateInspector(translate, "inspector.common.delete")).toBe("Löschen");
    expect(translateInspector(createTranslator("en"), "inspector.common.remove")).toBe("Remove");
  });

  it("translatedRecord reads through on every access", () => {
    const keys: Record<"a" | "b", InspectorMessageKey> = {
      a: "inspector.common.keep",
      b: "inspector.common.apply",
    };
    const record = translatedRecord(keys);
    expect({ ...record }).toEqual({ a: "Keep", b: "Apply" });
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("withDetail drops the trailing space when there is no detail", () => {
    const tr = (k: InspectorMessageKey, v?: Readonly<Record<string, string | number>>) =>
      translateInspector(createTranslator("en"), k, v);
    expect(withDetail(tr, "inspector.audio.error.add", "")).toBe("Couldn't add audio.");
    expect(withDetail(tr, "inspector.audio.error.add", "Bad file")).toBe(
      "Couldn't add audio. Bad file",
    );
  });
});
