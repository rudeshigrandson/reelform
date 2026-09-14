/**
 * Accelerator parsing / formatting (ENGINEERING_SPEC §6.9, design guide S24).
 *
 * One platform-neutral in-memory shape ({@link Accelerator}) and three string
 * forms:
 * - display, per platform: mac glyphs "⇧⌘R", win "Ctrl+Shift+R";
 * - canonical storage ("Ctrl+Alt+Shift+Meta+Key") used for settings overrides;
 * - Electron `globalShortcut` accelerators ("Command+Shift+R").
 *
 * Pure; no DOM or Electron imports so main and renderer share it.
 */

export type ShortcutPlatform = "mac" | "win";

export interface Accelerator {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** ⌘ on mac, the Windows/Super key elsewhere. */
  meta: boolean;
  /** Canonical key name — see {@link normalizeKey}. */
  key: string;
}

/** Node `process.platform` → shortcut platform (Linux uses the Ctrl style). */
export function shortcutPlatformFor(nodePlatform: string): ShortcutPlatform {
  return nodePlatform === "darwin" ? "mac" : "win";
}

const NAMED_KEYS = [
  "Space",
  "Enter",
  "Escape",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Plus",
] as const;

/** Punctuation keys kept as their literal character. */
export const PUNCTUATION_KEYS = ["-", "=", "[", "]", ";", "'", ",", ".", "/", "\\", "`"] as const;

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: "Escape",
  return: "Enter",
  del: "Delete",
  ins: "Insert",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  pgup: "PageUp",
  pgdn: "PageDown",
  spacebar: "Space",
  minus: "-",
  equal: "=",
  " ": "Space",
  "+": "Plus",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "⌫": "Backspace",
  "⌦": "Delete",
  "↩": "Enter",
  "⏎": "Enter",
  "⎋": "Escape",
  "⇥": "Tab",
  "↖": "Home",
  "↘": "End",
  "⇞": "PageUp",
  "⇟": "PageDown",
  "␣": "Space",
};

const NAMED_BY_LOWER: Readonly<Record<string, string>> = Object.fromEntries(
  NAMED_KEYS.map((k) => [k.toLowerCase(), k]),
);

/** Every canonical key name that is not a letter/digit/F-key (for tests & pickers). */
export const NAMED_KEY_NAMES: readonly string[] = [...NAMED_KEYS, ...PUNCTUATION_KEYS];

/** Normalize a key token to its canonical name, or null when unknown. */
export function normalizeKey(token: string): string | null {
  if (token.length === 0) return null;
  const alias = KEY_ALIASES[token] ?? KEY_ALIASES[token.toLowerCase()];
  if (alias) return alias;
  if (token.length === 1) {
    if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase();
    if ((PUNCTUATION_KEYS as readonly string[]).includes(token)) return token;
    return null;
  }
  const named = NAMED_BY_LOWER[token.toLowerCase()];
  if (named) return named;
  const f = /^f([1-9]|1\d|2[0-4])$/i.exec(token);
  if (f) return `F${f[1]}`;
  return null;
}

type Mod = "ctrl" | "alt" | "shift" | "meta" | "cmdOrCtrl";

const MOD_GLYPHS: Readonly<Record<string, Mod>> = {
  "⌃": "ctrl",
  "⌥": "alt",
  "⇧": "shift",
  "⌘": "meta",
};

const MOD_NAMES: Readonly<Record<string, Mod>> = {
  ...MOD_GLYPHS,
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  super: "meta",
  win: "meta",
  commandorcontrol: "cmdOrCtrl",
  cmdorctrl: "cmdOrCtrl",
  mod: "cmdOrCtrl",
};

const applyMod = (acc: Accelerator, mod: Mod, platform: ShortcutPlatform): void => {
  if (mod === "cmdOrCtrl") {
    if (platform === "mac") acc.meta = true;
    else acc.ctrl = true;
    return;
  }
  acc[mod] = true;
};

/**
 * Parse any supported accelerator string: mac glyphs ("⇧⌘R"), "+"-joined names
 * ("Ctrl+Shift+R", "Shift+Meta+[" ), Electron style ("CommandOrControl+Plus").
 * `CommandOrControl` resolves per `platform`. Returns null for empty, unknown
 * modifiers, unknown keys, or a modifier-only string.
 */
