import type { ResponseOf } from "@contracts";
import { Button, Card, CardMeta, CardTitle } from "@design/components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { formatElapsed } from "../../hud/RecordingHud";
import { Launcher } from "../../launcher/Launcher";
import type {
  DeviceInfo,
  LauncherDefaults,
  LauncherNotice,
  LauncherProject,
  LauncherProjectAction,
  RecordOptions,
} from "../../launcher/types";
import { type ProjectActionTarget, useProjectActions } from "../../projects/useProjectActions";
import type { Platform } from "../../recording/constraints";
import { warningCopy } from "../../recording/sessionStore";
import type { ProjectInvoke } from "../project/openProject";
import { PostRecordCard } from "./PostRecordCard";
import {
  FALLBACK_CAPTURE_COPY,
  SYSTEM_AUDIO_UNSUPPORTED_COPY,
  sourceLabel,
  systemAudioSupported,
  toPickerSources,
  toSourceItems,
  usesFallbackCapture,
} from "./document";
import type { FlowError, RecordingFlow } from "./flow";
import type { AppRecordingPort, PermissionSettingsKind, SourcesResult, SystemPort } from "./port";

/**
 * Launcher window container (guide S04/S05/S11, SPEC §5.6): lists sources
 * (`recording:listSources`, refreshed every 2 s while visible), input devices
 * (injected `enumerateDevices`), and drives the launcher-hosted
 * {@link RecordingFlow}: start / region selection → countdown → recording →
 * post-record card. Shows permission-denied, disk-low and backend-fallback
 * notices.
 */

export interface DeviceLike {
  deviceId: string;
  kind: string;
  label: string;
}

