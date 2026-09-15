import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  THEME_ATTRIBUTE,
  type ThemePreference,
  applyThemePreference,
  resolveTheme,
  useThemePreference,
} from "./theme";

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("applyThemePreference", () => {
  it("pins light and dark via data-theme on <html> by default", () => {
    applyThemePreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyThemePreference("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes data-theme for system so prefers-color-scheme decides", () => {
    applyThemePreference("dark");
    applyThemePreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("targets a custom root without touching <html>", () => {
    const root = document.createElement("div");
    applyThemePreference("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("system on a root that never had the attribute is a no-op", () => {
    const root = document.createElement("div");
    applyThemePreference("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});

describe("resolveTheme", () => {
  it.each<[ThemePreference, boolean, "light" | "dark"]>([
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
    ["dark", false, "dark"],
  ])("%s with OS dark=%s → %s", (pref, osDark, expected) => {
    expect(resolveTheme(pref, osDark)).toBe(expected);
  });
});

describe("useThemePreference", () => {
  it("applies the preference and follows changes", () => {
    const { rerender } = renderHook(({ pref }) => useThemePreference(pref), {
      initialProps: { pref: "dark" as ThemePreference },
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    rerender({ pref: "light" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    rerender({ pref: "system" });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    rerender({ pref: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("removes the attribute on unmount when none existed before", () => {
    const { unmount } = renderHook(() => useThemePreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    unmount();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("restores a pre-existing attribute on unmount", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { unmount } = renderHook(() => useThemePreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    unmount();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("works against an explicit root", () => {
    const root = document.createElement("div");
    const { unmount } = renderHook(() => useThemePreference("light", root));
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    unmount();
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});
