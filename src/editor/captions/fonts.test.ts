import { describe, expect, it } from "vitest";
import {
  type FontFaceLike,
  type FontSetLike,
  fontFamilyFromFileName,
  projectFontUrl,
  registerProjectFonts,
  uniqueFontFamily,
} from "./fonts";

/** FontFace stub: records constructions; sources containing "broken" fail to load. */
function stubFonts() {
  const created: { family: string; source: string }[] = [];
  const added: FontFaceLike[] = [];
  class StubFontFace implements FontFaceLike {
    constructor(
      readonly family: string,
      readonly source: string,
    ) {
      created.push({ family, source });
    }
    load(): Promise<FontFaceLike> {
      return this.source.includes("broken")
        ? Promise.reject(new Error("bad font"))
        : Promise.resolve(this);
    }
  }
  const fonts: FontSetLike = { add: (f) => added.push(f) };
  return { FontFace: StubFontFace, fonts, created, added };
}

const BASE = "reelform-media://p1/";

describe("font helpers", () => {
  it("derives family names from file names", () => {
    expect(fontFamilyFromFileName("Inter-SemiBold.woff2")).toBe("Inter SemiBold");
    expect(fontFamilyFromFileName("/Users/me/Fonts/my_font__v2.ttf")).toBe("my font v2");
    expect(fontFamilyFromFileName("C:\\fonts\\Brand.otf")).toBe("Brand");
    expect(fontFamilyFromFileName("\"'.ttf")).toBe("Custom Font");
  });

  it("makes families unique case-insensitively", () => {
    expect(uniqueFontFamily("Inter", ["Arial"])).toBe("Inter");
    expect(uniqueFontFamily("Inter", ["inter", "Inter 2"])).toBe("Inter 3");
  });

  it("builds media URLs only for project-relative paths", () => {
    expect(projectFontUrl(BASE, "media/imported/fonts/My Font.ttf")).toBe(
      `${BASE}media/imported/fonts/My%20Font.ttf`,
    );
    expect(projectFontUrl(BASE, "/abs/font.ttf")).toBeNull();
    expect(projectFontUrl(BASE, "C:/abs/font.ttf")).toBeNull();
    expect(projectFontUrl(null, "media/font.ttf")).toBeNull();
  });
});

describe("registerProjectFonts", () => {
  it("creates a FontFace per font, awaits load and adds it to the set", async () => {
    const s = stubFonts();
    const families = await registerProjectFonts(
      BASE,
      [
        { family: "Brand", path: "media/imported/fonts/Brand.woff2" },
        { family: 'Quote "Me"', path: "media/imported/fonts/q.ttf" },
      ],
      s,
    );
    expect(families).toEqual(["Brand", 'Quote "Me"']);
    expect(s.created).toEqual([
      { family: "Brand", source: `url("${BASE}media/imported/fonts/Brand.woff2")` },
      { family: 'Quote "Me"', source: `url("${BASE}media/imported/fonts/q.ttf")` },
    ]);
    expect(s.added.map((f) => f.family)).toEqual(["Brand", 'Quote "Me"']);
  });

  it("does not re-add a font already registered with the same set", async () => {
    const s = stubFonts();
    const font = { family: "Brand", path: "media/Brand.ttf" };
    await registerProjectFonts(BASE, [font], s);
    expect(await registerProjectFonts(BASE, [font, font], s)).toEqual(["Brand"]);
    expect(s.added).toHaveLength(1);
  });

  it("leaves out fonts that fail to load or can't be served, and retries failures", async () => {
    const s = stubFonts();
    const families = await registerProjectFonts(
      BASE,
      [
        { family: "Bad", path: "media/broken.ttf" },
        { family: "Abs", path: "/abs.ttf" },
        { family: "Good", path: "media/good.ttf" },
      ],
      s,
    );
    expect(families).toEqual(["Good"]);
    await registerProjectFonts(BASE, [{ family: "Bad", path: "media/broken.ttf" }], s);
    expect(s.created.filter((c) => c.family === "Bad")).toHaveLength(2);
  });

  it("is a no-op without a FontFace implementation", async () => {
    expect(
      await registerProjectFonts(BASE, [{ family: "X", path: "media/x.ttf" }], {
        fonts: { add: () => {} },
        FontFace: undefined,
      }),
    ).toEqual([]);
  });
});
