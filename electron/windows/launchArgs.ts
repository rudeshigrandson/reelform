import path from "node:path";

/**
 * Pure parsing of what the OS hands a launch: `.reelform` file associations
 * (argv on Windows/Linux, `open-file` on macOS) and `reelform://open?path=`
 * deep links (argv on Windows/Linux, `open-url` on macOS). Used both for the
 * first launch and for args forwarded by the single-instance lock.
 */

export const DEEP_LINK_SCHEME = "reelform";
export const PROJECT_EXTENSION = ".reelform";

export type LaunchIntent = { type: "open-project"; path: string };

export type PlatformName = "darwin" | "win32" | "linux";

function pathApi(platform: PlatformName): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** `.reelform` (a package directory on macOS, so tolerate a trailing separator). */
export function isProjectPath(p: string): boolean {
  return p
    .replace(/[\\/]+$/, "")
    .toLowerCase()
    .endsWith(PROJECT_EXTENSION);
}

const hasControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

/**
 * Parse `reelform://open?path=<absolute .reelform path>`. Anything else
 * (other action, relative path, wrong extension, control chars) → `null`.
 */
export function parseDeepLink(url: string, platform: PlatformName): LaunchIntent | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  // `reelform://open?..` → host "open"; `reelform:open?..` → pathname "open".
  const action = (u.host || u.pathname).replace(/^\/+|\/+$/g, "");
  if (action !== "open") return null;
  const raw = u.searchParams.get("path");
  if (!raw || hasControlChars(raw)) return null;
  // A link can come from any web page: on Windows refuse UNC / device paths
  // (`\\server\share`, `\\?\`, `//server`) so opening one cannot make the OS
  // reach out to a remote SMB host (credential leak).
  if (platform === "win32" && /^[\\/]{2}/.test(raw)) return null;
  const api = pathApi(platform);
  if (!api.isAbsolute(raw) || !isProjectPath(raw)) return null;
  return { type: "open-project", path: api.normalize(raw) };
}

/**
 * Parse a process argv (as given to `second-instance` or `process.argv`).
 * Skips the executable (and the app entry in dev), flags, and non-project
 * args; relative file paths resolve against `cwd`. Order is preserved and
 * duplicates are dropped.
 */
export function parseLaunchArgs(
  argv: readonly string[],
  opts: { cwd: string; platform: PlatformName },
): LaunchIntent[] {
  const api = pathApi(opts.platform);
  const seen = new Set<string>();
  const out: LaunchIntent[] = [];
  for (const [i, arg] of argv.entries()) {
    if (i === 0 || !arg || arg.startsWith("-") || hasControlChars(arg)) continue;
    let intent: LaunchIntent | null = null;
    if (arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) {
      intent = parseDeepLink(arg, opts.platform);
    } else if (isProjectPath(arg)) {
      intent = { type: "open-project", path: api.resolve(opts.cwd, arg) };
    }
    if (intent && !seen.has(intent.path)) {
      seen.add(intent.path);
      out.push(intent);
    }
  }
  return out;
}

export interface LaunchIntentHandlers {
  openProjectFile(path: string): void | Promise<void>;
  /** Nothing to open: bring the app forward (focus launcher). */
  focusApp(): void;
}

/** Dispatch parsed intents; no intents → focus the running app. */
export async function dispatchLaunchIntents(
  intents: readonly LaunchIntent[],
  handlers: LaunchIntentHandlers,
): Promise<void> {
  if (intents.length === 0) {
    handlers.focusApp();
    return;
  }
  for (const intent of intents) await handlers.openProjectFile(intent.path);
}
