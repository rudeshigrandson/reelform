import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidMessage, createTranslator } from "../i18n/format";
import en from "../i18n/locales/en.json";
import catalog from "../i18n/locales/en.projects.json";
import { createProjectsTranslator } from "./i18n";

const messages = catalog as Record<string, string>;
const shared = en as Record<string, string>;
const PROJECTS_KEY = /["'`](projects\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
const COMMON_KEY = /["'`](common\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

const sources = walk(__dirname).map((file) => readFileSync(file, "utf8"));

describe("projects translator", () => {
  it("formats namespace messages with arguments", () => {
    const t = createProjectsTranslator(createTranslator("en"));
    expect(t("projects.card.open", { name: "Demo" })).toBe("Open Demo");
    expect(t("projects.relative.minutes", { count: 5 })).toBe("5m ago");
    expect(t("projects.nameDialog.copyName", { name: "Demo" })).toBe("Demo copy");
  });

  it("resolves shared common keys through the app catalog", () => {
    const t = createProjectsTranslator(createTranslator("en"));
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("prefers the shared translator when it knows the key", () => {
    const base = ((key: string) => (key === "projects.retry" ? "Erneut" : key)) as Parameters<
      typeof createProjectsTranslator
    >[0];
    const t = createProjectsTranslator(base, "de");
    expect(t("projects.retry")).toBe("Erneut");
    expect(t("projects.dismiss")).toBe("Dismiss");
  });
});

describe("projects catalog", () => {
  it.each(Object.entries(messages))("%s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("every key used in src/projects exists, and every key is used", () => {
    const used = new Set<string>();
    for (const text of sources) {
      for (const m of text.matchAll(PROJECTS_KEY)) used.add(m[1] as string);
    }
    expect([...used].filter((k) => !(k in messages))).toEqual([]);
    expect(Object.keys(messages).filter((k) => !used.has(k))).toEqual([]);
  });

  it("every common key used in src/projects exists in en.json", () => {
    const missing: string[] = [];
    for (const text of sources) {
      for (const m of text.matchAll(COMMON_KEY)) {
        if (!((m[1] as string) in shared)) missing.push(m[1] as string);
      }
    }
    expect(missing).toEqual([]);
  });
});
