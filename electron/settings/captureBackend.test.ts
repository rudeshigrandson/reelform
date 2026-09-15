import { backendOverrideFor } from "./captureBackend";

describe("backendOverrideFor", () => {
  it("auto never overrides", () => {
    for (const p of ["darwin", "win32", "linux"]) expect(backendOverrideFor("auto", p)).toBeNull();
  });

  it("electron forces the Electron backend everywhere", () => {
    for (const p of ["darwin", "win32", "linux"]) {
      expect(backendOverrideFor("electron", p)).toBe("electron");
    }
  });

  it("native maps to the platform helper, or auto where none exists", () => {
    expect(backendOverrideFor("native", "darwin")).toBe("sck");
    expect(backendOverrideFor("native", "win32")).toBe("wgc");
    expect(backendOverrideFor("native", "linux")).toBeNull();
  });
});
