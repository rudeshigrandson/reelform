import fc from "fast-check";
import {
  PermissionsSnapshotSchema,
  createPermissionsHandlers,
  permissionsContracts,
} from "./contracts";
import {
  type MediaAccessStatus,
  PERMISSION_KINDS,
  type PermissionPlatform,
  type PermissionsSystem,
  mapMediaStatus,
  readPermissions,
  requestPermission,
} from "./permissionModel";
import { startPermissionPolling } from "./polling";
import { settingsDeepLink } from "./settingsLinks";

function fakeSystem(
  over: Partial<PermissionsSystem> = {},
  media: Partial<Record<"microphone" | "camera" | "screen", MediaAccessStatus>> = {},
) {
  const state = {
    microphone: "not-determined",
    camera: "not-determined",
    screen: "denied",
    ...media,
  } as Record<"microphone" | "camera" | "screen", MediaAccessStatus>;
  let trusted = false;
  const sys: PermissionsSystem & { state: typeof state } = {
    state,
    platform: "darwin",
    getMediaAccessStatus: (m) => state[m],
    isTrustedAccessibilityClient: vi.fn((prompt: boolean) => {
      if (prompt) trusted = true;
      return trusted && !prompt ? true : trusted && prompt;
    }),
    askForMediaAccess: vi.fn(async (m: "microphone" | "camera") => {
      state[m] = "granted";
      return true;
    }),
    ...over,
  };
  return sys;
}

describe("status mapping", () => {
  it("maps raw media statuses, unknown → not-determined", () => {
    expect(mapMediaStatus("granted")).toBe("granted");
    expect(mapMediaStatus("denied")).toBe("denied");
    expect(mapMediaStatus("restricted")).toBe("restricted");
    expect(mapMediaStatus("unknown")).toBe("not-determined");
    expect(mapMediaStatus("not-determined")).toBe("not-determined");
  });

  it("macOS reports all five kinds; screen is required", () => {
    const snap = readPermissions(fakeSystem({}, { microphone: "granted", camera: "denied" }));
    expect(snap.permissions.microphone.status).toBe("granted");
    expect(snap.permissions.camera).toMatchObject({
      status: "denied",
      canRequest: false,
      canOpenSettings: true,
    });
    expect(snap.permissions.screen).toMatchObject({ status: "denied", required: true });
    expect(snap.permissions.accessibility).toMatchObject({
      status: "not-determined",
      canRequest: true,
    });
    expect(snap.permissions.notifications.status).toBe("not-determined");
    expect(PermissionsSnapshotSchema.parse(snap)).toEqual(snap);
  });

  it("screen: preflight wins; fallback never reports granted when preflight says no", () => {
    expect(
      readPermissions(fakeSystem({ preflightScreenCapture: () => true })).permissions.screen.status,
    ).toBe("granted");
    expect(
      readPermissions(fakeSystem({ preflightScreenCapture: () => false }, { screen: "granted" }))
        .permissions.screen.status,
    ).toBe("denied");
    expect(readPermissions(fakeSystem({}, { screen: "granted" })).permissions.screen.status).toBe(
      "granted",
    );
  });

  it("Windows: only mic/camera applicable, nothing required, settings links for mic/camera", () => {
    const snap = readPermissions(
      fakeSystem({ platform: "win32" }, { microphone: "denied", camera: "granted" }),
    );
    expect(snap.permissions.screen.status).toBe("not-applicable");
    expect(snap.permissions.accessibility.status).toBe("not-applicable");
    expect(snap.permissions.notifications.status).toBe("not-applicable");
    expect(snap.permissions.microphone).toMatchObject({
      status: "denied",
      canRequest: false,
      canOpenSettings: true,
    });
    expect(snap.permissions.camera.status).toBe("granted");
    expect(Object.values(snap.permissions).some((e) => e.required)).toBe(false);
  });

  it("Linux: everything not-applicable", () => {
    const snap = readPermissions(fakeSystem({ platform: "linux" }));
    for (const k of PERMISSION_KINDS) {
      expect(snap.permissions[k]).toMatchObject({
        status: "not-applicable",
        canRequest: false,
        canOpenSettings: false,
      });
    }
  });

  it("property: granted/not-applicable are never requestable; schema always accepts", () => {
    const st = fc.constantFrom<MediaAccessStatus>(
      "not-determined",
      "granted",
      "denied",
      "restricted",
      "unknown",
    );
    fc.assert(
      fc.property(
        fc.constantFrom<PermissionPlatform>("darwin", "win32", "linux"),
        st,
        st,
        st,
        fc.boolean(),
        (platform, microphone, camera, screen, trusted) => {
          const snap = readPermissions(
            fakeSystem(
              { platform, isTrustedAccessibilityClient: () => trusted },
              { microphone, camera, screen },
            ),
          );
          PermissionsSnapshotSchema.parse(snap);
          for (const e of Object.values(snap.permissions)) {
            if (e.status === "granted" || e.status === "not-applicable")
              expect(e.canRequest).toBe(false);
          }
        },
      ),
    );
  });
});

