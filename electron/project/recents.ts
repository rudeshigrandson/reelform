import * as path from "node:path";
import { atomicWriteFile } from "./atomicWrite";
import { errnoCode } from "./errors";
import type { FsLike } from "./fsTypes";

/** Recently opened projects, most recent first. */
export interface RecentsStore {
  list(): Promise<string[]>;
  touch(projectPath: string): Promise<void>;
  remove(projectPath: string): Promise<void>;
}

export const MAX_RECENTS = 20;

/** Pure: move `p` to the front, dedupe, cap. */
export function touchRecents(list: readonly string[], p: string, max = MAX_RECENTS): string[] {
  return [p, ...list.filter((x) => x !== p)].slice(0, Math.max(0, max));
}

/**
 * Recents persisted as a JSON string array (atomic writes). A missing or
 * corrupt file reads as empty rather than blocking the library screen.
 */
export function createJsonRecentsStore(opts: {
  fs: FsLike;
  filePath: string;
  max?: number | undefined;
}): RecentsStore {
  const { fs, filePath } = opts;
  const max = opts.max ?? MAX_RECENTS;
  // Serialize writers so touch/remove races can't drop entries.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const read = async (): Promise<string[]> => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch (e) {
      if (errnoCode(e) === "ENOENT" || e instanceof SyntaxError) return [];
      throw e;
    }
  };
  const write = async (list: string[]): Promise<void> => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await atomicWriteFile(fs, filePath, JSON.stringify(list, null, 2));
  };

  return {
    list: () => serial(read),
    touch: (p) => serial(async () => write(touchRecents(await read(), p, max))),
    remove: (p) => serial(async () => write((await read()).filter((x) => x !== p))),
  };
}
