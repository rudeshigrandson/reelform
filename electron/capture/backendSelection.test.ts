import { describe, expect, it } from "vitest";
import { nativeBackendsFor, selectBackend } from "./backendSelection";
import type { Availability, BackendId, CaptureBackend } from "./types";

const backend = (id: BackendId, a: Availability | Error): CaptureBackend => ({
  id,
  isAvailable: async () => {
    if (a instanceof Error) throw a;
    return a;
  },
  listSources: async () => ({ displays: [], windows: [] }),
  start: async () => {
    throw new Error("unused");
  },
});

const ok = { ok: true };

describe("nativeBackendsFor", () => {
  it("maps platforms to native backends in preference order", () => {
    expect(nativeBackendsFor("darwin")).toEqual(["sck"]);
    expect(nativeBackendsFor("win32")).toEqual(["wgc", "dxgi"]);
    expect(nativeBackendsFor("linux")).toEqual([]);
  });
});

describe("selectBackend", () => {
  it("prefers the native backend for the OS", async () => {
    const r = await selectBackend({
      platform: "darwin",
      backends: [backend("electron", ok), backend("sck", ok)],
    });
    expect(r.backend?.id).toBe("sck");
    expect(r.reasons).toEqual([]);
  });

  it("falls back to electron with the native reason", async () => {
    const r = await selectBackend({
      platform: "darwin",
      backends: [
        backend("sck", { ok: false, reason: "reelform-sck checksum mismatch" }),
        backend("electron", ok),
      ],
    });
    expect(r.backend?.id).toBe("electron");
    expect(r.reasons).toEqual(["sck: reelform-sck checksum mismatch"]);
  });

  it("user override wins over native, even electron on macOS", async () => {
    const r = await selectBackend({
      override: "electron",
      platform: "darwin",
      backends: [backend("sck", ok), backend("electron", ok)],
    });
    expect(r.backend?.id).toBe("electron");
  });

  it("an unavailable override falls through to the normal order", async () => {
    const r = await selectBackend({
      override: "dxgi",
      platform: "win32",
      backends: [
        backend("dxgi", { ok: false, reason: "requires Windows < 19041" }),
        backend("wgc", ok),
        backend("electron", ok),
      ],
    });
    expect(r.backend?.id).toBe("wgc");
    expect(r.reasons).toEqual(["override dxgi: requires Windows < 19041"]);
  });

  it("records thrown availability errors, missing builds and returns null when nothing works", async () => {
    const r = await selectBackend({
      platform: "win32",
      backends: [backend("wgc", new Error("spawn EACCES")), backend("electron", { ok: false })],
    });
    expect(r.backend).toBeNull();
    expect(r.reasons).toEqual([
      "wgc: spawn EACCES",
      "dxgi: not built for this platform",
      "electron: unavailable",
    ]);
  });

  it("linux goes straight to electron", async () => {
    const r = await selectBackend({
      platform: "linux",
      backends: [backend("sck", ok), backend("electron", ok)],
    });
    expect(r.backend?.id).toBe("electron");
  });
});
