import { useEffect, useReducer } from "react";
import { OnboardingView } from "./OnboardingView";
import { initialOnboardingState, reduceOnboarding } from "./machine";
import type {
  OnboardingDefaults,
  OnboardingProps,
  PermissionEntry,
  PermissionKind,
  PermissionsSnapshot,
  PermissionsState,
} from "./types";

export { sampleOnboardingProps } from "./types";
export type { OnboardingProps } from "./types";
export { Onboarding } from "./Onboarding";
export type { OnboardingContainerProps } from "./Onboarding";

const entry = (
  kind: PermissionEntry["kind"],
  status: PermissionEntry["status"],
  required = false,
): PermissionEntry => ({
  kind,
  status,
  required,
  canRequest: status === "not-determined",
  canOpenSettings: false,
});

/** Legacy `PermissionsState` (dev shell) → a macOS-shaped snapshot. */
export function legacySnapshot(p: PermissionsState): PermissionsSnapshot {
  const s = (k: PermissionKind) => (p[k] === "granted" ? "granted" : "not-determined");
  return {
    platform: "darwin",
    permissions: {
      screen: entry("screen", s("screen"), true),
      microphone: entry("microphone", s("microphone")),
      camera: entry("camera", "not-applicable"),
      accessibility: entry("accessibility", s("accessibility")),
      notifications: entry("notifications", "not-applicable"),
    },
  };
}

const LEGACY_KINDS: readonly string[] = ["screen", "microphone", "accessibility"];

const draftFrom = (d: OnboardingDefaults) => ({
  recordingsFolder: d.recordingsFolder,
  defaultFps: d.fps,
  autoDeleteRawAfterExport: d.autoDeleteRawAfterExport ?? false,
  openEditorAfterRecording: d.openEditorAfterRecording ?? true,
});

/**
 * Prop-driven onboarding for the single-window dev shell (src/App.tsx). The
 * real windows use {@link Onboarding} with an IPC port.
 */
export function OnboardingFlow({
  permissions,
  onRequestPermission,
  defaults,
  onDefaultsChange,
  onFinish,
}: OnboardingProps) {
  const [state, dispatch] = useReducer(reduceOnboarding, draftFrom(defaults), (d) => ({
    ...initialOnboardingState(d),
    snapshot: legacySnapshot(permissions),
  }));

  useEffect(() => {
    dispatch({ type: "SNAPSHOT", snapshot: legacySnapshot(permissions) });
  }, [permissions]);

  const { recordingsFolder, fps, autoDeleteRawAfterExport, openEditorAfterRecording } = defaults;
  useEffect(() => {
    dispatch({
      type: "DRAFT",
      patch: draftFrom({
        recordingsFolder,
        fps,
        countdown: 3,
        autoDeleteRawAfterExport,
        openEditorAfterRecording,
      }),
    });
  }, [recordingsFolder, fps, autoDeleteRawAfterExport, openEditorAfterRecording]);

  return (
    <OnboardingView
      state={state}
      onNext={() => dispatch({ type: "NEXT" })}
      onBack={() => dispatch({ type: "BACK" })}
      onRequest={(kind) => {
        if (LEGACY_KINDS.includes(kind)) onRequestPermission(kind as PermissionKind);
      }}
      onOpenSettings={() => {}}
      onDraft={(patch) => {
        dispatch({ type: "DRAFT", patch });
        const out: Partial<OnboardingDefaults> = {};
        if (patch.defaultFps !== undefined) out.fps = patch.defaultFps;
        if (patch.recordingsFolder !== undefined) out.recordingsFolder = patch.recordingsFolder;
        if (patch.autoDeleteRawAfterExport !== undefined)
          out.autoDeleteRawAfterExport = patch.autoDeleteRawAfterExport;
        if (patch.openEditorAfterRecording !== undefined)
          out.openEditorAfterRecording = patch.openEditorAfterRecording;
        onDefaultsChange(out);
      }}
      onSaveDefaults={() => {
        dispatch({ type: "SAVE_START" });
        dispatch({ type: "SAVE_OK" });
      }}
      onFinish={onFinish}
    />
  );
}
