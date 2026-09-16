/**
 * Project caption fonts (ENGINEERING_SPEC §9.6). Custom fonts are copied into
 * the project folder and listed in `captionStyle.customFonts`; each is
 * registered with the document's `FontFaceSet` under its family name so the
 * preview and export text renderers (which draw with the page's fonts) pick
 * it up. Loads never reject: a font that fails to load is left out.
 */

/** A font file inside the project, as stored in `captionStyle.customFonts`. */
export interface ProjectFont {
  /** CSS family name the caption style refers to. */
  family: string;
  /** Project-relative path (posix separators). */
  path: string;
}

/** The subset of `FontFace` this module uses. */
export interface FontFaceLike {
  readonly family: string;
  load(): Promise<FontFaceLike>;
}

export type FontFaceCtor = new (family: string, source: string) => FontFaceLike;

/** The subset of `document.fonts` this module uses. */
export interface FontSetLike {
  add(font: FontFaceLike): unknown;
}

export interface RegisterFontsDeps {
  FontFace?: FontFaceCtor | undefined;
  fonts?: FontSetLike | undefined;
}

export const FONT_FILE_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;

/** `reelform-media://` URL for a project-relative font path; null for absolute paths. */
export function projectFontUrl(mediaBaseUrl: string | null, path: string): string | null {
  if (!mediaBaseUrl || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return null;
  return `${mediaBaseUrl}${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Family name from a font file name: `Inter-SemiBold.woff2` → `Inter SemiBold`. */
export function fontFamilyFromFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]+$/, "");
  const family = base
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return family || "Custom Font";
}

/** `family`, or `family 2`, `family 3`… so it doesn't collide with `taken` (case-insensitive). */
export function uniqueFontFamily(family: string, taken: readonly string[]): string {
  const used = new Set(taken.map((f) => f.toLowerCase()));
  if (!used.has(family.toLowerCase())) return family;
  for (let n = 2; ; n++) {
    const candidate = `${family} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** CSS `url()` source with quotes and backslashes escaped. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\]/g, (c) => `\\${c}`)}")`;
}

function defaultDeps(): Required<RegisterFontsDeps> | null {
  const Ctor = (globalThis as { FontFace?: FontFaceCtor }).FontFace;
  const fonts =
    typeof document === "undefined" ? undefined : (document.fonts as unknown as FontSetLike);
  return Ctor && fonts ? { FontFace: Ctor, fonts } : null;
}

/** Loaded registrations keyed by font set → `family|url`, so re-opening a project doesn't re-add. */
const registered = new WeakMap<FontSetLike, Map<string, Promise<boolean>>>();

/**
 * Create a `FontFace` per font, await its load, and add it to the font set.
 * Resolves with the families that are available (already or newly loaded).
 */
export async function registerProjectFonts(
  mediaBaseUrl: string | null,
  fonts: readonly ProjectFont[],
  deps: RegisterFontsDeps = {},
): Promise<string[]> {
  const fallback = deps.FontFace && deps.fonts ? null : defaultDeps();
  const Ctor = deps.FontFace ?? fallback?.FontFace;
  const set = deps.fonts ?? fallback?.fonts;
  if (!Ctor || !set) return [];
  let cache = registered.get(set);
  if (!cache) {
    cache = new Map();
    registered.set(set, cache);
  }
  const results = await Promise.all(
    fonts.map(async (font) => {
      const url = projectFontUrl(mediaBaseUrl, font.path);
      if (!url || !font.family) return null;
      const key = `${font.family}|${url}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            const face = await new Ctor(font.family, cssUrl(url)).load();
            set.add(face);
            return true;
          } catch {
            return false;
          }
        })();
        cache.set(key, pending);
      }
      const ok = await pending;
      // Failed loads may succeed later (e.g. after relinking); allow a retry.
      if (!ok) cache.delete(key);
      return ok ? font.family : null;
    }),
  );
  return [...new Set(results.filter((f): f is string => f !== null))];
}
