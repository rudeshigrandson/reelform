import type { IpcError } from "@contracts";
import { Button, Dialog } from "@design/components";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorWindow, type EditorWindowProps } from "../../editor/EditorWindow";
import type { SuggestedZoom } from "../../editor/autozoom";
import { type IntervalTimer, bindBlurAutosave } from "../../editor/persistence";
import { usePlaybackStore } from "../../editor/playback/store";
import type { CreatePreviewStage } from "../../editor/preview";
import { createDocumentUpdate, createEditorHistory, useHistoryState } from "../../editor/state";
import { useOptionalShortcut } from "../../shortcuts/ShortcutsProvider";
import { invoke as appInvoke } from "../ipc";
import { useAppSettings } from "../settings/store";
import { AutoZoomSuggestionsToast } from "./AutoZoomSuggestionsToast";
import {
  type AutoZoomOnOpenPrefs,
  autoZoomPrefsFromSettings,
  runAutoZoomOnOpen,
} from "./autoZoomOnOpen";
import {
  type ProjectInvoke,
  type ProjectMediaPort,
  type RecoveryInfo,
  bindCursorTrack,
  browserMediaPort,
  defaultProjectStores,
  openProject,
  releaseMediaRoots,
  renameOpenProject,
  restoreProjectBackup,
  toIpcErrorShape,
} from "./openProject";
import { type ProjectSaver, createProjectSaver } from "./projectSaver";
import { useProjectSession } from "./session";

/**
 * The editor route (`?window=editor&projectId=…`): opens the project, owns its
 * history + save lifecycle, and renders the loading / not-found / error states,
 * the "Crash recovered" and "Save changes?" dialogs (guide S12 state 12, S27).
 */

export interface EditorWindowPort {
  /** "‹ Projects": bring up the launcher and close this editor window. */
  back(): void | Promise<void>;
  /** Close this window for real (the save prompt already resolved). */
  close(): void;
}

export interface ProjectEditorProps {
  projectId: string;
  onExport: () => void;
  /** Settings `undoHistorySize` (read once when the window opens). */
  undoHistorySize?: number | undefined;
  /**
   * Settings `autoZoomOnNewRecording` + `autoZoomSensitivity` (SPEC §6.1). Read
   * when a project finishes opening; defaults to the window's settings mirror.
   */
  autoZoomOnOpen?: AutoZoomOnOpenPrefs | undefined;
  invoke?: ProjectInvoke | undefined;
  media?: ProjectMediaPort | undefined;
  windowPort?: EditorWindowPort | undefined;
  createStage?: CreatePreviewStage | undefined;
  onLocateMedia?: (() => void) | undefined;
  /** Passed to EditorWindow: builds the inspector host from the document history. */
  createInspectorHost?: EditorWindowProps["createInspectorHost"];
  /** Autosave interval timer (tests). */
  timer?: IntervalTimer | undefined;
  /** Blur / beforeunload / ⌘S source. Defaults to `window`. */
  eventTarget?: Window | undefined;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; path: string }
  | { kind: "not-found"; error: IpcError }
  | { kind: "error"; error: IpcError };

type LeaveIntent = "back" | "close";

const centerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-3)",
  width: "100%",
  height: "100%",
  padding: "var(--space-6)",
  background: "var(--bg-app)",
  color: "var(--text-2)",
  fontFamily: "var(--font-body)",
  textAlign: "center",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontWeight: 400,
  fontSize: "22px",
  color: "var(--text-1)",
};

const toastStyle: CSSProperties = {
  position: "fixed",
  right: "var(--space-4)",
  bottom: "var(--space-4)",
  zIndex: 10,
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border)",
  color: "var(--text-1)",
  fontSize: "12px",
  boxShadow: "var(--shadow-md)",
};

const defaultWindowPort = (invoke: ProjectInvoke): EditorWindowPort => ({
  back: async () => {
    await invoke("windows:openLauncher", undefined).catch(() => null);
    window.close();
  },
  close: () => window.close(),
});

