import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidMessage, createTranslator } from "../i18n/format";
import catalog from "../i18n/locales/en.onboarding.json";
import { createOnboardingTranslator } from "./i18n";

const messages = catalog as Record<string, string>;
const KEY_LITERAL = /["'`](onboarding\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("onboarding translator", () => {
  it("formats namespace messages with arguments", () => {
    const t = createOnboardingTranslator(createTranslator("en"));
    expect(t("onboarding.welcome.version", { version: "1.2.3" })).toBe("Version 1.2.3");
    expect(t("onboarding.permissions.allowLabel", { permission: "Camera" })).toBe("Allow Camera");
  });

  it("prefers the shared translator when it knows the key", () => {
    const base = ((key: string) =>
      key === "onboarding.nav.back" ? "Zurück" : key) as Parameters<
      typeof createOnboardingTranslator
    >[0];
    const t = createOnboardingTranslator(base, "de");
    expect(t("onboarding.nav.back")).toBe("Zurück");
    expect(t("onboarding.permissions.continue")).toBe("Continue");
  });
});

describe("onboarding catalog", () => {
  it.each(Object.entries(messages))("%s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("every key used in src/onboarding exists, and every key is used", () => {
    const used = new Set<string>();
    for (const file of walk(__dirname)) {
      for (const m of readFileSync(file, "utf8").matchAll(KEY_LITERAL)) used.add(m[1] as string);
    }
    expect([...used].filter((k) => !(k in messages))).toEqual([]);
    expect(Object.keys(messages).filter((k) => !used.has(k))).toEqual([]);
  });
});
