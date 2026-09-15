import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUpdaterHandlers, updaterContracts, updaterEvents } from "./contracts";
import {
  type UpdaterState,
  UpdaterStateSchema,
  initialUpdaterState,
  normalizeReleaseNotes,
  reduceUpdater,
  toUpdateInfo,
} from "./state";
import { type AutoUpdaterPort, CHECK_INTERVAL_MS, createUpdater } from "./updater";

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterPort {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = true;
  quitAndInstall = vi.fn();
  /** Next checkForUpdates behaviour. */
  nextCheck: () => Promise<unknown> = async () => {
    this.emit("checking-for-update");
    this.emit("update-not-available", { version: "1.0.0" });
    return { updateInfo: { version: "1.0.0" } };
  };
  checkForUpdates = vi.fn(() => this.nextCheck());
}

class FakeTimers {
  handles = new Map<number, { fn: () => void; ms: number }>();
  private id = 0;
  setInterval = (fn: () => void, ms: number) => {
    this.handles.set(++this.id, { fn, ms });
    return this.id;
  };
  clearInterval = (h: unknown) => {
    this.handles.delete(h as number);
  };
  tick() {
    for (const h of this.handles.values()) h.fn();
  }
}

const info = {
  version: "1.2.0",
  releaseName: "Reelform 1.2",
  releaseDate: "2026-09-01",
  releaseNotes: "<p>New</p>",
};

