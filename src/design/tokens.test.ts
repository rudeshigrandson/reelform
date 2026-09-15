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
  const open = css.indexOf("{", at + selector.length);
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
