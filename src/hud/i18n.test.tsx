import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { assertValidMessage } from "../i18n/format";
import { HUD_MESSAGES, createHudTranslator, useHudT } from "./i18n";

const HUD_KEY = /["'`](hud\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;

const sources = readdirSync(__dirname)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => readFileSync(join(__dirname, name), "utf8"));

describe("hud catalog", () => {
  it.each(Object.entries(HUD_MESSAGES))("%s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("every hud key used in src/hud exists, and every catalog key is used", () => {
    const used = new Set<string>();
    for (const text of sources) for (const m of text.matchAll(HUD_KEY)) used.add(m[1] as string);
    expect([...used].filter((k) => !(k in HUD_MESSAGES))).toEqual([]);
    expect(Object.keys(HUD_MESSAGES).filter((k) => !used.has(k))).toEqual([]);
  });
});

describe("createHudTranslator", () => {
  it("formats English with arguments and locale numbers", () => {
    const t = createHudTranslator("en");
    expect(t("hud.rec.discard")).toBe("Discard");
    expect(t("hud.rec.savedUpTo", { time: "00:42" })).toBe("Recording saved up to 00:42");
    expect(t("hud.menu.fps", { fps: 60 })).toBe("60 fps");
  });

  it("falls back to English for an unknown language", () => {
    expect(createHudTranslator("xx")("hud.menu.countdownSeconds", { seconds: 10 })).toBe("10s");
  });
});

function Probe() {
  return <span>{useHudT()("hud.pre.startRecordingShortcut", { shortcut: "⌘⇧R" })}</span>;
}

describe("useHudT", () => {
  it("works with and without a provider", () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByText("Start recording ⌘⇧R")).toBeInTheDocument();
    unmount();
    render(
      <I18nProvider language="system">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("Start recording ⌘⇧R")).toBeInTheDocument();
  });
});
