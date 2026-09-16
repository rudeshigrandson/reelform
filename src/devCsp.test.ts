import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devCspPlugin, relaxScriptSrcForDev } from "../vite.config";

/**
 * index.html's CSP must stay strict for builds, while the dev server allows
 * the inline react-refresh preamble @vitejs/plugin-react injects.
 */

const html = readFileSync(join(__dirname, "../index.html"), "utf8");
const scriptSrc = (doc: string): string => {
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(doc)?.[1];
  if (!csp) throw new Error("no CSP meta tag");
  const directive = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "));
  if (!directive) throw new Error("no script-src");
  return directive;
};

describe("Content-Security-Policy", () => {
  it("production index.html keeps a strict script-src (no inline, no eval)", () => {
    const src = scriptSrc(html);
    expect(src).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(src).not.toContain("'unsafe-inline'");
    expect(src).not.toMatch(/'unsafe-eval'/);
  });

  it("the relaxing plugin only applies to the dev server", () => {
    const plugin = devCspPlugin();
    expect(plugin.apply).toBe("serve");
    expect(plugin.transformIndexHtml).toBe(relaxScriptSrcForDev);
  });

  it("dev allows inline scripts in script-src and changes nothing else", () => {
    const dev = relaxScriptSrcForDev(html);
    expect(scriptSrc(dev)).toBe("script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'");
    expect(dev.replace(" 'unsafe-inline'", "")).toBe(html);
    // worker-src / style-src untouched; idempotent.
    expect(dev).toContain("worker-src 'self' blob:;");
    expect(relaxScriptSrcForDev(dev)).toBe(dev);
  });
});
