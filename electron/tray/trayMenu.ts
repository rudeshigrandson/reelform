/**
 * Tray / menu-bar menu as pure data (DESIGN_GUIDE S04, ENGINEERING_SPEC §11):
 * New recording ⌘⇧R, Recent ▸, Open editor, Pause/Resume (only while
 * recording), Stop recording, Settings, Quit. Icon: template, red dot while
 * recording.
 */

export type TrayRecordingState = "idle" | "recording" | "paused";

export interface RecentProject {
  projectId: string;
  name: string;
}

export interface TrayState {
  recording: TrayRecordingState;
  recent: readonly RecentProject[];
  /** Electron accelerator for start/stop (from settings); default ⌘⇧R / Ctrl+Shift+R. */
  startStopAccelerator?: string | undefined;
  /** Electron accelerator for pause (from settings); default ⌘⇧P / Ctrl+Shift+P. */
  pauseAccelerator?: string | undefined;
}

export type TrayAction =
  | { type: "new-recording" }
  | { type: "open-recent"; projectId: string }
  | { type: "open-editor" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop-recording" }
  | { type: "settings" }
  | { type: "quit" };

export type TrayMenuItem =
  | { kind: "separator" }
  | {
      kind: "item";
      id: string;
      label: string;
      enabled: boolean;
      accelerator?: string | undefined;
      action: TrayAction;
    }
  | { kind: "submenu"; id: string; label: string; enabled: boolean; items: TrayMenuItem[] };

export const DEFAULT_START_STOP_ACCELERATOR = "CommandOrControl+Shift+R";
export const DEFAULT_PAUSE_ACCELERATOR = "CommandOrControl+Shift+P";
export const MAX_RECENT_ITEMS = 10;

export function buildTrayMenu(state: TrayState): TrayMenuItem[] {
  const active = state.recording !== "idle";
  const recent = state.recent.slice(0, MAX_RECENT_ITEMS);

  const recentItems: TrayMenuItem[] =
    recent.length === 0
      ? [
          {
            kind: "item",
            id: "recent-empty",
            label: "No recent projects",
            enabled: false,
            action: { type: "open-editor" },
          },
        ]
      : recent.map((p) => ({
          kind: "item" as const,
          id: `recent:${p.projectId}`,
          label: p.name || "Untitled",
          enabled: true,
          action: { type: "open-recent" as const, projectId: p.projectId },
        }));

  const items: TrayMenuItem[] = [
    {
      kind: "item",
      id: "new-recording",
      label: "New recording",
      enabled: !active,
      accelerator: state.startStopAccelerator ?? DEFAULT_START_STOP_ACCELERATOR,
      action: { type: "new-recording" },
    },
    { kind: "submenu", id: "recent", label: "Recent", enabled: true, items: recentItems },
    {
      kind: "item",
      id: "open-editor",
      label: "Open editor",
      enabled: true,
      action: { type: "open-editor" },
    },
    { kind: "separator" },
  ];

  if (active) {
    const paused = state.recording === "paused";
    items.push({
      kind: "item",
      id: paused ? "resume" : "pause",
      label: paused ? "Resume" : "Pause",
      enabled: true,
      accelerator: state.pauseAccelerator ?? DEFAULT_PAUSE_ACCELERATOR,
      action: paused ? { type: "resume" } : { type: "pause" },
    });
  }

  items.push(
    {
      kind: "item",
      id: "stop-recording",
      label: "Stop recording",
      enabled: active,
      ...(active
        ? { accelerator: state.startStopAccelerator ?? DEFAULT_START_STOP_ACCELERATOR }
        : {}),
      action: { type: "stop-recording" },
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "settings",
      label: "Settings…",
      enabled: true,
      action: { type: "settings" },
    },
    { kind: "item", id: "quit", label: "Quit Reelform", enabled: true, action: { type: "quit" } },
  );
  return items;
}

export interface TrayIconState {
  /** Monochrome template image (macOS adapts it to the menu bar). */
  template: boolean;
  /** Red recording dot badge. */
  redDot: boolean;
  tooltip: string;
}

export function trayIconState(recording: TrayRecordingState): TrayIconState {
  switch (recording) {
    case "recording":
      return { template: false, redDot: true, tooltip: "Reelform — Recording" };
    case "paused":
      return { template: false, redDot: true, tooltip: "Reelform — Paused" };
    default:
      return { template: true, redDot: false, tooltip: "Reelform" };
  }
}

/** Structural subset of Electron's `MenuItemConstructorOptions`. */
export interface NativeMenuItem {
  type?: "normal" | "separator" | "submenu";
  id?: string;
  label?: string;
  enabled?: boolean;
  accelerator?: string;
  click?: () => void;
  submenu?: NativeMenuItem[];
}

/** Map pure menu data to an Electron template, wiring clicks to `onAction`. */
export function toNativeTemplate(
  items: readonly TrayMenuItem[],
  onAction: (action: TrayAction) => void,
): NativeMenuItem[] {
  return items.map((item): NativeMenuItem => {
    switch (item.kind) {
      case "separator":
        return { type: "separator" };
      case "submenu":
        return {
          type: "submenu",
          id: item.id,
          label: item.label,
          enabled: item.enabled,
          submenu: toNativeTemplate(item.items, onAction),
        };
      default: {
        const out: NativeMenuItem = {
          type: "normal",
          id: item.id,
          label: item.label,
          enabled: item.enabled,
          click: () => onAction(item.action),
        };
        if (item.accelerator) out.accelerator = item.accelerator;
        return out;
      }
    }
  });
}
