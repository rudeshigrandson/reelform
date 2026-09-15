/**
 * Release notes arrive as GitHub-release HTML (electron-updater). They are never
 * injected as HTML: this converts them to plain text paragraphs rendered as
 * React text nodes, so scripts/handlers/links can't execute.
 */

const BLOCK_TAGS =
  /<\s*\/?\s*(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|pre|blockquote|hr)\b[^>]*>/gi;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const cp = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    if (body.startsWith("#")) {
      const cp = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** HTML (or markdown-ish text) → trimmed plain-text paragraphs. */
export function releaseNotesToText(html: string | null | undefined): string[] {
  if (!html) return [];
  const text = html
    // Drop content of elements that must never show as text.
    .replace(/<\s*(script|style|iframe|object|embed|template)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*li\b[^>]*>/gi, "\n• ")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/<[^>]*$/g, "");
  return decodeEntities(text)
    .split(/\n+/)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0 && line !== "•");
}
