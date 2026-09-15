import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { assertValidMessage } from "../i18n/format";
import { LAUNCHER_MESSAGES, bridgeTranslator, launcherT, useLauncherT } from "./i18n";

describe("launcher translator", () => {
  it("falls back to the launcher namespace catalog and formats arguments", () => {
    expect(launcherT("launcher.record")).toBe("Record");
    expect(launcherT("launcher.picker.noResults", { query: "zed" })).toBe(
      "No windows match “zed”.",
    );
    expect(launcherT("launcher.options.countdownSeconds", { seconds: 10 })).toBe("10s");
    expect(launcherT("common.cancel")).toBe("Cancel");
  });

  it("prefers the app translator once it knows the key", () => {
    const translate = bridgeTranslator(
      (key) => (key === ("launcher.record" as never) ? "Aufnehmen" : key),
      "de",
    );
    expect(translate("launcher.record")).toBe("Aufnehmen");
    expect(translate("launcher.browse")).toBe("Browse…");
  });

  it("useLauncherT follows the nearest I18nProvider", () => {
    function Probe() {
      const t = useLauncherT();
      return <span>{t("launcher.picker.excludeOwn", { app: "Reelform" })}</span>;
    }
    render(
      <I18nProvider language="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Exclude Reelform windows")).toBeInTheDocument();
  });

  it.each(Object.entries(LAUNCHER_MESSAGES))("%s is a well-formed launcher message", (key, msg) => {
    expect(key.startsWith("launcher.")).toBe(true);
    expect(() => assertValidMessage(msg)).not.toThrow();
  });
});

describe("launcher extraction", () => {
  const KEY_LITERAL = /["'`](launcher\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
  const sources = readdirSync(__dirname)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => readFileSync(join(__dirname, name), "utf8"));
  const used = new Set(sources.flatMap((text) => [...text.matchAll(KEY_LITERAL)].map((m) => m[1])));

  it("every launcher key used exists in the catalog", () => {
    expect([...used].filter((k) => !((k as string) in LAUNCHER_MESSAGES))).toEqual([]);
  });

  it("every catalog key is used (no dead strings)", () => {
    expect(Object.keys(LAUNCHER_MESSAGES).filter((k) => !used.has(k))).toEqual([]);
  });

  it("no hard-coded English JSX text or labels remain", () => {
    // The product name is a brand, not copy.
    const BRAND = new Set(["Reelform"]);
    const offenders: string[] = [];
    for (const text of sources) {
      for (const m of text.matchAll(/(?:aria-label|placeholder|label)="([^"]*[A-Za-z][^"]*)"/g))
        offenders.push(m[0]);
      for (const m of text.matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+)*[.…]?)\s*</g)) {
        const copy = (m[1] as string).trim();
        if (!BRAND.has(copy)) offenders.push(copy);
      }
    }
    expect(offenders).toEqual([]);
  });
});
