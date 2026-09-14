import fc from "fast-check";
import { WINDOW_KINDS, type WindowParams } from "./windowKinds";
import { buildLoadTarget, parseWindowQuery, windowQuery } from "./windowUrl";

const idArb = fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined });
const paramsArb = fc.record({
  kind: fc.constantFrom(...WINDOW_KINDS),
  projectId: idArb,
  displayId: idArb,
});

const strip = (p: WindowParams): WindowParams => {
  const out: WindowParams = { kind: p.kind };
  if (p.projectId) out.projectId = p.projectId;
  if (p.displayId) out.displayId = p.displayId;
  return out;
};

describe("window URLs", () => {
  it("round-trips params through the dev-server URL", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const t = buildLoadTarget({ type: "dev", devServerUrl: "http://localhost:5173/" }, params);
        expect(t.type).toBe("url");
        if (t.type !== "url") return;
        const u = new URL(t.url);
        expect(u.origin).toBe("http://localhost:5173");
        expect(parseWindowQuery(u.search)).toEqual(strip(params));
      }),
    );
  });

  it("round-trips params through loadFile query", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const t = buildLoadTarget({ type: "file", indexHtmlPath: "/app/dist/index.html" }, params);
        expect(t.type).toBe("file");
        if (t.type !== "file") return;
        expect(t.filePath).toBe("/app/dist/index.html");
        expect(parseWindowQuery(new URLSearchParams(t.query).toString())).toEqual(strip(params));
      }),
    );
  });

  it("encodes special characters and preserves existing dev URL params", () => {
    const t = buildLoadTarget(
      { type: "dev", devServerUrl: "http://localhost:5173/?debug=1" },
      { kind: "editor", projectId: "a b&c=d/é" },
    );
    if (t.type !== "url") throw new Error("expected url");
    const u = new URL(t.url);
    expect(u.searchParams.get("debug")).toBe("1");
    expect(u.searchParams.get("projectId")).toBe("a b&c=d/é");
  });

  it("omits empty params and rejects unknown kinds", () => {
    expect(windowQuery({ kind: "hud", displayId: "", projectId: undefined })).toEqual({
      window: "hud",
    });
    expect(parseWindowQuery("?window=nope")).toBeNull();
    expect(parseWindowQuery("")).toBeNull();
  });
});
