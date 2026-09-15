import { describe, expect, it, vi } from "vitest";
import { createSettingsHandlers, settingsContracts } from "./contracts";
import { migrateSettings } from "./migrations";
import {
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
  changedKeys,
  createDefaultSettings,
} from "./schema";
import { createSettingsStore } from "./store";
import { MemoryFs } from "./testFs";

const FILE = "/user/data/settings.json";
const defaults = createDefaultSettings({ recordingsFolder: "/home/me/Videos/Reelform" });

const setup = (initial?: unknown) => {
  const fs = new MemoryFs();
  if (initial !== undefined) {
    fs.files.set(FILE, typeof initial === "string" ? initial : JSON.stringify(initial));
  }
  const log = vi.fn();
  const store = createSettingsStore({ fs, filePath: FILE, defaults, platform: "mac", log });
  return { fs, store, log };
};

/** The M0 on-disk shape (src/settings/types.ts SettingsState, no schemaVersion). */
const legacyV1 = {
  theme: "dark",
  recordingsFolder: "/Users/me/Movies/Reelform",
  autoPrune: true,
  autoPruneDays: 0,
  checkUpdates: false,
  defaultFps: 30,
  defaultCountdown: 5,
  captureBackend: "electron",
  hideCursorByDefault: true,
  maxLengthHours: 2,
};

describe("schema", () => {
  it("defaults validate and are a superset of SettingsState keys", () => {
    expect(SettingsSchema.parse(defaults)).toEqual(defaults);
    for (const key of Object.keys(legacyV1)) expect(defaults).toHaveProperty(key);
    expect(defaults.maxLengthHours).toBe(3);
    expect(defaults.autoPruneDays).toBe(14);
    expect(defaults.sendUsageStats).toBe(false);
  });

  it("changedKeys compares nested values", () => {
    expect(changedKeys(defaults, { ...defaults, shortcuts: { "editor.save": "" } })).toEqual([
      "shortcuts",
    ]);
    expect(changedKeys(defaults, structuredClone(defaults))).toEqual([]);
  });
});

