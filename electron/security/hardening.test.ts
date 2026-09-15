import {
  type HardeningEvent,
  type HardeningSession,
  type HardeningWebContents,
  installWebContentsHardening,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isAllowedOrigin,
} from "./hardening";

const DEV = ["http://localhost:5173"];
const PROD = ["file:///Applications/Reelform.app/Contents/Resources/app/dist/index.html"];

describe("isAllowedNavigation", () => {
  it("allows the dev server origin only", () => {
    expect(isAllowedNavigation("http://localhost:5173/#/editor/abc", DEV)).toBe(true);
    expect(isAllowedNavigation("http://localhost:5174/", DEV)).toBe(false);
    expect(isAllowedNavigation("https://localhost:5173/", DEV)).toBe(false);
    expect(isAllowedNavigation("https://evil.example/", DEV)).toBe(false);
  });

  it("allows the packaged index.html (any hash/query) and nothing else on disk", () => {
    const base = PROD[0] ?? "";
    expect(isAllowedNavigation(`${base}#/launcher`, PROD)).toBe(true);
    expect(isAllowedNavigation(`${base}?window=hud`, PROD)).toBe(true);
    expect(isAllowedNavigation("file:///etc/passwd", PROD)).toBe(false);
    expect(isAllowedNavigation("http://localhost:5173/", PROD)).toBe(false);
  });

  it("rejects garbage and opaque schemes", () => {
    expect(isAllowedNavigation("not a url", [...DEV, ...PROD])).toBe(false);
    expect(isAllowedNavigation("javascript:alert(1)", DEV)).toBe(false);
    expect(isAllowedNavigation("data:text/html,hi", ["data:text/html,hi"])).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("matches http origins exactly and file origins when the app is file-loaded", () => {
    expect(isAllowedOrigin("http://localhost:5173", DEV)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173/page", DEV)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", DEV)).toBe(false);
    expect(isAllowedOrigin("file:///", PROD)).toBe(true);
    expect(isAllowedOrigin("file:///", DEV)).toBe(false);
    expect(isAllowedOrigin("", PROD)).toBe(false);
  });
});

describe("isAllowedExternalUrl", () => {
  it("allows https, http and mailto only", () => {
    expect(isAllowedExternalUrl("https://reelform.app/docs")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:support@example.com")).toBe(true);
    for (const bad of [
      "file:///etc/passwd",
      "smb://host/share",
      "javascript:alert(1)",
      "reelform://open?path=/a.reelform",
      "ms-settings:privacy",
      "vscode://file/x",
      "https://user:pw@example.com",
      "nope",
    ]) {
      expect(isAllowedExternalUrl(bad)).toBe(false);
    }
  });
});

class FakeContents implements HardeningWebContents {
  listeners = new Map<string, (e: HardeningEvent, url: string) => void>();
  openHandler: ((d: { url: string }) => { action: "deny" }) | null = null;
  url = "http://localhost:5173/";
  on(event: string, listener: (e: HardeningEvent, url: string) => void) {
    this.listeners.set(event, listener);
    return this;
  }
  setWindowOpenHandler(h: (d: { url: string }) => { action: "deny" }) {
    this.openHandler = h;
  }
  getURL() {
    return this.url;
  }
  fire(event: string, url = "") {
    const e = { preventDefault: vi.fn() };
    this.listeners.get(event)?.(e, url);
    return e.preventDefault;
  }
}

type RequestHandler = Parameters<HardeningSession["setPermissionRequestHandler"]>[0];
type CheckHandler = Parameters<HardeningSession["setPermissionCheckHandler"]>[0];

function install(allowed = DEV) {
  const captured: {
    created?: (e: unknown, c: HardeningWebContents) => void;
    request?: RequestHandler;
    check?: CheckHandler;
  } = {};
  const shell = { openExternal: vi.fn(async () => undefined) };
  installWebContentsHardening({
    app: {
      on: (_event, listener) => {
        captured.created = listener;
      },
    },
    session: {
      setPermissionRequestHandler: (h) => {
        captured.request = h;
      },
      setPermissionCheckHandler: (h) => {
        captured.check = h;
      },
    },
    shell,
    allowedOrigins: allowed,
  });
  const { created, request, check } = captured;
  if (!created || !request || !check) throw new Error("hardening did not install handlers");
  const contents = new FakeContents();
  created({}, contents);
  return { contents, shell, request, check };
}

describe("installWebContentsHardening", () => {
  it("blocks navigation/redirects off-app and sends web links to the browser", () => {
    const { contents, shell } = install();
    expect(
      contents.fire("will-navigate", "http://localhost:5173/#/settings"),
    ).not.toHaveBeenCalled();
    expect(contents.fire("will-navigate", "https://example.com/")).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/");
    expect(contents.fire("will-redirect", "file:///etc/passwd")).toHaveBeenCalled();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it("denies window.open, forwarding only http(s)", () => {
    const { contents, shell } = install();
    expect(contents.openHandler?.({ url: "https://example.com" })).toEqual({ action: "deny" });
    expect(contents.openHandler?.({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it("blocks webviews", () => {
    const { contents } = install();
    expect(contents.fire("will-attach-webview")).toHaveBeenCalled();
  });

  it("grants only capture/clipboard permissions to the app origin", () => {
    const { contents, request, check } = install();
    const cb = vi.fn();
    request(contents, "media", cb, { requestingUrl: "http://localhost:5173/" });
    request(contents, "display-capture", cb, {});
    request(contents, "geolocation", cb, { requestingUrl: "http://localhost:5173/" });
    request(contents, "media", cb, { requestingUrl: "https://evil.example/" });
    expect(cb.mock.calls.map((c) => c[0])).toEqual([true, true, false, false]);
    expect(check(contents, "clipboard-sanitized-write", "http://localhost:5173")).toBe(true);
    expect(check(null, "notifications", "http://localhost:5173")).toBe(false);
    expect(check(null, "media", "https://evil.example")).toBe(false);
  });
});
