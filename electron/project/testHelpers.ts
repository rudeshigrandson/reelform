import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { FsLike } from "./fsTypes";

/** Shared test fixtures for electron/project and electron/export (not shipped code). */

export async function makeTmpDir(prefix = "reelform-fs-"): Promise<string> {
  return fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), prefix)));
}

export const removeDir = (dir: string) => fsp.rm(dir, { recursive: true, force: true });

/** Real fs with selected methods overridden (fault injection). */
export function faultyFs(overrides: Partial<FsLike>): FsLike {
  return { ...(fsp as FsLike), ...overrides };
}

export const realFs: FsLike = fsp;

/** Controllable epoch-ms clock. */
export function manualClock(startIso = "2026-01-01T00:00:00.000Z") {
  let t = Date.parse(startIso);
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