describe("requestPermission", () => {
  it("prompts for undetermined mic on macOS and returns the new status", async () => {
    const sys = fakeSystem();
    expect(await requestPermission(sys, "microphone")).toEqual({
      status: "granted",
      outcome: "prompted",
    });
    expect(sys.askForMediaAccess).toHaveBeenCalledWith("microphone");
  });

  it("denied mic → open-settings without prompting", async () => {
    const sys = fakeSystem({}, { microphone: "denied" });
    expect(await requestPermission(sys, "microphone")).toEqual({
      status: "denied",
      outcome: "open-settings",
    });
    expect(sys.askForMediaAccess).not.toHaveBeenCalled();
  });

  it("screen uses requestScreenCapture when undetermined, else Settings", async () => {
    let granted = false;
    const req = vi.fn(() => {
      granted = true;
      return true;
    });
    const sys = fakeSystem(
      { preflightScreenCapture: () => granted, requestScreenCapture: req },
      { screen: "not-determined" },
    );
    expect(await requestPermission(sys, "screen")).toEqual({
      status: "granted",
      outcome: "prompted",
    });
    expect(await requestPermission(fakeSystem(), "screen")).toEqual({
      status: "denied",
      outcome: "open-settings",
    });
  });

  it("accessibility prompts via isTrustedAccessibilityClient(true)", async () => {
    const sys = fakeSystem();
    await requestPermission(sys, "accessibility");
    expect(sys.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
  });

  it("granted and not-applicable are no-ops", async () => {
    const sys = fakeSystem({}, { camera: "granted" });
    expect(await requestPermission(sys, "camera")).toEqual({ status: "granted", outcome: "none" });
    expect(await requestPermission(fakeSystem({ platform: "linux" }), "screen")).toEqual({
      status: "not-applicable",
      outcome: "none",
    });
  });
});

describe("settings deep links", () => {
  it("per pane per OS", () => {
    expect(settingsDeepLink("darwin", "screen")).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
    expect(settingsDeepLink("darwin", "accessibility")).toContain("Privacy_Accessibility");
    expect(settingsDeepLink("win32", "camera")).toBe("ms-settings:privacy-webcam");
    expect(settingsDeepLink("win32", "microphone")).toBe("ms-settings:privacy-microphone");
    expect(settingsDeepLink("win32", "screen")).toBeNull();
    expect(settingsDeepLink("linux", "microphone")).toBeNull();
  });
});

describe("permissions handlers", () => {
  it("status returns a schema-valid snapshot", async () => {
    const h = createPermissionsHandlers({ system: fakeSystem(), openExternal: vi.fn() });
    const res = await h["permissions:status"]();
    expect(permissionsContracts["permissions:status"].response.parse(res)).toEqual(res);
  });

  it("request opens the settings pane when it cannot prompt", async () => {
    const openExternal = vi.fn(async () => {});
    const h = createPermissionsHandlers({
      system: fakeSystem({}, { camera: "denied" }),
      openExternal,
    });
    expect(await h["permissions:request"]({ kind: "camera" })).toEqual({
      kind: "camera",
      status: "denied",
      outcome: "open-settings",
    });
    expect(openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
    );
  });

  it("openSettings: ok false when no pane or openExternal fails", async () => {
    const failing = createPermissionsHandlers({
      system: fakeSystem(),
      openExternal: async () => {
        throw new Error("nope");
      },
    });
    expect(await failing["permissions:openSettings"]({ kind: "screen" })).toEqual({ ok: false });
    const linux = createPermissionsHandlers({
      system: fakeSystem({ platform: "linux" }),
      openExternal: vi.fn(),
    });
    expect(await linux["permissions:openSettings"]({ kind: "screen" })).toEqual({ ok: false });
  });

  it("request schema rejects unknown kinds", () => {
    expect(
      permissionsContracts["permissions:request"].request.safeParse({ kind: "bluetooth" }).success,
    ).toBe(false);
  });
});

describe("startPermissionPolling", () => {
  function manualTimer() {
    let fn: (() => void) | null = null;
    return {
      timer: {
        setInterval: vi.fn((f: () => void, _ms: number) => {
          fn = f;
          return 42;
        }),
        clearInterval: vi.fn(),
      },
      tick: () => fn?.(),
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("emits first snapshot, then only on change, every 2s", async () => {
    const sys = fakeSystem();
    const { timer, tick } = manualTimer();
    const onChange = vi.fn();
    const stop = startPermissionPolling({ read: () => readPermissions(sys), onChange, timer });
    await flush();
    expect(timer.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(onChange).toHaveBeenCalledTimes(1);
    tick();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    sys.state.microphone = "granted";
    tick();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.lastCall?.[0].permissions.microphone.status).toBe("granted");
    stop();
    stop();
    expect(timer.clearInterval).toHaveBeenCalledTimes(1);
    expect(timer.clearInterval).toHaveBeenCalledWith(42);
  });

  it("does not overlap reads, survives read errors, and emits nothing after stop", async () => {
    const { timer, tick } = manualTimer();
    const onChange = vi.fn();
    let resolve: (() => void) | null = null;
    let calls = 0;
    const sys = fakeSystem();
    const read = vi.fn(() => {
      calls++;
      if (calls === 1) {
        return new Promise<ReturnType<typeof readPermissions>>((r) => {
          resolve = () => r(readPermissions(sys));
        });
      }
      if (calls === 2) throw new Error("transient");
      return readPermissions(sys);
    });
    const stop = startPermissionPolling({ read, onChange, timer, intervalMs: 10 });
    tick(); // skipped: first read in flight
    expect(read).toHaveBeenCalledTimes(1);
    (resolve as (() => void) | null)?.();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    tick(); // throws
    await flush();
    tick(); // same snapshot
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    sys.state.camera = "granted";
    stop();
    tick();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
