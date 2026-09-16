import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, navigatorLanguages, setActiveLanguage, t, useLanguage, useT } from "./index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setActiveLanguage("en");
});

function Probe() {
  const tr = useT();
  return (
    <p>
      {useLanguage()}|{tr("settings.about.version", { version: "2.0.0" })}
    </p>
  );
}

describe("I18nProvider / useT", () => {
  it("defaults to English without a provider", () => {
    render(<Probe />);
    expect(screen.getByText("en|Version 2.0.0")).toBeInTheDocument();
  });

  it("'system' reads navigator.languages and falls back to English", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "en-US"]);
    expect(navigatorLanguages()).toEqual(["fr-CA", "en-US"]);
    render(
      <I18nProvider language="system">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("en|Version 2.0.0")).toBeInTheDocument();
  });

  it("uses navigator.language when languages is empty", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    expect(navigatorLanguages()).toEqual(["de-DE"]);
  });

  it("an unknown explicit language renders English and syncs the standalone t", () => {
    render(
      <I18nProvider language="xx-YY">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText("en|Version 2.0.0")).toBeInTheDocument();
    expect(t("common.none")).toBe("None");
  });
});