export function parseAccelerator(input: string, platform: ShortcutPlatform): Accelerator | null {
  let s = input.trim();
  if (!s) return null;
  const acc: Accelerator = { ctrl: false, alt: false, shift: false, meta: false, key: "" };

  let i = 0;
  while (i < s.length) {
    const mod = MOD_GLYPHS[s.charAt(i)];
    if (!mod) break;
    applyMod(acc, mod, platform);
    i++;
  }
  s = s.slice(i).trim();
  if (!s) return null;

  let keyToken: string;
  let modTokens: string[];
  if (s === "+") {
    keyToken = "+";
    modTokens = [];
  } else if (s.endsWith("++")) {
    keyToken = "+";
    modTokens = s.slice(0, -2).split("+");
  } else {
    const parts = s.split("+");
    keyToken = parts.pop() ?? "";
    modTokens = parts;
  }

  for (const raw of modTokens) {
    const token = raw.trim();
    const mod = MOD_NAMES[token] ?? MOD_NAMES[token.toLowerCase()];
    if (!mod) return null;
    applyMod(acc, mod, platform);
  }
  const key = normalizeKey(keyToken.trim() || keyToken);
  if (!key) return null;
  acc.key = key;
  return acc;
}

const MAC_KEY_DISPLAY: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Backspace: "⌫",
  Delete: "⌦",
  Enter: "↩",
  Escape: "⎋",
  Tab: "⇥",
  Home: "↖",
  End: "↘",
  PageUp: "⇞",
  PageDown: "⇟",
  Plus: "+",
};

const WIN_KEY_DISPLAY: Readonly<Record<string, string>> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Escape: "Esc",
  Delete: "Del",
  Insert: "Ins",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** Human display: mac "⌃⌥⇧⌘K" (Apple order), win "Ctrl+Alt+Shift+Win+K". */
export function formatAccelerator(acc: Accelerator, platform: ShortcutPlatform): string {
  if (platform === "mac") {
    const mods = `${acc.ctrl ? "⌃" : ""}${acc.alt ? "⌥" : ""}${acc.shift ? "⇧" : ""}${acc.meta ? "⌘" : ""}`;
    return `${mods}${MAC_KEY_DISPLAY[acc.key] ?? acc.key}`;
  }
  const parts: string[] = [];
  if (acc.ctrl) parts.push("Ctrl");
  if (acc.alt) parts.push("Alt");
  if (acc.shift) parts.push("Shift");
  if (acc.meta) parts.push("Win");
  parts.push(WIN_KEY_DISPLAY[acc.key] ?? acc.key);
  return parts.join("+");
}

/** Platform-neutral storage form ("Ctrl+Shift+Meta+R"); parses identically on every platform. */
export function serializeAccelerator(acc: Accelerator): string {
  const parts: string[] = [];
  if (acc.ctrl) parts.push("Ctrl");
  if (acc.alt) parts.push("Alt");
  if (acc.shift) parts.push("Shift");
  if (acc.meta) parts.push("Meta");
  parts.push(acc.key);
  return parts.join("+");
}

const ELECTRON_KEYS: Readonly<Record<string, string>> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
};

/** Electron `globalShortcut` accelerator for this platform. */
export function toElectronAccelerator(acc: Accelerator, platform: ShortcutPlatform): string {
  const parts: string[] = [];
  if (acc.meta) parts.push(platform === "mac" ? "Command" : "Super");
  if (acc.ctrl) parts.push("Control");
  if (acc.alt) parts.push("Alt");
  if (acc.shift) parts.push("Shift");
  parts.push(ELECTRON_KEYS[acc.key] ?? acc.key);
  return parts.join("+");
}

export function acceleratorsEqual(a: Accelerator, b: Accelerator): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta
  );
}

const MODIFIER_ONLY_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Super",
  "Hyper",
  "Fn",
  "FnLock",
  "CapsLock",
  "Unidentified",
  "Process",
]);

const CODE_KEYS: Readonly<Record<string, string>> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
  NumpadAdd: "Plus",
  Space: "Space",
};

export type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * Accelerator for a keydown. Uses `key` when it is a plain letter/digit/named
 * key (layout-aware), otherwise the physical `code` so shift/alt-altered
 * characters ("{", "å", "?") and dead keys (mac ⌥E → "Dead") still map to their
 * base key. Modifier-only presses return null.
 */
export function acceleratorFromEvent(e: KeyEventLike): Accelerator | null {
  if (MODIFIER_ONLY_KEYS.has(e.key)) return null;
  let key: string | null = null;
  if (/^[a-z0-9]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (e.key.length > 1 || e.key === " ") key = normalizeKey(e.key);
  if (!key) {
    const code = e.code ?? "";
    const letter = /^Key([A-Z])$/.exec(code) ?? /^Digit([0-9])$/.exec(code);
    key = letter?.[1] ?? CODE_KEYS[code] ?? normalizeKey(e.key);
  }
  if (!key) return null;
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key };
}