const SAVED_TOAST_MS = 1500;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ProjectEditor({
  projectId,
  onExport,
  undoHistorySize,
  autoZoomOnOpen,
  invoke = appInvoke as ProjectInvoke,
  media = browserMediaPort,
  windowPort,
  createStage,
  onLocateMedia,
  createInspectorHost,
  timer,
  eventTarget,
}: ProjectEditorProps): ReactElement {
  const port = useMemo(() => windowPort ?? defaultWindowPort(invoke), [windowPort, invoke]);
  const target = eventTarget ?? (typeof window === "undefined" ? undefined : window);
  const [history] = useState(() => createEditorHistory({ cap: undoHistorySize }));
  const historyState = useHistoryState(history);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [recovery, setRecovery] = useState<RecoveryInfo>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [leave, setLeave] = useState<LeaveIntent | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [zoomSuggestions, setZoomSuggestions] = useState<readonly SuggestedZoom[]>([]);
  const documentUpdate = useMemo(() => createDocumentUpdate(history), [history]);
  // Read at open time, not a dependency: a settings change must not re-open the project.
  const autoZoomRef = useRef(autoZoomOnOpen);
  autoZoomRef.current = autoZoomOnOpen;

  const saverRef = useRef<ProjectSaver | null>(null);
  /** Media roots of the open project (swapped when a rename moves the folder). */
  const rootIdsRef = useRef<string[]>([]);
  const allowCloseRef = useRef(false);
  const autosaveIntervalSec = useAppSettings((s) => s.settings.autosaveIntervalSec);
  const projectName = useProjectSession((s) => s.meta?.name ?? "Untitled");
  const sourceDurationMs = useProjectSession((s) => s.meta?.sources.video.durationMs);
  const ready = phase.kind === "ready";
  const dirty = ready && historyState.dirty;

  // Open (and re-open on retry / projectId change).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Try again trigger.
  useEffect(() => {
    const controller = new AbortController();
    let unbindCursor: (() => void) | null = null;
    setPhase({ kind: "loading" });
    setRecovery(null);
    setZoomSuggestions([]);
    void openProject(projectId, { invoke, media, signal: controller.signal }).then((res) => {
      if (controller.signal.aborted) {
        if (res.status === "ready") void releaseMediaRoots(res.mediaRootIds, invoke);
        return;
      }
      if (res.status === "aborted") return;
      if (res.status !== "ready") {
        setPhase({ kind: res.status, error: res.error });
        return;
      }
      rootIdsRef.current = res.mediaRootIds;
      history.clear();
      unbindCursor = bindCursorTrack();
      try {
        const auto = runAutoZoomOnOpen({
          stores: defaultProjectStores(),
          documentUpdate: createDocumentUpdate(history),
          prefs:
            autoZoomRef.current ?? autoZoomPrefsFromSettings(useAppSettings.getState().settings),
        });
        if (auto.status === "applied") setZoomSuggestions(auto.suggestions);
      } catch {
        // Suggestions are a convenience: an engine failure never blocks opening.
      }
      setRecovery(res.recovery);
      setPhase({ kind: "ready", path: res.path });
    });
    return () => {
      controller.abort();
      unbindCursor?.();
      // Switching project while ready: the old saver must not autosave the next load.
      // The save lifecycle effect creates a fresh one once the new project is ready.
      saverRef.current?.dispose();
      saverRef.current = null;
      const rootIds = rootIdsRef.current;
      rootIdsRef.current = [];
      if (rootIds.length > 0) void releaseMediaRoots(rootIds, invoke);
    };
  }, [projectId, attempt, invoke, media, history]);

  // Save lifecycle while a project is open; re-created when the autosave interval
  // setting changes (SPEC §4, settings `autosaveIntervalSec`).
  useEffect(() => {
    if (!ready) return;
    const intervalMs =
      Number.isFinite(autosaveIntervalSec) && autosaveIntervalSec > 0
        ? autosaveIntervalSec * 1000
        : undefined;
    const saver = createProjectSaver({ invoke, history, timer, intervalMs });
    // Unsaved edits made under the previous saver still need their backup.
    if (history.isDirty()) saver.autosave.markDirty();
    saverRef.current = saver;
    const unbindBlur = target ? bindBlurAutosave(target, saver) : null;
    return () => {
      unbindBlur?.();
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [ready, invoke, history, timer, target, autosaveIntervalSec]);

  const showToast = useCallback((text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
  }, []);
  useEffect(() => {
    if (!toast || toast.tone === "error") return;
    const id = setTimeout(() => setToast(null), SAVED_TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const saver = saverRef.current;
    if (!saver) return false;
    const ok = await saver.save();
    if (!ok) {
      const err = toIpcErrorShape(saver.autosave.getStatus().lastError);
      showToast(`Couldn't save — ${err.message}`, "error");
    }
    return ok;
  }, [showToast]);

  const proceed = useCallback(
    (intent: LeaveIntent) => {
      allowCloseRef.current = true;
      if (intent === "back") void port.back();
      else port.close();
    },
    [port],
  );

  const requestLeave = useCallback(
    (intent: LeaveIntent) => {
      if (history.isDirty()) {
        setLeaveError(null);
        setLeave(intent);
      } else {
        proceed(intent);
      }
    },
    [history, proceed],
  );

  // ⌘S / Ctrl+S manual save; "Saved" toast only for manual saves (guide §5).
  // Registry id `editor.save` (user overrides apply) inside a shortcuts provider;
  // the fixed ⌘S/Ctrl+S listener only runs standalone.
  const saveShortcut = () => void saveNow().then((ok) => ok && showToast("Saved"));
  const hasShortcuts = useOptionalShortcut("editor.save", saveShortcut, { enabled: ready });
  useEffect(() => {
    if (!target || !ready || hasShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "s" && e.code !== "KeyS") return;
      e.preventDefault();
      void saveNow().then((ok) => ok && showToast("Saved"));
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [target, ready, hasShortcuts, saveNow, showToast]);

  // Top-bar rename (S12): same outcome as the launcher rename, plus the open
  // session follows the renamed folder.
  const onRename = useCallback(
    (name: string): Promise<boolean> =>
      renameOpenProject(name, { invoke, mediaRootIds: rootIdsRef.current })
        .then((res) => {
          rootIdsRef.current = res.mediaRootIds;
          setPhase((p) => (p.kind === "ready" ? { kind: "ready", path: res.path } : p));
          return true;
        })
        .catch((err: unknown) => {
          showToast(`Couldn't rename — ${toIpcErrorShape(err).message}`, "error");
          return false;
        }),
    [invoke, showToast],
  );

  // Closing the window with unsaved changes → cancel and ask (S12 state 12).
  useEffect(() => {
    if (!target || !ready) return;
    const onBeforeUnload = (e: Event) => {
      if (allowCloseRef.current || !history.isDirty()) return;
      e.preventDefault();
      (e as BeforeUnloadEvent).returnValue = "";
      setLeaveError(null);
      setLeave("close");
    };
    target.addEventListener("beforeunload", onBeforeUnload);
    return () => target.removeEventListener("beforeunload", onBeforeUnload);
  }, [target, ready, history]);

  const discardBackups = useCallback(async () => {
    if (phase.kind !== "ready") return;
    await invoke("project:discardBackups", { path: phase.path }).catch(() => null);
  }, [invoke, phase]);

  const onRestore = async () => {
    if (phase.kind !== "ready" || !recovery) return;
    setBusy(true);
    setRecoveryError(null);
    try {
      await restoreProjectBackup(phase.path, recovery.backupName, { invoke });
      history.clear();
      saverRef.current?.autosave.markClean();
      setRecovery(null);
      showToast("We restored your last session");
    } catch (err) {
      setRecoveryError(toIpcErrorShape(err).message);
    } finally {
      setBusy(false);
    }
  };

  const onDiscardRecovery = async () => {
    setBusy(true);
    await discardBackups();
    setBusy(false);
    setRecovery(null);
  };

  const onLeaveSave = async () => {
    if (!leave) return;
    setBusy(true);
    setLeaveError(null);
    const ok = await saveNow();
    setBusy(false);
    if (!ok) {
      const err = toIpcErrorShape(saverRef.current?.autosave.getStatus().lastError);
      setLeaveError(err.message);
      return;
    }
    const intent = leave;
    setLeave(null);
    proceed(intent);
  };

  const onLeaveDiscard = async () => {
    if (!leave) return;
    const intent = leave;
    setBusy(true);
    await discardBackups();
    setBusy(false);
    setLeave(null);
    proceed(intent);
  };

  if (phase.kind === "loading") {
    return (
      <output style={centerStyle} aria-live="polite">
        Opening project…
      </output>
    );
  }

  if (phase.kind === "not-found") {
    return (
      <div style={centerStyle}>
        <h1 style={headingStyle}>Project not found</h1>
        <p style={{ margin: 0, maxWidth: "44ch" }}>
          It may have been moved, renamed outside Reelform, or moved to the trash.
        </p>
        <Button variant="primary" onClick={() => void port.back()}>
          Back to projects
        </Button>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div style={centerStyle} role="alert">
        <h1 style={headingStyle}>Couldn't open this project</h1>
        <p style={{ margin: 0, maxWidth: "52ch" }}>{phase.error.message}</p>
        <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>
          {phase.error.code}
        </code>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={() => void port.back()}>
            Back to projects
          </Button>
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <EditorWindow
        projectName={projectName}
        onExport={onExport}
        createStage={createStage}
        history={history}
        dirty={dirty}
        onBack={() => requestLeave("back")}
        onRename={onRename}
        onLocateMedia={onLocateMedia}
        sourceDurationMs={sourceDurationMs}
        createInspectorHost={createInspectorHost}
      />

      <Dialog
        open={recovery !== null}
        // Escape / backdrop only dismisses: deleting backups needs the explicit Discard.
        onClose={() => {
          if (!busy) setRecovery(null);
        }}
        title="Crash recovered"
        actions={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void onDiscardRecovery()}>
              Discard
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void onRestore()}>
              Restore
            </Button>
          </>
        }
      >
        {recovery && (
          <p style={{ margin: 0 }}>
            Reelform closed before “{projectName}” was saved. We kept your last session (autosaved{" "}
            {formatWhen(recovery.backupSavedAt)}).
          </p>
        )}
        {recoveryError && (
          <p role="alert" style={{ margin: "var(--space-2) 0 0", color: "var(--danger)" }}>
            {recoveryError}
          </p>
        )}
      </Dialog>

      <Dialog
        open={leave !== null}
        onClose={() => setLeave(null)}
        title="Save changes?"
        actions={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setLeave(null)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void onLeaveDiscard()}>
              Don't save
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void onLeaveSave()}>
              Save
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          Your changes to “{projectName}” will be lost if you don't save them.
        </p>
        {leaveError && (
          <p role="alert" style={{ margin: "var(--space-2) 0 0", color: "var(--danger)" }}>
            {leaveError}
          </p>
        )}
      </Dialog>

      <AutoZoomSuggestionsToast
        suggestions={zoomSuggestions}
        documentUpdate={documentUpdate}
        seek={(ms) => usePlaybackStore.getState().seek(ms)}
        onClose={() => setZoomSuggestions([])}
      />

      {toast && (
        <div role={toast.tone === "error" ? "alert" : "status"} style={toastStyle}>
          {toast.text}
        </div>
      )}
    </>
  );
}
