import { create } from "zustand";
import type { RecordOptions } from "../launcher/types";
import type { CardAction, ProjectSummary } from "../projects/types";
import { sampleProjects } from "../projects/types";
import type { ExportPhase } from "../export/ui/types";
import type { SettingsPatch, SettingsState } from "../settings/types";
import { sampleSettings } from "../settings/types";
import type { HudPhase } from "../hud/types";
import type {
  OnboardingDefaults,
  PermissionKind,
  PermissionsState,
} from "../onboarding/types";

/**
 * App-level UI store. This is the pre-window-management shell: a single-window
 * view switcher that ties the built screens together with mock data. When the
 * real multi-window model (SPEC §2) lands, per-window state moves out of here.
 */

export type View = "onboarding" | "projects" | "launcher" | "editor" | "settings";

export interface RecordingState {
  phase: HudPhase;
  elapsedMs: number;
  sourceLabel: string;
  micLevel: number;
  countdownValue?: number | undefined;
  warning?: string | undefined;
}

export interface AppState {
  view: View;
  /** Where "close settings" returns to. */
  returnView: View;
  activeProjectName: string | null;
  projects: ProjectSummary[];
  settings: SettingsState;
  permissions: PermissionsState;
  defaults: OnboardingDefaults;
  recording: RecordingState | null;
  exportOpen: boolean;
  exportPhase: ExportPhase;

  navigate: (view: View) => void;
  finishOnboarding: () => void;
  openProject: (id: string) => void;
  newRecording: () => void;
  startRecording: (options: RecordOptions) => void;
  stopRecording: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (patch: SettingsPatch) => void;
  requestPermission: (kind: PermissionKind) => void;
  updateDefaults: (patch: Partial<OnboardingDefaults>) => void;
  cardAction: (id: string, action: CardAction) => void;
  openExport: () => void;
  closeExport: () => void;
  runExport: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "onboarding",
  returnView: "projects",
  activeProjectName: null,
  projects: sampleProjects.map((p) => ({ ...p })),
  settings: { ...sampleSettings },
  permissions: { screen: "needed", microphone: "needed", accessibility: "needed" },
  defaults: { fps: 60, countdown: 3, recordingsFolder: "~/Movies/Reelform" },
  recording: null,
  exportOpen: false,
  exportPhase: "idle",

  navigate: (view) => set({ view }),

  finishOnboarding: () => set({ view: "projects" }),

  openProject: (id) => {
    const project = get().projects.find((p) => p.id === id);
    set({ view: "editor", activeProjectName: project?.name ?? "Untitled Demo" });
  },

  newRecording: () => set({ view: "launcher" }),

  startRecording: (options) => {
    const source = `Source ${options.sourceId}`;
    set({
      recording: {
        phase: "recording",
        elapsedMs: 0,
        sourceLabel: source,
        micLevel: options.mic ? 0.6 : 0,
        warning: options.hideCursor ? undefined : "Cursor can't be hidden",
      },
    });
  },

  stopRecording: () => {
    const name = `New Recording ${get().projects.length + 1}`;
    const project: ProjectSummary = {
      id: `p-${get().projects.length + 1}`,
      name,
      modifiedAt: "2026-09-14T00:00:00.000Z",
      durationMs: 60_000,
      state: "ready",
    };
    set({
      recording: null,
      projects: [project, ...get().projects],
      activeProjectName: name,
      view: "editor",
    });
  },

  openSettings: () => set({ returnView: get().view, view: "settings" }),
  closeSettings: () => set({ view: get().returnView }),

  updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

  requestPermission: (kind) =>
    set({ permissions: { ...get().permissions, [kind]: "granted" } }),

  updateDefaults: (patch) => set({ defaults: { ...get().defaults, ...patch } }),

  cardAction: (id, action) => {
    if (action === "delete") {
      set({ projects: get().projects.filter((p) => p.id !== id) });
    }
  },

  openExport: () => set({ exportOpen: true, exportPhase: "idle" }),
  closeExport: () => set({ exportOpen: false, exportPhase: "idle" }),
  runExport: () => set({ exportPhase: "rendering" }),
}));
