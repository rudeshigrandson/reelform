/**
 * WebContents hardening (ENGINEERING_SPEC §13: renderer sandboxed, only the
 * app's own pages load). Every webContents the app creates may only navigate
 * inside the app (dev server origin or the packaged `dist/index.html`), never
 * opens child windows or `<webview>`s, and gets only the permissions capture
 * needs. External links go through the OS browser, and only for
 * http/https/mailto.
 */

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/** Permissions the renderer may use: mic/camera, screen capture, clipboard write. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "media",
  "display-capture",
  "clipboard-sanitized-write",
]);

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/**
 * `allowed` entries are origins (`http://localhost:5173`) or `file://` URLs of
 * an app page. An http(s) URL matches an origin entry exactly; a file URL
 * matches a file entry with the same path (query/hash ignored).
 */
export function isAllowedNavigation(url: string, allowed: readonly string[]): boolean {
  const target = parse(url);
  if (!target) return false;
  for (const entry of allowed) {
    const a = parse(entry);
    if (!a) continue;
    if (a.protocol === "file:") {
      if (target.protocol === "file:" && target.pathname === a.pathname && target.host === a.host) {
        return true;
      }
    } else if (a.origin !== "null" && target.origin === a.origin) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a requesting origin (or URL) belongs to the app. File pages report
 * `file://` origins, so any file origin is accepted when a file entry exists.
 */
export function isAllowedOrigin(originOrUrl: string, allowed: readonly string[]): boolean {
  const target = parse(originOrUrl);
  if (!target) return false;
  for (const entry of allowed) {
    const a = parse(entry);
    if (!a) continue;
    if (a.protocol === "file:") {
      if (target.protocol === "file:") return true;
    } else if (a.origin !== "null" && target.origin === a.origin) {
      return true;
    }
  }
  return false;
}

/** Only http(s) with a host, or mailto, may be handed to the OS. */
export function isAllowedExternalUrl(url: string): boolean {
  const u = parse(url);
  if (!u || !EXTERNAL_PROTOCOLS.has(u.protocol)) return false;
  if (u.protocol === "mailto:") return true;
  return u.hostname.length > 0 && u.username === "" && u.password === "";
}

// ---- structural Electron subsets (inject fakes in tests) -------------------

export interface HardeningEvent {
  preventDefault(): void;
}

export interface HardeningWebContents {
  on(
    event: "will-navigate" | "will-redirect",
    listener: (e: HardeningEvent, url: string) => void,
  ): unknown;
  on(event: "will-attach-webview", listener: (e: HardeningEvent) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  getURL(): string;
}

export interface HardeningApp {
  on(
    event: "web-contents-created",
    listener: (e: unknown, contents: HardeningWebContents) => void,
  ): unknown;
}

export interface HardeningSession {
  setPermissionRequestHandler(
    handler: (
      contents: HardeningWebContents,
      permission: string,
      callback: (granted: boolean) => void,
      details: { requestingUrl?: string | undefined },
    ) => void,
  ): void;
  setPermissionCheckHandler(
    handler: (
      contents: HardeningWebContents | null,
      permission: string,
      requestingOrigin: string,
    ) => boolean,
  ): void;
}

export interface HardeningShell {
  openExternal(url: string): Promise<void>;
}

export interface WebContentsHardeningOptions {
  app: HardeningApp;
  session: HardeningSession;
  shell: HardeningShell;
  /** Origins / file URLs of the app's own pages (see {@link isAllowedNavigation}). */
  allowedOrigins: readonly string[];
  log?: ((message: string) => void) | undefined;
}

export function installWebContentsHardening(opts: WebContentsHardeningOptions): void {
  const { allowedOrigins: allowed, shell } = opts;
  const log = opts.log ?? (() => undefined);

  const openOutside = (url: string): void => {
    if (!isAllowedExternalUrl(url)) {
      log(`blocked external url with scheme ${parse(url)?.protocol ?? "invalid"}`);
      return;
    }
    shell.openExternal(url).catch((e: unknown) => {
      log(`openExternal failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  opts.app.on("web-contents-created", (_e, contents) => {
    const guard = (e: HardeningEvent, url: string): void => {
      if (isAllowedNavigation(url, allowed)) return;
      e.preventDefault();
      log("blocked navigation outside the app");
      // A link click to the web belongs in the browser, not in an app window.
      const u = parse(url);
      if (u && (u.protocol === "https:" || u.protocol === "http:")) openOutside(url);
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    contents.on("will-attach-webview", (e) => {
      e.preventDefault();
      log("blocked <webview>");
    });
    contents.setWindowOpenHandler(({ url }) => {
      const u = parse(url);
      if (u && (u.protocol === "https:" || u.protocol === "http:")) openOutside(url);
      return { action: "deny" };
    });
  });

  opts.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const from = details.requestingUrl ?? contents.getURL();
    callback(ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(from, allowed));
  });
  opts.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAllowedOrigin(requestingOrigin, allowed);
  });
}