const setup = (opts: { autoCheck?: boolean; channel?: "stable" | "beta" } = {}) => {
  const au = new FakeAutoUpdater();
  const timers = new FakeTimers();
  let clock = 1_000;
  let autoCheck = opts.autoCheck ?? true;
  const onChange = vi.fn<(s: UpdaterState) => void>();
  const updater = createUpdater({
    autoUpdater: au,
    timers,
    now: () => clock,
    currentVersion: "1.0.0",
    channel: opts.channel ?? "stable",
    autoCheckEnabled: () => autoCheck,
    onChange,
  });
  return {
    au,
    timers,
    updater,
    onChange,
    phases: () => onChange.mock.calls.map((c) => c[0].phase),
    advance: (ms: number) => {
      clock += ms;
    },
    setAutoCheck: (v: boolean) => {
      autoCheck = v;
    },
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("reduceUpdater", () => {
  const s0 = initialUpdaterState("1.0.0", "stable");
  const avail = { type: "available" as const, info: toUpdateInfo(info), at: 5 };

  it("happy path idle → checking → available → downloading → downloaded", () => {
    let s = reduceUpdater(s0, { type: "checking" });
    expect(s.phase).toBe("checking");
    s = reduceUpdater(s, avail);
    expect(s).toMatchObject({ phase: "available", lastCheckedAt: 5, info: { version: "1.2.0" } });
    s = reduceUpdater(s, {
      type: "progress",
      progress: { percent: 42.5, bytesPerSecond: 1000, transferred: 425, total: 1000 },
    });
    expect(s).toMatchObject({ phase: "downloading", progress: { percent: 42.5 } });
    s = reduceUpdater(s, { type: "downloaded", info: toUpdateInfo(info) });
    expect(s).toMatchObject({ phase: "downloaded", progress: { percent: 100 } });
    expect(UpdaterStateSchema.safeParse(s).success).toBe(true);
  });

  it("not-available returns to idle and clears info", () => {
    const s = reduceUpdater(reduceUpdater(s0, avail), { type: "not-available", at: 9 });
    expect(s).toMatchObject({ phase: "idle", info: null, lastCheckedAt: 9 });
  });

  it("downloaded is sticky across later checks, availability and errors", () => {
    const done = reduceUpdater(s0, { type: "downloaded", info: toUpdateInfo(info) });
    for (const e of [
      { type: "checking" } as const,
      { type: "error", message: "offline" } as const,
      {
        type: "progress",
        progress: { percent: 1, bytesPerSecond: 1, transferred: 1, total: 1 },
      } as const,
    ]) {
      expect(reduceUpdater(done, e)).toBe(done);
    }
    expect(reduceUpdater(done, { type: "not-available", at: 3 })).toMatchObject({
      phase: "downloaded",
      lastCheckedAt: 3,
    });
    expect(reduceUpdater(done, avail).phase).toBe("downloaded");
  });

  it("a check while downloading does not interrupt the download", () => {
    const dl = reduceUpdater(s0, {
      type: "progress",
      progress: { percent: 10, bytesPerSecond: 1, transferred: 1, total: 10 },
    });
    expect(reduceUpdater(dl, { type: "checking" })).toBe(dl);
    expect(reduceUpdater(dl, { type: "not-available", at: 1 }).phase).toBe("downloading");
  });

  it("errors move to error, and a new check recovers", () => {
    const err = reduceUpdater(reduceUpdater(s0, { type: "checking" }), {
      type: "error",
      message: "net",
    });
    expect(err).toMatchObject({ phase: "error", error: "net" });
    expect(reduceUpdater(err, { type: "checking" })).toMatchObject({
      phase: "checking",
      error: null,
    });
  });

  it("clamps bogus progress values", () => {
    const s = reduceUpdater(s0, {
      type: "progress",
      progress: {
        percent: 140,
        bytesPerSecond: Number.NaN,
        transferred: -5,
        total: Number.POSITIVE_INFINITY,
      },
    });
    expect(s.progress).toEqual({ percent: 100, bytesPerSecond: 0, transferred: 0, total: 0 });
  });
});

describe("release notes passthrough", () => {
  it("keeps string notes, joins array notes, nulls junk", () => {
    expect(normalizeReleaseNotes("<p>hi</p>")).toBe("<p>hi</p>");
    expect(
      normalizeReleaseNotes([
        { version: "1.2.0", note: "<p>b</p>" },
        { version: "1.1.0", note: null },
        { version: "1.0.1", note: "<p>a</p>" },
      ]),
    ).toBe("<h3>1.2.0</h3>\n<p>b</p>\n<h3>1.0.1</h3>\n<p>a</p>");
    expect(normalizeReleaseNotes(null)).toBeNull();
    expect(normalizeReleaseNotes([1, "x"])).toBeNull();
    expect(toUpdateInfo(undefined)).toEqual({
      version: "unknown",
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
    });
  });
});

describe("createUpdater", () => {
  it("configures background download and channel via allowPrerelease", () => {
    const { au, updater } = setup({ channel: "beta" });
    expect(au).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: true,
      allowDowngrade: false,
    });
    updater.setChannel("stable");
    expect(au.allowPrerelease).toBe(false);
    expect(updater.getState().channel).toBe("stable");
  });

  it("checks on launch and every 6h while auto-check is enabled", async () => {
    const { au, timers, updater, setAutoCheck } = setup();
    updater.start();
    await flush();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    expect([...timers.handles.values()].map((h) => h.ms)).toEqual([CHECK_INTERVAL_MS]);
    timers.tick();
    await flush();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    setAutoCheck(false);
    timers.tick();
    await flush();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    // Manual check ignores the setting.
    await updater.check();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it("does not check on launch when auto-check is off", async () => {
    const { au, updater } = setup({ autoCheck: false });
    updater.start();
    await flush();
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  it("drives the full state machine from autoUpdater events and restarts", async () => {
    const { au, updater, phases, advance } = setup();
    au.nextCheck = async () => {
      au.emit("checking-for-update");
      au.emit("update-available", info);
      return { updateInfo: info };
    };
    updater.start();
    advance(500);
    await flush();
    expect(updater.getState()).toMatchObject({ phase: "available", lastCheckedAt: 1_000 });
    expect(updater.restart()).toEqual({ ok: false });

    au.emit("download-progress", { percent: 50, bytesPerSecond: 10, transferred: 5, total: 10 });
    expect(updater.getState()).toMatchObject({ phase: "downloading", progress: { percent: 50 } });
    au.emit("update-downloaded", { ...info, releaseNotes: [{ version: "1.2.0", note: "Fixes" }] });
    expect(updater.getState()).toMatchObject({
      phase: "downloaded",
      info: { version: "1.2.0", releaseNotes: "<h3>1.2.0</h3>\nFixes" },
    });
    expect(phases()).toEqual(["checking", "available", "downloading", "downloaded"]);

    // A later check does not re-query while an update is pending.
    await updater.check();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);

    expect(updater.restart()).toEqual({ ok: true });
    expect(au.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("a rejected check becomes the error state", async () => {
    const { au, updater } = setup();
    au.nextCheck = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    const s = await updater.check();
    expect(s).toMatchObject({ phase: "error", error: "net::ERR_INTERNET_DISCONNECTED" });
    au.nextCheck = async () => {
      au.emit("update-not-available", {});
      return null;
    };
    expect((await updater.check()).phase).toBe("idle");
  });

  it("a null check result (dev build) settles back to idle", async () => {
    const { au, updater } = setup();
    au.nextCheck = async () => null;
    expect((await updater.check()).phase).toBe("idle");
  });

  it("concurrent manual checks share one request", async () => {
    const { au, updater } = setup();
    await Promise.all([updater.check(), updater.check()]);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("switching channel after start triggers a check; dispose detaches", async () => {
    const { au, timers, updater } = setup();
    updater.start();
    await flush();
    updater.setChannel("beta");
    await flush();
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.setChannel("beta");
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.dispose();
    expect(timers.handles.size).toBe(0);
    expect(au.listenerCount("update-available")).toBe(0);
  });

  it("start after dispose re-attaches listeners exactly once", async () => {
    const { au, updater } = setup();
    updater.start();
    updater.dispose();
    updater.start();
    await flush();
    expect(au.listenerCount("update-available")).toBe(1);
    au.emit("update-available", info);
    expect(updater.getState().phase).toBe("available");
    updater.dispose();
  });
});

describe("updater contracts", () => {
  it("names and handlers", async () => {
    for (const [k, c] of Object.entries(updaterContracts)) expect(c.name).toBe(k);
    expect(updaterEvents["updater:changed"].name).toBe("updater:changed");
    const { updater } = setup();
    const h = createUpdaterHandlers({ updater });
    expect(
      updaterContracts["updater:status"].response.parse(await h["updater:status"]()),
    ).toMatchObject({ phase: "idle" });
    expect(updaterContracts["updater:check"].response.parse(await h["updater:check"]()).phase).toBe(
      "idle",
    );
    expect(await h["updater:restart"]()).toEqual({ ok: false });
  });
});
