import fc from "fast-check";
import { WINDOW_KINDS } from "../../electron/windows/windowKinds";
import { buildLoadTarget } from "../../electron/windows/windowUrl";
import { ROUTER_WINDOW_KINDS, isTransparentKind, parseWindowRoute } from "./windowRoute";

describe("parseWindowRoute", () => {
  it("stays in sync with the main-process window kinds", () => {
    expect([...ROUTER_WINDOW_KINDS]).toEqual([...WINDOW_KINDS]);
  });

  it("parses each kind with its params", () => {
    expect(parseWindowRoute("?window=launcher")).toEqual({ kind: "launcher" });
    expect(parseWindowRoute("?window=editor&projectId=p1")).toEqual({
      kind: "editor",
      projectId: "p1",
    });
    expect(parseWindowRoute("window=settings")).toEqual({ kind: "settings" });
    expect(parseWindowRoute("?window=hud")).toEqual({ kind: "hud" });
    expect(parseWindowRoute("?window=hud&displayId=2")).toEqual({ kind: "hud", displayId: "2" });
    expect(parseWindowRoute("?window=region-overlay&displayId=7")).toEqual({
      kind: "region-overlay",
      displayId: "7",
    });
    expect(parseWindowRoute("?window=countdown")).toEqual({ kind: "countdown" });
    expect(parseWindowRoute("?window=webcam-bubble&projectId=x")).toEqual({
      kind: "webcam-bubble",
    });
  });

  it("falls back to launcher for missing, unknown or invalid input", () => {
    for (const s of [
      "",
      "?",
      "?window=",
      "?window=admin",
      "?window=EDITOR&projectId=p",
      "?window=editor",
      "?window=editor&projectId=%20%20",
      "?window=region-overlay",
      `?window=editor&projectId=${"x".repeat(300)}`,
    ]) {
      expect(parseWindowRoute(s)).toEqual({ kind: "launcher" });
    }
  });

  it("property: never throws, always yields a known kind", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(ROUTER_WINDOW_KINDS).toContain(parseWindowRoute(s).kind);
      }),
    );
  });

  it("property: round-trips URLs built by main", () => {
    const id = fc.stringMatching(/^[A-Za-z0-9_-]{1,32}$/);
    fc.assert(
      fc.property(fc.constantFrom(...WINDOW_KINDS), id, id, (kind, projectId, displayId) => {
        const t = buildLoadTarget(
          { type: "dev", devServerUrl: "http://localhost:5173" },
          { kind, projectId, displayId },
        );
        if (t.type !== "url") throw new Error("expected url");
        const route = parseWindowRoute(new URL(t.url).search);
        expect(route.kind).toBe(kind);
        if (route.kind === "editor") expect(route.projectId).toBe(projectId);
        if (route.kind === "region-overlay" || route.kind === "hud" || route.kind === "countdown") {
          expect(route.displayId).toBe(displayId);
        }
      }),
    );
  });

  it("marks overlay kinds transparent", () => {
    expect(isTransparentKind("hud")).toBe(true);
    expect(isTransparentKind("webcam-bubble")).toBe(true);
    expect(isTransparentKind("editor")).toBe(false);
  });
});
