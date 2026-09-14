import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { probeMediaFile } from "./mediabunnyProbe";
import { makeTmpDir, removeDir } from "./testHelpers";

// No media fixtures/encoders on CI machines: only the failure path is covered
// here; the relink handler maps any rejection to RELINK_PROBE_FAILED.
describe("probeMediaFile", () => {
  it("rejects a file that is not media", async () => {
    const dir = await makeTmpDir();
    try {
      const f = path.join(dir, "notes.mp4");
      await fsp.writeFile(f, "definitely not an mp4");
      await expect(probeMediaFile(f)).rejects.toBeTruthy();
    } finally {
      await removeDir(dir);
    }
  });
});
