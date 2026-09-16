import { describe, expect, it } from "vitest";
import { projectDirFromPick } from "./useProjectActions";

describe("projectDirFromPick", () => {
  it("keeps a picked .reelform package and strips a trailing separator", () => {
    expect(projectDirFromPick("/Users/me/Talk.reelform")).toBe("/Users/me/Talk.reelform");
    expect(projectDirFromPick("/Users/me/Talk.reelform/")).toBe("/Users/me/Talk.reelform");
  });

  it("maps a project.json inside a project folder to the folder (any separator/case)", () => {
    expect(projectDirFromPick("/Users/me/Talk.reelform/project.json")).toBe(
      "/Users/me/Talk.reelform",
    );
    expect(projectDirFromPick("C:\\Work\\Talk.reelform\\Project.JSON")).toBe(
      "C:\\Work\\Talk.reelform",
    );
  });
});
