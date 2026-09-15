/**
 * Privacy scrubbing for logs and diagnostics (ENGINEERING_SPEC §13: "scrub
 * paths"). Removes the home directory, the OS user name and any absolute file
 * path (POSIX, Windows drive, UNC, file:// URLs). A path's extension is kept
 * (`<path>.mp4`) because it helps debugging and says nothing about the user.
 *
 * The current user's home dir is replaced first (even when it contains spaces).
 * Limitation: any other unquoted path containing spaces is only scrubbed up to
 * the first space, so trailing segments of it may remain.
 */

export interface ScrubberEnv {
  /** e.g. `/Users/michi` or `C:\Users\michi`. */
  homeDir?: string | undefined;
  userName?: string | undefined;
}

export type Scrubber = (text: string) => string;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATH_TOKEN = `[^\\s"'\`<>|]`;
/** Keep the extension, any `:line:col` suffix (stack traces) and a closing paren. */
const withExt = (raw: string): string => {
  // Sentence punctuation after a path is not part of it.
  const trail = /[.,;:!?]+$/.exec(raw)?.[0] ?? "";
  const path = trail ? raw.slice(0, -trail.length) : raw;
  return `${pathToken(path)}${trail}`;
};

const pathToken = (path: string): string => {
  const m = /\.([A-Za-z0-9]{1,8})((?::\d+){0,2})(\)?)$/.exec(path);
  if (m) return `<path>.${m[1]}${m[2] ?? ""}${m[3] ?? ""}`;
  return path.endsWith(")") ? "<path>)" : "<path>";
};

const FILE_URL = /file:\/\/[^\s"'`<>]+/gi;
const WIN_PATH = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[\\\\/]${PATH_TOKEN}*`, "g");
const UNC_PATH = new RegExp(`\\\\\\\\${PATH_TOKEN}+`, "g");
/** Home-relative Windows path left by the home pass: `~\Videos\a.mp4`. */
const TILDE_WIN_PATH = new RegExp(`(?<![\\w~])~\\\\${PATH_TOKEN}+`, "g");
/** Two or more segments, not preceded by a scheme/host char (so URLs survive). */
const POSIX_PATH = new RegExp(
  `(?<![\\w:/.~<>-])(?:~|/${PATH_TOKEN.replace("]", "/]")}+)(?:/${PATH_TOKEN.replace("]", "/]")}+)+/?`,
  "g",
);
/** Profile dirs of any user: /Users/<name>, /home/<name>, C:\Users\<name>. */
const PROFILE_DIR = /(\/Users\/|\/home\/|[A-Za-z]:\\Users\\|[A-Za-z]:\/Users\/)([^\\/\s"'`<>]+)/gi;

export function createScrubber(env: ScrubberEnv = {}): Scrubber {
  const home = env.homeDir?.replace(/[\\/]+$/, "");
  const homeVariants =
    home && home.length > 1
      ? [...new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")])]
      : [];
  const homeRe =
    homeVariants.length > 0
      ? new RegExp(
          homeVariants
            .map(escapeRegExp)
            .sort((a, b) => b.length - a.length)
            .join("|"),
          "gi",
        )
      : null;
  // Only a whole home dir: `/Users/michi` must not eat the prefix of `/Users/michigan`.
  const homeReBounded = homeRe ? new RegExp(`(?:${homeRe.source})(?![A-Za-z0-9_-])`, "gi") : null;
  const user = env.userName?.trim();
  const userRe =
    user && user.length >= 2
      ? new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(user)}(?![A-Za-z0-9])`, "gi")
      : null;

  return (text: string): string => {
    let out = String(text);
    // The home dir first: it may contain spaces ("C:\Users\John Smith") that stop
    // the generic path tokens, which would otherwise leave part of it behind.
    if (homeReBounded) out = out.replace(homeReBounded, "~");
    // Whole paths (including the `~/…` / `~\…` the home pass produced)…
    out = out.replace(FILE_URL, (m) => withExt(m));
    out = out.replace(UNC_PATH, (m) => withExt(m));
    out = out.replace(WIN_PATH, (m) => withExt(m));
    out = out.replace(TILDE_WIN_PATH, (m) => withExt(m));
    out = out.replace(POSIX_PATH, (m) => withExt(m.replace(/\/$/, "")));
    // …then whatever identity remains (profile dirs of other users, user name).
    out = out.replace(PROFILE_DIR, "$1<user>");
    if (userRe) out = out.replace(userRe, "<user>");
    return out;
  };
}

/** Deep-scrub every string in a JSON-like value (object keys are kept). */
export function scrubValue(value: unknown, scrub: Scrubber, depth = 0): unknown {
  if (depth > 20) return "[depth]";
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, scrub, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        scrubValue(v, scrub, depth + 1),
      ]),
    );
  }
  return value;
}
