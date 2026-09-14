import fc from "fast-check";
import {
  MAX_RECENT_ITEMS,
  type TrayAction,
  type TrayMenuItem,
  type TrayRecordingState,
  buildTrayMenu,
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
