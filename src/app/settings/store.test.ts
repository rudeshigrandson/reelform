import { describe, expect, it, vi } from "vitest";
import {
  SettingsPatchSchema,
  SettingsSchema,
  createDefaultSettings,
} from "../../../electron/settings/schema";
import { SETTINGS_KEYS, type SettingsState, sampleSettings } from "../../settings/types";
import { applySettingsPatch, fromMainSettings, toMainPatch } from "./mapping";
import {
  type SettingsChange,
  type SettingsSetResult,
  type SettingsTransport,
  createAppSettingsStore,
} from "./store";

const mainDefaults = createDefaultSettings({ recordingsFolder: "~/Movies/Reelform" });

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTransport() {
  const listeners = new Set<(c: SettingsChange) => void>();
  const sets: Deferred<SettingsSetResult | null>[] = [];
  const transport: SettingsTransport = {
    get: vi.fn(async () => structuredClone(mainDefaults)),
    set: vi.fn(() => {
      const d = deferred<SettingsSetResult | null>();
      sets.push(d);
      return d.promise;
    }),
    reset: vi.fn(async () => ({ ok: true as const, settings: mainDefaults, changed: [] })),
    subscribe: vi.fn((l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
  };
  const emit = (settings: typeof mainDefaults, changed: string[] = []) => {
    for (const l of listeners) l({ settings, changed });
  };
  return { transport, sets, emit, listeners };
}

const okWith = (patch: Partial<SettingsState>): SettingsSetResult => ({
  ok: true,
  settings: { ...mainDefaults, ...patch },
  changed: Object.keys(patch),
});

describe("settings type mapping", () => {
  it("renderer keys are exactly the main schema keys minus schemaVersion", () => {
    const mainKeys = Object.keys(SettingsSchema.shape).filter((k) => k !== "schemaVersion");
    expect([...SETTINGS_KEYS].sort()).toEqual(mainKeys.sort());
  });

  it("sampleSettings mirrors main defaults (except the platform folder)", () => {
    expect({ ...sampleSettings, recordingsFolder: "x" }).toEqual({
      ...fromMainSettings(mainDefaults),
      recordingsFolder: "x",
    });
  });

  it("round-trips main → renderer → patch → main", () => {
    const main = {
      ...mainDefaults,
      theme: "dark" as const,
      shortcuts: { "editor.save": "Meta+S" },
    };
    const state = fromMainSettings(main);
    expect(state).not.toHaveProperty("schemaVersion");
    const patch = toMainPatch(state);
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(true);
    expect(SettingsSchema.parse({ ...mainDefaults, ...patch })).toEqual(main);
  });

  it("fromMainSettings deep-copies records", () => {
    const main = { ...mainDefaults, shortcuts: { a: "Meta+A" } };
    const state = fromMainSettings(main);
    state.shortcuts.a = "Meta+B";
    expect(main.shortcuts.a).toBe("Meta+A");
  });

  it("toMainPatch drops unknown keys, undefined values and schemaVersion", () => {
    expect(
      toMainPatch({ theme: "light", bogus: 1, schemaVersion: 2, reduceMotion: undefined }),
    ).toEqual({ theme: "light" });
  });

  it("applySettingsPatch replaces records whole", () => {
    const s = applySettingsPatch(
      { ...sampleSettings, shortcuts: { a: "Meta+A" } },
      { shortcuts: { b: "Meta+B" } },
    );
    expect(s.shortcuts).toEqual({ b: "Meta+B" });
  });
});

describe("createAppSettingsStore", () => {
  it("loads from settings:get and becomes ready", async () => {
    const { transport } = fakeTransport();
    vi.mocked(transport.get).mockResolvedValueOnce({ ...mainDefaults, theme: "dark" });
    const store = createAppSettingsStore(transport);
    const p = store.getState().init();
    expect(store.getState().status).toBe("loading");
    await p;
    expect(store.getState().status).toBe("ready");
    expect(store.getState().settings.theme).toBe("dark");
    expect(store.getState().settings).not.toHaveProperty("schemaVersion");
    // Idempotent.
    await store.getState().init();
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
  });

  it("goes offline outside Electron and keeps local edits", async () => {
    const { transport } = fakeTransport();
    vi.mocked(transport.get).mockResolvedValueOnce(null);
    vi.mocked(transport.set).mockResolvedValueOnce(null);
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    expect(store.getState().status).toBe("offline");
    expect(await store.getState().patch({ theme: "light" })).toEqual({ ok: true });
    expect(store.getState().settings.theme).toBe("light");
    expect(store.getState().confirmed.theme).toBe("light");
  });

  it("reports a load failure as error status", async () => {
    const { transport } = fakeTransport();
    vi.mocked(transport.get).mockRejectedValueOnce(
      Object.assign(new Error("boom"), { code: "READ_FAILED" }),
    );
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    expect(store.getState().status).toBe("error");
    expect(store.getState().lastError?.code).toBe("READ_FAILED");
  });

  it("applies a patch optimistically and confirms with main's settings", async () => {
    const { transport, sets } = fakeTransport();
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    const p = store.getState().patch({ theme: "dark" });
    expect(store.getState().settings.theme).toBe("dark");
    expect(store.getState().confirmed.theme).toBe("system");
    expect(transport.set).toHaveBeenCalledWith({ theme: "dark" });
    sets[0]?.resolve(okWith({ theme: "dark" }));
    expect(await p).toEqual({ ok: true });
    expect(store.getState().confirmed.theme).toBe("dark");
    expect(store.getState().pending).toHaveLength(0);
  });

  it.each(["INVALID_PATCH", "SHORTCUT_CONFLICT", "WRITE_FAILED"] as const)(
    "rolls back on %s",
    async (code) => {
      const { transport, sets } = fakeTransport();
      const store = createAppSettingsStore(transport);
      await store.getState().init();
      const p = store.getState().patch({ shortcuts: { "editor.export": "Meta+S" } });
      expect(store.getState().settings.shortcuts).toEqual({ "editor.export": "Meta+S" });
      sets[0]?.resolve({ ok: false, error: { code, message: "nope" } });
      const res = await p;
      expect(res.ok).toBe(false);
      expect(store.getState().settings.shortcuts).toEqual({});
      expect(store.getState().lastError?.code).toBe(code);
      store.getState().clearError();
      expect(store.getState().lastError).toBeNull();
    },
  );

  it("rolls back when the invoke itself rejects (ReelformIpcError)", async () => {
    const { transport, sets } = fakeTransport();
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    const p = store.getState().patch({ reduceMotion: true });
    sets[0]?.reject(Object.assign(new Error("bad"), { code: "INVALID_PATCH" }));
    expect(await p).toMatchObject({ ok: false, error: { code: "INVALID_PATCH" } });
    expect(store.getState().settings.reduceMotion).toBe(false);
  });

  it("a failed patch rolls back only its keys; a later pending patch survives", async () => {
    const { transport, sets } = fakeTransport();
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    const first = store.getState().patch({ theme: "dark" });
    const second = store.getState().patch({ density: "compact" });
    expect(store.getState().settings).toMatchObject({ theme: "dark", density: "compact" });
    sets[0]?.resolve({ ok: false, error: { code: "INVALID_PATCH", message: "x" } });
    await first;
    expect(store.getState().settings).toMatchObject({ theme: "system", density: "compact" });
    sets[1]?.resolve(okWith({ density: "compact" }));
    await second;
    expect(store.getState().settings).toMatchObject({ theme: "system", density: "compact" });
  });

  it("follows settings:changed from other windows without losing pending edits", async () => {
    const { transport, sets, emit } = fakeTransport();
    const store = createAppSettingsStore(transport);
    await store.getState().init();
    const p = store.getState().patch({ theme: "light" });
    emit({ ...mainDefaults, accentColor: "pink" }, ["accentColor"]);
    expect(store.getState().settings).toMatchObject({ theme: "light", accentColor: "pink" });
    sets[0]?.resolve(okWith({ theme: "light", accentColor: "pink" }));
    await p;
    expect(store.getState().settings).toMatchObject({ theme: "light", accentColor: "pink" });
  });

  it("ignores empty/unknown-only patches without calling main", async () => {
    const { transport } = fakeTransport();
    const store = createAppSettingsStore(transport);
    expect(await store.getState().patch({})).toEqual({ ok: true });
    expect(transport.set).not.toHaveBeenCalled();
  });

  it("reset adopts main's defaults; dispose unsubscribes", async () => {
    const { transport, emit, listeners } = fakeTransport();
    const store = createAppSettingsStore(transport, { ...sampleSettings, theme: "dark" });
    await store.getState().init();
    emit({ ...mainDefaults, theme: "dark" });
    expect(await store.getState().reset()).toEqual({ ok: true });
    expect(store.getState().settings.theme).toBe("system");
    store.getState().dispose();
    expect(listeners.size).toBe(0);
  });
});
