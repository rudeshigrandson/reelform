import type { SettingsPatch, SettingsState } from "../settings/types";
import type {
  IntervalTimer,
  OsPermissionKind,
  PermissionEntry,
  PermissionsSnapshot,
} from "./types";

/**
 * Onboarding state machine (SPEC §11): welcome → permissions → defaults → done.
 * Pure reducer; the container feeds it permission snapshots and save results.
 */

export const ONBOARDING_STEPS = ["welcome", "permissions", "defaults", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** S03 fields, written to settings on Finish. */
export type OnboardingDraft = Pick<
  SettingsState,
  "recordingsFolder" | "autoDeleteRawAfterExport" | "defaultFps" | "openEditorAfterRecording"
>;

export interface OnboardingState {
  step: OnboardingStep;
  snapshot: PermissionsSnapshot | null;
  /** `permissions:status` unavailable (not running in Electron). */
  unavailable: boolean;
  statusError: string | null;
  requesting: OsPermissionKind | null;
  draft: OnboardingDraft;
  saving: boolean;
  saveError: string | null;
}

export type OnboardingEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SNAPSHOT"; snapshot: PermissionsSnapshot }
  | { type: "UNAVAILABLE" }
  | { type: "STATUS_ERROR"; message: string }
  | { type: "REQUEST_START"; kind: OsPermissionKind }
  | { type: "REQUEST_END" }
  | { type: "DRAFT"; patch: Partial<OnboardingDraft> }
  | { type: "SAVE_START" }
  | { type: "SAVE_OK" }
  | { type: "SAVE_FAILED"; message: string };

/**
 * Only the S03 keys. Callers often pass the whole settings object as the
 * initial draft; without this, Finish would write every setting back and
 * clobber edits made meanwhile in another window.
 */
export function pickDraft(source: OnboardingDraft): OnboardingDraft {
  return {
    recordingsFolder: source.recordingsFolder,
    autoDeleteRawAfterExport: source.autoDeleteRawAfterExport,
    defaultFps: source.defaultFps,
    openEditorAfterRecording: source.openEditorAfterRecording,
  };
}

export function initialOnboardingState(draft: OnboardingDraft): OnboardingState {
  return {
    step: "welcome",
    snapshot: null,
    unavailable: false,
    statusError: null,
    requesting: null,
    draft: pickDraft(draft),
    saving: false,
    saveError: null,
  };
}

const PERMISSION_ORDER: readonly OsPermissionKind[] = [
  "screen",
  "microphone",
  "camera",
  "accessibility",
  "notifications",
];

/** Rows to show (S02 order); not-applicable kinds are hidden (Windows: mic/camera only). */
export function permissionRows(snapshot: PermissionsSnapshot | null): PermissionEntry[] {
  if (!snapshot) return [];
  return PERMISSION_ORDER.map((k) => snapshot.permissions[k]).filter(
    (e) => e.status !== "not-applicable",
  );
}

/** Screen Recording is the only blocker; platforms that don't gate it pass. */
export function canLeavePermissions(
  state: Pick<OnboardingState, "snapshot" | "unavailable">,
): boolean {
  if (state.unavailable) return true;
  const screen = state.snapshot?.permissions.screen.status;
  return screen === "granted" || screen === "not-applicable";
}

/** True when an optional permission is still not granted ("Skip for now"). */
export function hasPendingOptional(snapshot: PermissionsSnapshot | null): boolean {
  return permissionRows(snapshot).some((e) => !e.required && e.status !== "granted");
}

export function reduceOnboarding(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (event.type) {
    case "NEXT":
      if (state.step === "welcome") return { ...state, step: "permissions" };
      if (state.step === "permissions" && canLeavePermissions(state)) {
        return { ...state, step: "defaults", requesting: null };
      }
      // defaults → done only through SAVE_OK; done is terminal.
      return state;
    case "BACK":
      if (state.saving) return state;
      if (state.step === "permissions") return { ...state, step: "welcome" };
      if (state.step === "defaults") return { ...state, step: "permissions", saveError: null };
      return state;
    case "SNAPSHOT":
      return { ...state, snapshot: event.snapshot, unavailable: false, statusError: null };
    case "UNAVAILABLE":
      return { ...state, unavailable: true, statusError: null };
    case "STATUS_ERROR":
      return { ...state, statusError: event.message };
    case "REQUEST_START":
      return { ...state, requesting: event.kind };
    case "REQUEST_END":
      return { ...state, requesting: null };
    case "DRAFT":
      return { ...state, draft: { ...state.draft, ...event.patch } };
    case "SAVE_START":
      if (state.step !== "defaults" || state.saving) return state;
      return { ...state, saving: true, saveError: null };
    case "SAVE_OK":
      if (!state.saving) return state;
      return { ...state, saving: false, step: "done" };
    case "SAVE_FAILED":
      if (!state.saving) return state;
      return { ...state, saving: false, saveError: event.message };
  }
}

/** The settings written by S03 "Finish" — includes the completion flag. */
export function finishPatch(draft: OnboardingDraft): SettingsPatch {
  return { ...pickDraft(draft), onboardingCompleted: true };
}

export const PERMISSION_POLL_MS = 2000;

export interface StatusPollingOptions {
  read: () => Promise<PermissionsSnapshot | null>;
  onSnapshot: (snapshot: PermissionsSnapshot) => void;
  onUnavailable: () => void;
  onError: (message: string) => void;
  timer: IntervalTimer;
  intervalMs?: number | undefined;
}

/**
 * Read now, then every `intervalMs` (2s, SPEC §11) while the permissions step
 * is open. A read still in flight skips the tick; nothing is emitted after the
 * returned stop(). `refresh()` forces an immediate read (after a request).
 */
export function startStatusPolling(opts: StatusPollingOptions): { stop(): void; refresh(): void } {
  let inFlight = false;
  let stopped = false;
  const tick = async () => {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const snap = await opts.read();
      if (stopped) return;
      if (snap === null) opts.onUnavailable();
      else opts.onSnapshot(snap);
    } catch (err) {
      if (!stopped) opts.onError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const handle = opts.timer.setInterval(() => void tick(), opts.intervalMs ?? PERMISSION_POLL_MS);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      opts.timer.clearInterval(handle);
    },
    refresh: () => void tick(),
  };
}