export interface IntervalTimers {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface VisibilitySource {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface LauncherContainerProps {
  flow: RecordingFlow;
  port: Pick<AppRecordingPort, "listSources">;
  /** `navigator.mediaDevices.enumerateDevices` in the app. */
  enumerateDevices: () => Promise<DeviceLike[]>;
  platform: Platform;
  system?: Pick<SystemPort, "openPermissionSettings"> | undefined;
  defaults?: LauncherDefaults | undefined;
  /** Latest sources, so the flow can resolve capture ids / labels. */
  onSources?: ((sources: SourcesResult | null) => void) | undefined;
  onOpenSettings?: (() => void) | undefined;
  refreshIntervalMs?: number | undefined;
  timers?: IntervalTimers | undefined;
  visibility?: VisibilitySource | undefined;
  /** `project:*` channels for the S04 project shelf; no shelf when omitted. */
  projectInvoke?: ProjectInvoke | undefined;
  /** App version for the sidebar footer. */
  version?: string | undefined;
  /** macOS `hiddenInset` window: draggable top strip clearing the traffic lights. */
  insetTitleBar?: boolean | undefined;
  /** Notices from outside the recording flow (e.g. the update strip), shown first. */
  extraNotices?: ReadonlyArray<LauncherNotice> | undefined;
}

export const SOURCES_REFRESH_MS = 2000;

type ProjectEntry = ResponseOf<"project:list">["projects"][number];
type TrashEntry = ResponseOf<"project:listTrash">["projects"][number];

interface ShelfState {
  status: "loading" | "ready" | "error";
  projects: LauncherProject[];
  trashed: LauncherProject[];
  /** Shelf id (project path) → openable project id; missing/corrupt entries are absent. */
  openable: Map<string, string>;
  /** Shelf id (project path) → what the card menu acts on (library and trash). */
  targets: Map<string, ProjectActionTarget>;
}

const LOADING_SHELF: ShelfState = {
  status: "loading",
  projects: [],
  trashed: [],
  openable: new Map(),
  targets: new Map(),
};

/** Launcher without the project IPC: actions resolve to "unavailable". */
const noProjectInvoke: ProjectInvoke = async () => null;

export function toLauncherProject(entry: ProjectEntry): LauncherProject {
  return {
    id: entry.path,
    name: entry.name,
    modifiedAt: entry.modifiedAt ?? "",
    durationMs: entry.durationMs ?? 0,
    ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
    ...(typeof entry.sizeBytes === "number" ? { sizeBytes: entry.sizeBytes } : {}),
  };
}

export function toTrashedLauncherProject(entry: TrashEntry): LauncherProject {
  return {
    id: entry.path,
    name: entry.name,
    modifiedAt: entry.trashedAt ?? "",
    durationMs: 0,
    ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
  };
}

const defaultTimers: IntervalTimers = {
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const documentVisibility: VisibilitySource = {
  isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  subscribe: (listener) => {
    if (typeof document === "undefined") return () => {};
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

export function toDeviceLists(devices: readonly DeviceLike[]): {
  mic: DeviceInfo[];
  webcam: DeviceInfo[];
} {
  const pick = (kind: string, noun: string): DeviceInfo[] =>
    devices
      .filter((d) => d.kind === kind && d.deviceId !== "")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${noun} ${i + 1}` }));
  return { mic: pick("audioinput", "Microphone"), webcam: pick("videoinput", "Camera") };
}

const PERMISSION_CODES = new Set([
  "PERMISSION_DENIED",
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
  "capture-permission-denied",
]);

const PERMISSION_LABEL: Record<string, string> = {
  screen: "Screen Recording",
  microphone: "Microphone",
  camera: "Camera",
};

function missingPermissions(error: FlowError): string[] {
  const details = error.details as { missing?: unknown } | undefined;
  return Array.isArray(details?.missing)
    ? details.missing.filter((m): m is string => typeof m === "string")
    : [];
}

/** Notices for a failed start (stage start/capture), in guide copy. */
export function startErrorNotice(
  error: FlowError,
  actions: {
    openSettings?: ((kind: PermissionSettingsKind) => void) | undefined;
    dismiss: () => void;
  },
): LauncherNotice {
  if (PERMISSION_CODES.has(error.code)) {
    const missing = missingPermissions(error);
    const names = missing.map((m) => PERMISSION_LABEL[m] ?? m);
    const first = (missing[0] ?? "screen") as PermissionSettingsKind;
    return {
      id: "permission",
      tone: "danger",
      message:
        names.length > 0
          ? `${names.join(" and ")} permission is missing. Allow it in System Settings, then try again.`
          : "Reelform isn't allowed to capture. Allow it in System Settings, then try again.",
      action: actions.openSettings
        ? { label: "Open System Settings", onClick: () => actions.openSettings?.(first) }
        : undefined,
      onDismiss: actions.dismiss,
    };
  }
  const copy: Record<string, string> = {
    DISK_LOW: "At least 2 GB of free disk space is needed to start recording.",
    SOURCE_NOT_FOUND: "That screen or window is no longer available. Pick another source.",
    SOURCE_NOT_CAPTURABLE: error.message,
    SESSION_ACTIVE: "A recording is already in progress.",
    BACKEND_UNAVAILABLE: "No capture method is available on this computer.",
    IPC_UNAVAILABLE: "Recording only works in the Reelform desktop app.",
  };
  return {
    id: "start-error",
    tone: "danger",
    message: copy[error.code] ?? error.message,
    onDismiss: actions.dismiss,
  };
}

export function LauncherContainer({
  flow,
  port,
  enumerateDevices,
  platform,
  system,
  defaults,
  onSources,
  onOpenSettings,
  refreshIntervalMs = SOURCES_REFRESH_MS,
  timers = defaultTimers,
  visibility = documentVisibility,
  projectInvoke,
  version,
  insetTitleBar,
  extraNotices,
}: LauncherContainerProps) {
  const state = useStore(flow.store);
  const [sources, setSources] = useState<SourcesResult | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceLike[]>([]);
  const [visible, setVisible] = useState(() => visibility.isVisible());
  const inflight = useRef(false);
  const mounted = useRef(true);
  const onSourcesRef = useRef(onSources);
  onSourcesRef.current = onSources;

  const idleLike = state.phase === "idle" || state.phase === "error";

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const [src, devs] = await Promise.all([
        port.listSources(),
        enumerateDevices().catch(() => null),
      ]);
      if (!mounted.current) return;
      setSources(src);
      setSourcesError(null);
      onSourcesRef.current?.(src);
      if (devs) setDevices(devs);
    } catch (err) {
      if (!mounted.current) return;
      const message =
        err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Couldn't list screens and windows.";
      setSourcesError(message);
    } finally {
      inflight.current = false;
    }
  }, [port, enumerateDevices]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => visibility.subscribe(() => setVisible(visibility.isVisible())), [visibility]);

  // Initial load + 2 s refresh while visible and not recording (SPEC §3).
  useEffect(() => {
    if (!visible || !idleLike) return;
    void refresh();
    const handle = timers.setInterval(() => void refresh(), refreshIntervalMs);
    return () => timers.clearInterval(handle);
  }, [visible, idleLike, refresh, timers, refreshIntervalMs]);

  // Project shelf: loads on mount and again whenever the flow returns to idle,
  // so a just-finished recording shows up.
  const [shelf, setShelf] = useState<ShelfState | null>(projectInvoke ? LOADING_SHELF : null);
  const [shelfReload, setShelfReload] = useState(0);
  const reloadShelf = useCallback(() => setShelfReload((k) => k + 1), []);
  const projectActions = useProjectActions({
    invoke: projectInvoke ?? noProjectInvoke,
    onChanged: reloadShelf,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `shelfReload` is the post-action refresh trigger.
  useEffect(() => {
    if (!projectInvoke || !idleLike) return;
    let live = true;
    setShelf((s) => s ?? LOADING_SHELF);
    Promise.all([
      projectInvoke("project:list", {}),
      projectInvoke("project:listTrash", {}).catch(() => null),
    ]).then(
      ([list, trash]) => {
        if (!live) return;
        if (!list) {
          setShelf({ ...LOADING_SHELF, status: "error" });
          return;
        }
        const openable = new Map<string, string>();
        const targets = new Map<string, ProjectActionTarget>();
        const trashed = trash?.projects ?? [];
        for (const e of list.projects) {
          if (e.id !== null && !e.missing && !e.corrupt) openable.set(e.path, e.id);
          targets.set(e.path, { path: e.path, name: e.name });
        }
        for (const e of trashed) targets.set(e.path, { path: e.path, name: e.name });
        setShelf({
          status: "ready",
          projects: list.projects.map(toLauncherProject),
          trashed: trashed.map(toTrashedLauncherProject),
          openable,
          targets,
        });
      },
      () => live && setShelf({ ...LOADING_SHELF, status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [projectInvoke, idleLike, shelfReload]);

  const onOpenProject = useCallback(
    (path: string) => {
      const projectId = shelf?.openable.get(path);
      if (projectInvoke && projectId) void projectInvoke("windows:openEditor", { projectId });
    },
    [projectInvoke, shelf],
  );

  const onProjectMenu = (path: string, action: LauncherProjectAction) => {
    const target = shelf?.targets.get(path);
    if (!target) return;
    switch (action) {
      case "rename":
        projectActions.rename(target);
        break;
      case "duplicate":
        projectActions.duplicate(target);
        break;
      case "reveal":
        void projectActions.reveal(target);
        break;
      case "trash":
        void projectActions.moveToTrash(target);
        break;
      case "restore":
        void projectActions.restore(target);
        break;
      case "deleteForever":
        projectActions.deleteForever(target);
        break;
    }
  };

  const deviceLists = useMemo(() => toDeviceLists(devices), [devices]);

  const onStart = useCallback(
    (options: RecordOptions) => {
      if (options.mode === "region") void flow.selectRegion(options);
      else void flow.start(options);
    },
    [flow],
  );

  const openSettings = system?.openPermissionSettings;
  const notices: LauncherNotice[] = [...(extraNotices ?? [])];
  const backend = sources?.backend ?? null;
  if (usesFallbackCapture(platform, backend)) {
    notices.push({ id: "fallback", tone: "warning", message: FALLBACK_CAPTURE_COPY });
  }
  if (
    state.phase === "error" &&
    state.error &&
    (state.error.stage === "start" || state.error.stage === "capture")
  ) {
    notices.push(
      startErrorNotice(state.error, {
        openSettings: openSettings ? (kind) => void openSettings(kind) : undefined,
        dismiss: () => flow.dismissError(),
      }),
    );
  }
  if (projectActions.error) {
    notices.push({
      id: "project-action",
      tone: "danger",
      message: projectActions.error,
      onDismiss: () => projectActions.setError(null),
    });
  }
  if (state.phase === "selectingRegion") {
    notices.push({
      id: "region",
      tone: "info",
      message: "Drag on screen to select a region. Press Esc to cancel.",
      action: { label: "Cancel", onClick: () => void flow.cancelRegionSelection() },
    });
  }

  if (state.phase === "countdown" || state.phase === "recording" || state.phase === "paused") {
    const label = state.setup ? sourceLabel(state.setup, sources) : "";
    return (
      <div
        data-testid="launcher-recording"
        style={{
          width: "100%",
          maxWidth: 480,
          margin: "var(--space-8) auto",
          fontFamily: "var(--font-body)",
        }}
      >
        <Card elevation="md" style={{ padding: "var(--space-5)" }}>
          <CardTitle>
            {state.phase === "countdown"
              ? `Recording starts in ${state.countdownRemaining ?? ""}`
              : state.phase === "paused"
                ? "Recording paused"
                : "Recording"}
          </CardTitle>
          <CardMeta>
            {label} ·{" "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{formatElapsed(state.elapsedMs)}</span>
          </CardMeta>
          <p style={{ margin: "var(--space-3) 0", fontSize: 13, color: "var(--text-2)" }}>
            Use the recording pill to pause or stop.
          </p>
          {state.warnings.length > 0 ? (
            <output style={{ margin: 0, fontSize: 13, color: "var(--warning)" }}>
              {state.warnings.map(warningCopy).join(" · ")}
            </output>
          ) : null}
          {state.phase === "countdown" ? (
            <Button variant="ghost" onClick={() => void flow.cancel()}>
              Cancel
            </Button>
          ) : null}
        </Card>
      </div>
    );
  }

  if (
    state.phase === "finalizing" ||
    state.phase === "creatingProject" ||
    state.phase === "done" ||
    (state.phase === "error" &&
      (state.error?.stage === "finalize" || state.error?.stage === "create"))
  ) {
    return (
      <PostRecordCard
        state={state}
        onOpenInEditor={() => void flow.openInEditor()}
        onReveal={() => void flow.reveal()}
        onRecordAnother={() => void flow.recordAnother()}
        onDelete={() => void flow.deleteRecording()}
        onRetry={() => void flow.retry()}
      />
    );
  }

  const sourcesStatus = sourcesError ? "error" : sources ? "ready" : "loading";

  return (
    <>
      <Launcher
        sources={toSourceItems(sources, "screen").concat(toSourceItems(sources, "window"))}
        micDevices={deviceLists.mic}
        webcamDevices={deviceLists.webcam}
        systemAudioSupported={systemAudioSupported(platform, backend)}
        systemAudioNote={SYSTEM_AUDIO_UNSUPPORTED_COPY}
        pickerSources={toPickerSources(sources)}
        onStart={onStart}
        onOpenSettings={onOpenSettings}
        sourcesStatus={sourcesStatus}
        sourcesError={sourcesError ?? undefined}
        onRetrySources={() => void refresh()}
        notices={notices}
        busy={state.phase === "starting" || state.phase === "selectingRegion"}
        busyLabel={state.phase === "selectingRegion" ? "Selecting region…" : "Starting…"}
        defaults={defaults}
        version={version}
        platform={platform}
        insetTitleBar={insetTitleBar}
        {...(shelf
          ? {
              projects: shelf.projects,
              projectsStatus: shelf.status,
              trashedProjects: shelf.trashed,
              onOpenProject,
              onProjectMenu,
              canRevealProjects: true,
              onOpenProjectFile: () => void projectActions.openFromDisk(),
            }
          : {})}
      />
      {projectActions.dialogs}
    </>
  );
}
