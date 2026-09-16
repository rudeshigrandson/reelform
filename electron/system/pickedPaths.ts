import * as path from "node:path";

/**
 * Session-lifetime set of file paths the user chose in a native open/save
 * dialog (§13). `system:readTextFile` / `system:writeTextFile` may touch these
 * even outside a project folder, because the user explicitly picked them.
 */
export interface PickedPathRegistry {
  add(p: string): void;
  has(p: string): boolean;
}

/** Windows and macOS file systems are case-insensitive by default. */
function keyFor(p: string, platform: string): string {
  const api = platform === "win32" ? path.win32 : path.posix;
  const normalized = api.normalize(p);
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized;
}

export function createPickedPathRegistry(platform: string = process.platform): PickedPathRegistry {
  const picked = new Set<string>();
  return {
    add: (p) => {
      if (p.length > 0 && !p.includes("\0")) picked.add(keyFor(p, platform));
    },
    has: (p) => picked.has(keyFor(p, platform)),
  };
}
