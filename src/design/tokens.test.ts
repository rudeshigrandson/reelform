import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Token contract: every semantic token exists in the light block and in both
 * dark blocks (media query + explicit override), the two dark blocks agree,
 * and every `var(--…)` used anywhere in src resolves to a defined token.
 */

const SRC = join(__dirname, "..");
const tokensCss = readFileSync(join(__dirname, "tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const componentsCss = readFileSync(join(__dirname, "components.css"), "utf8");

const SEMANTIC_TOKENS = [
  "--bg-app",
  "--bg-panel",
  "--bg-panel-raised",
  "--bg-sunken",
  "--bg-hover",
  "--bg-active",
  "--border",
  "--border-strong",
  "--text-1",
  "--text-2",
  "--text-3",
  "--accent",
  "--accent-hover",
  "--accent-pressed",
  "--accent-soft",
  "--on-accent",
  "--focus-ring",
  "--record",
  "--danger",
  "--success",
  "--warning",
  "--scrim",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--track-video",
  "--track-zoom",
  "--track-speed",
  "--track-annotations",
  "--track-audio",
  "--track-captions",
  "--track-webcam",
] as const;

/** Body of the first `{…}` block that follows `selector` at or after `from`. */
function blockAfter(css: string, selector: string, from = 0): { body: string; end: number } {
  const at = css.indexOf(selector, from);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  // A selector written with its own "{" (":root {") opens at that brace, not the next block's.
  const open = css.indexOf("{", at + selector.replace(/\{\s*$/, "").length);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
  }
  throw new Error(`unbalanced block: ${selector}`);
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim());
  }
  return out;
}

/** The light block is the bare `:root {` that declares --bg-app. */
function lightBlock(): Map<string, string> {
  let from = 0;
  for (;;) {
    const at = tokensCss.indexOf(":root {", from);
    if (at < 0) throw new Error("light :root block not found");
    const { body, end } = blockAfter(tokensCss, ":root {", at);
    const decls = declarations(body);
    if (decls.has("--bg-app")) return decls;
    from = end;
  }
}

const light = lightBlock();
const mediaDark = declarations(
  blockAfter(
    blockAfter(tokensCss, "@media (prefers-color-scheme: dark)").body,
    ':root:not([data-theme="light"])',
  ).body,
);
const forcedDark = declarations(blockAfter(tokensCss, ':root[data-theme="dark"]').body);

describe("tokens.css themes", () => {
  it.each(SEMANTIC_TOKENS)("%s is defined in light, media-dark and forced-dark", (token) => {
    expect(light.get(token), `light ${token}`).toBeTruthy();
    expect(mediaDark.get(token), `media dark ${token}`).toBeTruthy();
    expect(forcedDark.get(token), `forced dark ${token}`).toBeTruthy();
  });

  it("the media-query dark block and the data-theme=dark block are identical", () => {
    expect(Object.fromEntries(mediaDark)).toEqual(Object.fromEntries(forcedDark));
  });

  it("dark actually differs from light for surfaces and text", () => {
    for (const t of ["--bg-app", "--bg-panel", "--bg-sunken", "--text-1", "--accent"]) {
      expect(forcedDark.get(t), t).not.toBe(light.get(t));
    }
  });

  it("dark blocks only redefine tokens the light block also defines", () => {
    for (const t of forcedDark.keys()) expect(light.has(t), t).toBe(true);
  });

  it("keeps the legacy Organic names as aliases of semantic tokens", () => {
    const all = declarations(tokensCss);
    expect(all.get("--color-bg")).toBe("var(--bg-app)");
    expect(all.get("--color-surface")).toBe("var(--bg-panel-raised)");
    expect(all.get("--color-text")).toBe("var(--text-1)");
    expect(all.get("--color-accent")).toBe("var(--accent)");
    expect(all.get("--color-divider")).toBe("var(--border-strong)");
  });

  it("does not load remote fonts (CSP + local-first)", () => {
    expect(tokensCss).not.toMatch(/@import|https?:\/\//);
  });
});

describe("density and reduced motion (S24 Appearance)", () => {
  const componentsNoComments = componentsCss.replace(/\/\*[\s\S]*?\*\//g, "");

  it('compact density overrides spacing, control and row heights on :root[data-density="compact"]', () => {
    const compact = declarations(blockAfter(tokensCss, ':root[data-density="compact"]').body);
    for (const token of [
      "--space-1",
      "--space-2",
      "--space-3",
      "--space-4",
      "--space-5",
      "--space-6",
      "--space-8",
      "--control-height",
      "--row-height",
    ]) {
      const value = compact.get(token);
      expect(value, token).toBeTruthy();
      // Defined in the comfortable block too, and compact is strictly smaller.
      const comfortable = lightTokens.get(token);
      expect(comfortable, `comfortable ${token}`).toBeTruthy();
      expect(Number.parseFloat(value as string), token).toBeLessThan(
        Number.parseFloat(comfortable as string),
      );
    }
  });

  it("blockAfter opens at a selector's own brace", () => {
    const css = ":root { --a: 1; } :root[x] { --a: 2; } .b { c: d; } .b::after { e: f; }";
    expect(blockAfter(css, ":root {").body.trim()).toBe("--a: 1;");
    expect(blockAfter(css, ".b {").body.trim()).toBe("c: d;");
    expect(blockAfter(css, ":root[x]").body.trim()).toBe("--a: 2;");
  });

  it("components size controls and rows from the density tokens", () => {
    expect(blockAfter(componentsNoComments, ".input {").body).toContain("var(--control-height)");
    expect(blockAfter(componentsNoComments, ".btn-icon {").body).toContain("var(--control-height)");
    expect(blockAfter(componentsNoComments, ".table td {").body).toContain("var(--row-height)");
  });

  it('the in-app toggle collapses motion via :root[data-reduce-motion="true"] *', () => {
    const body = blockAfter(componentsNoComments, ':root[data-reduce-motion="true"] *').body;
    expect(body).toMatch(/animation-duration:\s*0?\.001ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0?\.001ms\s*!important/);
  });

  it("the OS setting is honoured via @media (prefers-reduced-motion: reduce)", () => {
    const media = blockAfter(componentsNoComments, "@media (prefers-reduced-motion: reduce)").body;
    const star = blockAfter(media, "*").body;
    expect(star).toMatch(/animation-duration:\s*0?\.001ms\s*!important/);
    expect(star).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(star).toMatch(/transition-duration:\s*0?\.001ms\s*!important/);
  });
});

/** Theme-independent `:root {` block (spacing, radii, control heights). */
const lightTokens = declarations(blockAfter(tokensCss, ":root {").body);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("var(--…) references", () => {
  it("every referenced custom property is defined", () => {
    const defined = new Set<string>([
      ...declarations(tokensCss).keys(),
      ...declarations(componentsCss).keys(),
      // Set at runtime on <html> by src/app/settings/appearance.ts (theme accent
      // kept while a custom accent swatch overrides --accent).
      "--accent-theme",
    ]);
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        if (!defined.has(m[1] as string)) missing.push(`${relative(SRC, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
