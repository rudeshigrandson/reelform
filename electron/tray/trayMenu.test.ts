import fc from "fast-check";
import { type MainMessageKey, createMainTranslator } from "../i18n";
import {
  DEFAULT_TRAY_LABELS,
  MAX_RECENT_ITEMS,
  type TrayAction,
  type TrayMenuItem,
  type TrayRecordingState,
  buildTrayMenu,
  formatTrayElapsed,
  toNativeTemplate,
  trayIconState,
} from "./trayMenu";

const ids = (items: TrayMenuItem[]) => items.map((i) => (i.kind === "separator" ? "-" : i.id));
const find = (items: TrayMenuItem[], id: string) =>
  items.find((i) => i.kind === "item" && i.id === id) as
    | Extract<TrayMenuItem, { kind: "item" }>
    | undefined;

describe("buildTrayMenu", () => {
  it("idle: no pause/resume, stop disabled, new recording enabled with ⌘⇧R", () => {
    const m = buildTrayMenu({ recording: "idle", recent: [] });
    expect(ids(m)).toEqual([
      "new-recording",
      "recent",
      "open-editor",
      "-",
      "stop-recording",
      "-",
      "settings",
      "quit",
    ]);
    expect(find(m, "new-recording")).toMatchObject({
      enabled: true,
      accelerator: "CommandOrControl+Shift+R",
    });
    expect(find(m, "stop-recording")?.enabled).toBe(false);
  });

  it("recording: Pause shown, stop enabled, new recording disabled", () => {
    const m = buildTrayMenu({ recording: "recording", recent: [] });
    expect(ids(m)).toContain("pause");
    expect(ids(m)).not.toContain("resume");
    expect(find(m, "stop-recording")?.enabled).toBe(true);
    expect(find(m, "new-recording")?.enabled).toBe(false);
  });

  it("paused: Resume replaces Pause", () => {
    const m = buildTrayMenu({ recording: "paused", recent: [] });
    expect(ids(m)).toContain("resume");
    expect(ids(m)).not.toContain("pause");
    expect(find(m, "resume")).toMatchObject({ label: "Resume", action: { type: "resume" } });
  });

  it("uses custom accelerators from settings", () => {
    const m = buildTrayMenu({
      recording: "recording",
      recent: [],
      startStopAccelerator: "Alt+R",
      pauseAccelerator: "Alt+P",
    });
    expect(find(m, "new-recording")?.accelerator).toBe("Alt+R");
    expect(find(m, "pause")?.accelerator).toBe("Alt+P");
  });

  it("Recent submenu: empty placeholder, cap, fallback label", () => {
    const empty = buildTrayMenu({ recording: "idle", recent: [] });
    const sub = empty.find((i) => i.kind === "submenu");
    expect(sub?.kind === "submenu" && sub.items).toEqual([
      expect.objectContaining({ label: "No recent projects", enabled: false }),
    ]);

    const recent = Array.from({ length: 15 }, (_, i) => ({
      projectId: `p${i}`,
      name: i === 0 ? "" : `P ${i}`,
    }));
    const full = buildTrayMenu({ recording: "idle", recent }).find((i) => i.kind === "submenu");
    if (full?.kind !== "submenu") throw new Error("no submenu");
    expect(full.items).toHaveLength(MAX_RECENT_ITEMS);
    expect(full.items[0]).toMatchObject({
      label: "Untitled",
      action: { type: "open-recent", projectId: "p0" },
    });
  });

  it("English fallback labels match the en catalog", () => {
    const { t } = createMainTranslator("en", []);
    for (const [key, text] of Object.entries(DEFAULT_TRAY_LABELS)) {
      expect(t(key as MainMessageKey)).toBe(text);
    }
    const plain = buildTrayMenu({ recording: "paused", recent: [] });
    const translated = buildTrayMenu({ recording: "paused", recent: [], t });
    expect(translated).toEqual(plain);
  });

  it("labels every item through the translator when given", () => {
    const t = (key: MainMessageKey) => `[${key}]`;
    const m = buildTrayMenu({
      recording: "recording",
      recent: [{ projectId: "p1", name: "" }],
      t,
    });
    const labels = m.flatMap((i) =>
      i.kind === "separator"
        ? []
        : i.kind === "submenu"
          ? [i.label, ...i.items.map((c) => (c.kind === "separator" ? "-" : c.label))]
          : [i.label],
    );
    expect(labels).toEqual([
      "[main.tray.newRecording]",
      "[main.tray.recent]",
      "[main.tray.untitled]",
      "[main.tray.openEditor]",
      "[main.tray.statusRecording]",
      "[main.tray.pause]",
      "[main.tray.stopRecording]",
      "[main.tray.settings]",
      "[main.tray.quit]",
    ]);
    const empty = buildTrayMenu({ recording: "idle", recent: [], t });
    const sub = empty.find((i) => i.kind === "submenu");
    expect(sub?.kind === "submenu" && sub.items[0]).toMatchObject({
      label: "[main.tray.noRecent]",
    });
  });

  it("status row: disabled, after the separator, shows elapsed time; absent when idle", () => {
    const rec = buildTrayMenu({ recording: "recording", recent: [], elapsedMs: 42_130 });
    expect(ids(rec)).toEqual([
      "new-recording",
      "recent",
      "open-editor",
      "-",
      "status",
      "pause",
      "stop-recording",
      "-",
      "settings",
      "quit",
    ]);
    expect(find(rec, "status")).toMatchObject({ label: "● Recording · 00:42.1", enabled: false });
    expect(toNativeTemplate(rec, () => {}).find((i) => i.id === "status")?.enabled).toBe(false);

    const later = buildTrayMenu({ recording: "recording", recent: [], elapsedMs: 43_130 });
    expect(find(later, "status")?.label).toBe("● Recording · 00:43.1");

    const paused = buildTrayMenu({ recording: "paused", recent: [], elapsedMs: 42_130 });
    expect(find(paused, "status")?.label).toBe("Paused · 00:42.1");

    expect(ids(buildTrayMenu({ recording: "idle", recent: [], elapsedMs: 5000 }))).not.toContain(
      "status",
    );
  });

  it("status row passes the formatted time to the translator", () => {
    const t = (key: MainMessageKey, vars?: Readonly<Record<string, string | number>>) =>
      `${key}|${String(vars?.time)}`;
    const m = buildTrayMenu({ recording: "paused", recent: [], elapsedMs: 61_000, t });
    expect(find(m, "status")?.label).toBe("main.tray.statusPaused|01:01.0");
  });

  it("property: pause/resume present iff recording is active; exactly one of them", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TrayRecordingState>("idle", "recording", "paused"),
        (recording) => {
          const m = ids(buildTrayMenu({ recording, recent: [] }));
          const count = m.filter((x) => x === "pause" || x === "resume").length;
          expect(count).toBe(recording === "idle" ? 0 : 1);
          expect(m.at(-1)).toBe("quit");
        },
      ),
    );
  });
});