describe("migrateSettings", () => {
  it("migrates a v1 file: keeps valid values, turns autoPruneDays 0 into autoPrune off", () => {
    const r = migrateSettings(legacyV1, defaults);
    expect(r.fromVersion).toBe(1);
    expect(r.needsWrite).toBe(true);
    expect(r.settings).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      theme: "dark",
      recordingsFolder: "/Users/me/Movies/Reelform",
      autoPrune: false,
      autoPruneDays: 14,
      checkUpdates: false,
      defaultFps: 30,
      defaultCountdown: 5,
      captureBackend: "electron",
      hideCursorByDefault: true,
      maxLengthHours: 2,
      updateChannel: "stable",
    });
    expect(SettingsSchema.safeParse(r.settings).success).toBe(true);
  });

  it("v1 with non-zero prune days keeps them", () => {
    const r = migrateSettings({ ...legacyV1, autoPruneDays: 30 }, defaults);
    expect(r.settings).toMatchObject({ autoPrune: true, autoPruneDays: 30 });
  });

  it("repairs invalid keys individually and drops unknown keys", () => {
    const r = migrateSettings(
      { ...defaults, defaultFps: 24, theme: "neon", logLevel: "debug", bogus: 1 },
      defaults,
    );
    expect(r.repairedKeys.sort()).toEqual(["defaultFps", "theme"]);
    expect(r.droppedKeys).toEqual(["bogus"]);
    expect(r.settings.defaultFps).toBe(60);
    expect(r.settings.theme).toBe("system");
    expect(r.settings.logLevel).toBe("debug");
    expect(r.needsWrite).toBe(true);
  });

  it("current valid file needs no write; non-object input yields defaults", () => {
    expect(migrateSettings(defaults, defaults).needsWrite).toBe(false);
    for (const bad of [null, 42, "x", [1, 2]]) {
      const r = migrateSettings(bad, defaults);
      expect(r.settings).toEqual(defaults);
      expect(r.fromVersion).toBeNull();
    }
  });

  it("newer-version files are read leniently and flagged", () => {
    const r = migrateSettings({ ...defaults, schemaVersion: 99, futureKey: true }, defaults);
    expect(r.fromNewerVersion).toBe(true);
    expect(r.settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("does not share nested objects with defaults", () => {
    const r = migrateSettings(undefined, defaults);
    (r.settings.shortcuts as Record<string, string>).x = "A";
    expect(defaults.shortcuts).toEqual({});
  });
});

describe("createSettingsStore", () => {
  it("missing file → defaults written atomically via tmp + rename", async () => {
    const { fs, store } = setup();
    expect(await store.load()).toEqual(defaults);
    expect(fs.calls).toEqual([
      `read ${FILE}`,
      "mkdir /user/data",
      `write ${FILE}.tmp`,
      `rename ${FILE}.tmp -> ${FILE}`,
    ]);
    expect(fs.json(FILE)).toEqual(defaults);
    expect(fs.files.has(`${FILE}.tmp`)).toBe(false);
  });

  it("migrates a v1 file on load and persists the result", async () => {
    const { fs, store } = setup(legacyV1);
    const s = await store.load();
    expect(s.theme).toBe("dark");
    expect(fs.json(FILE)).toMatchObject({ schemaVersion: 2, autoPrune: false, theme: "dark" });
  });

  it("corrupt JSON is backed up and replaced with defaults", async () => {
    const { fs, store, log } = setup("{ not json");
    expect(await store.load()).toEqual(defaults);
    expect(fs.files.get(`${FILE}.corrupt`)).toBe("{ not json");
    expect(fs.json(FILE)).toEqual(defaults);
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("not valid JSON"));
  });

  it("an unreadable (non-ENOENT) file is not overwritten with defaults on load", async () => {
    const { fs, store, log } = setup({ ...defaults, theme: "dark" });
    fs.readFile = async () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    expect(await store.load()).toEqual(defaults);
    expect(fs.calls.some((c) => c.startsWith("write") || c.startsWith("rename"))).toBe(false);
    expect(fs.json(FILE)).toMatchObject({ theme: "dark" });
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("EACCES"));
  });

  it("load() resolves to the live settings after later sets", async () => {
    const { store } = setup(defaults);
    await store.load();
    await store.set({ theme: "dark" });
    expect((await store.load()).theme).toBe("dark");
  });

  it("does not rewrite a file from a newer app version on load", async () => {
    const { fs, store } = setup({ ...defaults, schemaVersion: 3 });
    await store.load();
    expect(fs.calls.some((c) => c.startsWith("write"))).toBe(false);
  });

  it("applies a valid partial patch, persists, and broadcasts changed keys", async () => {
    const { fs, store } = setup(defaults);
    const listener = vi.fn();
    store.subscribe(listener);
    const res = await store.set({ theme: "light", defaultFps: 30 });
    expect(res).toMatchObject({ ok: true, changed: ["defaultFps", "theme"] });
    expect(store.get().theme).toBe("light");
    expect(fs.json(FILE)).toMatchObject({ theme: "light", defaultFps: 30 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ changed: ["defaultFps", "theme"] });
  });

  it("no-op patch neither writes nor broadcasts", async () => {
    const { fs, store } = setup(defaults);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.load();
    fs.calls = [];
    expect(await store.set({ theme: defaults.theme })).toMatchObject({ ok: true, changed: [] });
    expect(fs.calls).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong type", { defaultFps: 24 }],
    ["unknown key", { notASetting: true }],
    ["schemaVersion is not patchable", { schemaVersion: 2 }],
    ["out of range", { autoPruneDays: 0 }],
    ["invalid accelerator", { shortcuts: { "editor.save": "Hyper+S" } }],
    ["not an object", "theme=dark"],
    ["null", null],
  ])("rejects invalid patch: %s", async (_name, patch) => {
    const { fs, store } = setup(defaults);
    await store.load();
    fs.calls = [];
    const res = await store.set(patch);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INVALID_PATCH");
    expect(store.get()).toEqual(defaults);
    expect(fs.calls).toEqual([]);
  });

  it("rejects shortcut overrides that introduce a blocking conflict, accepts shadows", async () => {
    const { store } = setup(defaults);
    const dup = await store.set({ shortcuts: { "editor.export": "Meta+S" } });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("SHORTCUT_CONFLICT");
    const fine = await store.set({
      shortcuts: { "editor.export": "Shift+Meta+E", "editor.save": "" },
    });
    expect(fine.ok).toBe(true);
  });

  it("an existing conflict does not block unrelated shortcut edits", async () => {
    const { store } = setup({ ...defaults, shortcuts: { "editor.export": "Meta+S" } });
    await store.load();
    const res = await store.set({
      shortcuts: { "editor.export": "Meta+S", "editor.undo": "Meta+U" },
    });
    expect(res.ok).toBe(true);
  });

  it("write failure keeps previous settings and does not broadcast", async () => {
    const { fs, store } = setup(defaults);
    await store.load();
    const listener = vi.fn();
    store.subscribe(listener);
    fs.failWrite = new Error("EACCES");
    const res = await store.set({ theme: "dark" });
    expect(res).toMatchObject({ ok: false, error: { code: "WRITE_FAILED" } });
    expect(store.get().theme).toBe("system");
    expect(listener).not.toHaveBeenCalled();
    expect(fs.json(FILE)).toEqual(defaults);
  });

  it("serializes concurrent sets so both land", async () => {
    const { fs, store } = setup(defaults);
    await Promise.all([store.set({ theme: "dark" }), store.set({ defaultFps: 30 })]);
    expect(fs.json(FILE)).toMatchObject({ theme: "dark", defaultFps: 30 });
  });

  it("a throwing listener does not break others", async () => {
    const { store, log } = setup(defaults);
    const good = vi.fn();
    store.subscribe(() => {
      throw new Error("boom");
    });
    const unsub = store.subscribe(good);
    await store.set({ theme: "dark" });
    expect(good).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("error", expect.stringContaining("boom"));
    unsub();
    await store.set({ theme: "light" });
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("reset restores defaults", async () => {
    const { store } = setup({ ...defaults, theme: "dark" });
    const res = await store.reset();
    expect(res).toMatchObject({ ok: true, changed: ["theme"] });
    expect(store.get()).toEqual(defaults);
  });
});

describe("settings handlers + contracts", () => {
  it("channel names match keys and follow domain:verb", () => {
    for (const [key, c] of Object.entries(settingsContracts)) {
      expect(c.name).toBe(key);
      expect(key).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });

  it("get/set/reset go through the store; responses satisfy the contract", async () => {
    const { store } = setup(defaults);
    const handlers = createSettingsHandlers({
      store,
      shortcuts: {
        getStatus: () => ({
          context: { hudOpen: false, recording: false, countdown: false },
          registered: [],
          failures: [],
        }),
      },
    });
    const got = await handlers["settings:get"]();
    expect(settingsContracts["settings:get"].response.parse(got)).toEqual(defaults);
    const set = await handlers["settings:set"]({ patch: { reduceMotion: true } });
    expect(settingsContracts["settings:set"].response.parse(set)).toMatchObject({ ok: true });
    // settings:get after a set must not return the load-time snapshot.
    expect((await handlers["settings:get"]()).reduceMotion).toBe(true);
    const reset = await handlers["settings:reset"]();
    expect(settingsContracts["settings:reset"].response.parse(reset)).toMatchObject({ ok: true });
    const status = await handlers["shortcuts:globalStatus"]();
    expect(settingsContracts["shortcuts:globalStatus"].response.parse(status).registered).toEqual(
      [],
    );
  });

  it("the request schema rejects invalid patches at the IPC boundary", () => {
    const req = settingsContracts["settings:set"].request;
    expect(req.safeParse({ patch: { theme: "light" } }).success).toBe(true);
    expect(req.safeParse({ patch: { theme: "neon" } }).success).toBe(false);
    expect(req.safeParse({ patch: { nope: 1 } }).success).toBe(false);
  });
});
