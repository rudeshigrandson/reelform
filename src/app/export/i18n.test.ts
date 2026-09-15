import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertValidMessage } from "../../i18n/format";
import en from "../../i18n/locales/en.json";

/**
 * Extraction contract for `src/app/export`: every `exportFlow.*` / `common.*`
 * key used here exists in the English catalog, every `exportFlow.*` message is
 * used and well-formed, and no user-facing English is left inline. The
 * `exportFlow` strings may still live in their namespace file until they are
 * merged into `en.json`; both are read.
 */

const HERE = __dirname;
const NAMESPACE = join(HERE, "../../i18n/locales/en.exportFlow.json");
const namespace: Record<string, string> = existsSync(NAMESPACE)
  ? (JSON.parse(readFileSync(NAMESPACE, "utf8")) as Record<string, string>)
  : {};
const catalog: Record<string, string> = { ...(en as Record<string, string>), ...namespace };

const KEY_LITERAL = /["'`]((?:common|exportFlow)\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

const sources = readdirSync(HERE)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "testFakes.ts")
  .map((name) => ({ name, text: readFileSync(join(HERE, name), "utf8") }));

const usedKeys = (): Map<string, string[]> => {
  const used = new Map<string, string[]>();
  for (const { name, text } of sources) {
    for (const m of text.matchAll(KEY_LITERAL)) {
      const key = m[1] as string;
      used.set(key, [...(used.get(key) ?? []), name]);
    }
  }
  return used;
};

describe("src/app/export strings", () => {
  it("every key used exists in the catalog", () => {
    const missing = [...usedKeys()]
      .filter(([key]) => !(key in catalog))
      .map(([key, files]) => `${files.join(",")}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("every exportFlow message is used and well-formed", () => {
    const used = usedKeys();
    const flow = Object.entries(catalog).filter(([k]) => k.startsWith("exportFlow."));
    expect(flow.length).toBeGreaterThan(0);
    expect(flow.filter(([k]) => !used.has(k)).map(([k]) => k)).toEqual([]);
    for (const [, message] of flow) expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("no inline English in JSX text, labels or error messages", () => {
    const offenders: string[] = [];
    const patterns = [
      // JSX text children with two or more words
      />\s*([A-Z][a-z]+(?: [A-Za-z]+)+[.…]?)\s*</g,
      // string props / fields that reach the UI
      /\b(?:label|title|notice|message|aria-label)[=:]\s*["'`]([A-Z][^"'`]*[a-z][^"'`]*)["'`]/g,
      // user-facing ExportFlowError messages (internal lowercase diagnostics stay inline)
      /new ExportFlowError\([^,]+,\s*["'`]([A-Z][^"'`]+)["'`]/g,
    ];
    for (const { name, text } of sources) {
      for (const re of patterns) {
        for (const m of text.matchAll(re)) offenders.push(`${name}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