describe("trayIconState", () => {
  it("red dot only while recording or paused", () => {
    expect(trayIconState("idle")).toMatchObject({ redDot: false, template: true });
    expect(trayIconState("recording")).toMatchObject({ redDot: true, template: false });
    expect(trayIconState("paused").redDot).toBe(true);
  });

  it("tooltips come from the main catalog and follow the translator", () => {
    const { t } = createMainTranslator("en", []);
    expect(trayIconState("idle", t).tooltip).toBe("Reelform");
    expect(trayIconState("recording", t).tooltip).toBe("Reelform — Recording");
    expect(trayIconState("paused").tooltip).toBe("Reelform — Paused");

    // A language switch hands the tray a new translator; tooltips re-render through it.
    const other = (key: MainMessageKey) => `xx:${key}`;
    expect(trayIconState("idle", other).tooltip).toBe("xx:main.tray.tooltip");
    expect(trayIconState("recording", other).tooltip).toBe("xx:main.tray.tooltipRecording");
    expect(trayIconState("paused", other).tooltip).toBe("xx:main.tray.tooltipPaused");
  });
});

describe("formatTrayElapsed", () => {
  it("formats mm:ss.t with floored tenths", () => {
    expect(formatTrayElapsed(0)).toBe("00:00.0");
    expect(formatTrayElapsed(42_199)).toBe("00:42.1");
    expect(formatTrayElapsed(599_999)).toBe("09:59.9");
    expect(formatTrayElapsed(3_723_400)).toBe("62:03.4");
    expect(formatTrayElapsed(-5)).toBe("00:00.0");
    expect(formatTrayElapsed(Number.NaN)).toBe("00:00.0");
  });
});

describe("toNativeTemplate", () => {
  it("maps items and wires clicks to actions", () => {
    const actions: TrayAction[] = [];
    const tpl = toNativeTemplate(
      buildTrayMenu({ recording: "paused", recent: [{ projectId: "x", name: "X" }] }),
      (a) => actions.push(a),
    );
    expect(tpl[3]).toEqual({ type: "separator" });
    const recent = tpl.find((t) => t.id === "recent");
    expect(recent?.type).toBe("submenu");
    recent?.submenu?.[0]?.click?.();
    tpl.find((t) => t.id === "resume")?.click?.();
    tpl.find((t) => t.id === "quit")?.click?.();
    expect(actions).toEqual([
      { type: "open-recent", projectId: "x" },
      { type: "resume" },
      { type: "quit" },
    ]);
    expect(tpl.find((t) => t.id === "settings")).not.toHaveProperty("accelerator");
  });
});
