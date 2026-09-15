import { useCallback, useEffect, useReducer, useRef } from "react";
import { OnboardingView } from "./OnboardingView";
import {
  type OnboardingDraft,
  PERMISSION_POLL_MS,
  finishPatch,
  initialOnboardingState,
  reduceOnboarding,
  startStatusPolling,
} from "./machine";
import type { IntervalTimer, OnboardingPort, OsPermissionKind } from "./types";

export interface OnboardingContainerProps {
  port: OnboardingPort;
  /** Current settings values for S03. */
  initialDraft: OnboardingDraft;
  /** "Start recording" on the done step. Completion is already persisted. */
  onFinish: () => void;
  appVersion?: string | null | undefined;
  onImportProject?: (() => void) | undefined;
  onOpenTerms?: (() => void) | undefined;
  timer?: IntervalTimer | undefined;
  pollIntervalMs?: number | undefined;
}

const windowTimer: IntervalTimer = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/**
 * Onboarding container (SPEC §11): drives the state machine, polls
 * `permissions:status` every 2s only while the permissions step is open,
 * and on Finish writes the S03 defaults plus `onboardingCompleted: true`.
 */
export function Onboarding({
  port,
  initialDraft,
  onFinish,
  appVersion,
  onImportProject,
  onOpenTerms,
  timer = windowTimer,
  pollIntervalMs = PERMISSION_POLL_MS,
}: OnboardingContainerProps) {
  const [state, dispatch] = useReducer(reduceOnboarding, initialDraft, initialOnboardingState);
  const polling = useRef<{ refresh(): void } | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const onPermissions = state.step === "permissions";
  useEffect(() => {
    if (!onPermissions) return;
    const handle = startStatusPolling({
      read: () => port.status(),
      onSnapshot: (snapshot) => dispatch({ type: "SNAPSHOT", snapshot }),
      onUnavailable: () => dispatch({ type: "UNAVAILABLE" }),
      onError: (message) => dispatch({ type: "STATUS_ERROR", message }),
      timer,
      intervalMs: pollIntervalMs,
    });
    polling.current = handle;
    return () => {
      handle.stop();
      polling.current = null;
    };
  }, [onPermissions, port, timer, pollIntervalMs]);

  const onRequest = useCallback(
    async (kind: OsPermissionKind) => {
      dispatch({ type: "REQUEST_START", kind });
      try {
        await port.request(kind);
      } catch {
        // Status polling surfaces the real state; a failed prompt is not fatal.
      } finally {
        if (live.current) dispatch({ type: "REQUEST_END" });
        polling.current?.refresh();
      }
    },
    [port],
  );

  const onOpenSettings = useCallback(
    (kind: OsPermissionKind) => {
      void port.openSettings(kind).catch(() => false);
    },
    [port],
  );

  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  const onChangeFolder = useCallback(async () => {
    const picked = await port.pickFolder(draftRef.current.recordingsFolder).catch(() => null);
    if (picked && live.current) dispatch({ type: "DRAFT", patch: { recordingsFolder: picked } });
  }, [port]);

  // The reducer ignores a second SAVE_START, but a double click lands before
  // the disabled button re-renders; this ref keeps it to one write.
  const saving = useRef(false);
  const onSaveDefaults = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    dispatch({ type: "SAVE_START" });
    const ok = await port.saveSettings(finishPatch(draftRef.current)).catch(() => false);
    saving.current = false;
    if (!live.current) return;
    dispatch(
      ok
        ? { type: "SAVE_OK" }
        : { type: "SAVE_FAILED", message: "Couldn't save your settings. Try again." },
    );
  }, [port]);

  return (
    <OnboardingView
      state={state}
      onNext={() => dispatch({ type: "NEXT" })}
      onBack={() => dispatch({ type: "BACK" })}
      onRequest={(kind) => void onRequest(kind)}
      onOpenSettings={onOpenSettings}
      onDraft={(patch) => dispatch({ type: "DRAFT", patch })}
      onChangeFolder={() => void onChangeFolder()}
      onSaveDefaults={() => void onSaveDefaults()}
      onFinish={onFinish}
      appVersion={appVersion}
      onImportProject={onImportProject}
      onOpenTerms={onOpenTerms}
    />
  );
}
