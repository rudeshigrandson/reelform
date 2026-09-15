import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMainTranslator } from "../../electron/i18n";
import {
  assertValidMessage,
  createTranslator,
  formatMessage,
  resolveLanguage,
  setActiveLanguage,
  t,
} from "./format";
import en from "./locales/en.json";

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..");
const messages = en as Record<string, string>;

afterEach(() => setActiveLanguage("en"));

describe("formatMessage", () => {
  it("interpolates strings and locale-formats numbers", () => {
    expect(formatMessage("Hello {name}!", { name: "Ada" })).toBe("Hello Ada!");
    expect(formatMessage("{n} MB", { n: 1234.5 })).toBe("1,234.5 MB");
    expect(formatMessage("{n} MB", { n: "1234" })).toBe("1234 MB");
    expect(formatMessage("{ spaced }", { spaced: "ok" })).toBe("ok");
  });

  it("leaves missing arguments visible and passes plain text through", () => {
    expect(formatMessage("Hi {name}")).toBe("Hi {name}");
    expect(formatMessage("No braces here")).toBe("No braces here");
    expect(formatMessage("Broken {open")).toBe("Broken {open");
  });

  it("plural: exact match, categories, # substitution and nested arguments", () => {
    const msg = "{count, plural, =0 {No files} one {# file in {dir}} other {# files in {dir}}}";
    expect(formatMessage(msg, { count: 0, dir: "a" })).toBe("No files");
    expect(formatMessage(msg, { count: 1, dir: "a" })).toBe("1 file in a");
    expect(formatMessage(msg, { count: 1200, dir: "b" })).toBe("1,200 files in b");
    expect(formatMessage(msg, { count: "3", dir: "c" })).toBe("3 files in c");
  });

  it("plural uses the locale's categories and falls back to other", () => {
    const msg = "{n, plural, one {one} few {few} many {many} other {other}}";
    expect(formatMessage(msg, { n: 3 }, "pl")).toBe("few");
    expect(formatMessage(msg, { n: 5 }, "pl")).toBe("many");
    expect(formatMessage(msg, { n: 3 }, "en")).toBe("other");
    expect(formatMessage("{n, plural, other {# x}}", { n: 1 })).toBe("1 x");
  });

  it("leaves a plural untouched when the count is missing or branches are malformed", () => {
    expect(formatMessage("{n, plural, one {a} other {b}}")).toBe("{n, plural, one {a} other {b}}");
    expect(formatMessage("{n, plural, one {a}}", { n: 1 })).toBe("{n, plural, one {a}}");
  });
});

describe("assertValidMessage", () => {
  it("rejects unbalanced braces, bad arguments and plurals without other", () => {
    expect(() => assertValidMessage("a {b")).toThrow(/unbalanced/);
    expect(() => assertValidMessage("a } b")).toThrow(/unbalanced/);
    expect(() => assertValidMessage("{not an arg}")).toThrow(/bad argument/);
    expect(() => assertValidMessage("{n, plural, one {x}}")).toThrow(/other/);
    expect(() => assertValidMessage("{n, plural, one {x} other {{bad arg}}}")).toThrow();
    expect(() => assertValidMessage("{n, plural, one {# {x}} other {#}}")).not.toThrow();
  });

  it.each(Object.entries(messages))("en.json %s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });
});

describe("resolveLanguage", () => {
  const available = { en: {}, de: {}, "pt-BR": {} };

  it("'system' walks the preferred list: exact, then base language, then English", () => {
    expect(resolveLanguage("system", ["fr-FR", "pt-br"], available)).toBe("pt-BR");
    expect(resolveLanguage("system", ["de_AT"], available)).toBe("de");
    expect(resolveLanguage("system", ["ja", "fr"], available)).toBe("en");
    expect(resolveLanguage("system", [], available)).toBe("en");
    expect(resolveLanguage(undefined, ["de"], available)).toBe("de");
  });

  it("an explicit language ignores the OS list and falls back to English when unknown", () => {
    expect(resolveLanguage("de", ["pt-BR"], available)).toBe("de");
    expect(resolveLanguage("xx", ["de"], available)).toBe("en");
    expect(resolveLanguage("en", ["de"])).toBe("en");
  });
});

describe("translators", () => {
  it("createTranslator falls back to English, then to the key", () => {
    const tr = createTranslator("xx");
    expect(tr("settings.section.general")).toBe("General");
    expect(tr("settings.about.version", { version: "1.2.3" })).toBe("Version 1.2.3");
    // biome-ignore lint/suspicious/noExplicitAny: exercising an unknown key at runtime.
    expect(tr("no.such.key" as any)).toBe("no.such.key");
  });

  it("standalone t follows setActiveLanguage (unknown → English)", () => {
    setActiveLanguage("xx");
    expect(t("common.cancel")).toBe("Cancel");
    expect(t("settings.shortcuts.conflicts", { count: 2 })).toBe(
      "2 shortcut conflicts — only one of the actions will run.",
    );
    expect(t("settings.shortcuts.conflicts", { count: 1 })).toMatch(/^One shortcut conflict/);
  });

  it("electron/i18n resolves the setting against the OS languages", () => {
    const main = createMainTranslator("system", ["en-GB"]);
    expect(main.language).toBe("en");
    expect(main.t("main.tray.quit")).toBe("Quit Reelform");
    expect(createMainTranslator("ja", ["ja-JP"]).t("main.tray.newRecording")).toBe("New recording");
  });
});

// ── Extraction contract ─────────────────────────────────────────────────────

/** Folders whose strings are extracted; add a folder here when it is migrated. */
const EXTRACTED_DIRS = ["src/settings", "src/app/settings", "src/i18n"];
const EXTRACTED_FILES = ["electron/i18n.ts"];
const KEY_LITERAL = /["'`]((?:common|settings|main)\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

const sources = [
  ...EXTRACTED_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...EXTRACTED_FILES.map((f) => join(ROOT, f)),
].map((file) => ({ file, text: readFileSync(file, "utf8") }));

describe("locale keys", () => {
  it("every key used in extracted files exists in en.json", () => {
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(KEY_LITERAL)) {
        if (!((m[1] as string) in messages)) missing.push(`${relative(ROOT, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every settings/common key in en.json is used (no dead strings)", () => {
    const used = new Set<string>();
    for (const { text } of sources)
      for (const m of text.matchAll(KEY_LITERAL)) used.add(m[1] as string);
    const unused = Object.keys(messages).filter(
      (k) => /^(settings|common)\./.test(k) && !used.has(k),
    );
    expect(unused).toEqual([]);
  });

  it("the key scanner sees the key forms pages use", () => {
    const sample = `t("settings.a.b"); labelKey: "common.none", x = 'settings.c'; "settings:get"`;
    expect([...sample.matchAll(KEY_LITERAL)].map((m) => m[1])).toEqual([
      "settings.a.b",
      "common.none",
      "settings.c",
    ]);
  });
});
