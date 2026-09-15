import { Button, Dialog } from "@design/components";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../editor/store";
import { selectRoute } from "../../export/route";
import { ExportDialog } from "../../export/ui/ExportDialog";
import type { ExportUiConfig } from "../../export/ui/types";
import { useT } from "../../i18n";
import { useProjectSession } from "../project/session";
import { useAppSettings } from "../settings/store";
import { ExportOptions } from "./ExportOptions";
import { ExportDoneView, ExportProblemView, ExportProgressView, ExportToast } from "./ExportStatus";
import {
  type EncoderCapabilities,
  type EncoderCapabilityCache,
  NO_CAPABILITIES,
  hardwareCaps,
  sessionEncoderCapabilities,
  unsupportedCodecs,
} from "./capabilities";
import {
  type ExportFlowConfig,
  type TimeRange,
  defaultFlowConfig,
  estimateVideoBytes,
  formatBytes,
  gifDimensions,
  resolveRange,
  roughGifBytes,
  toEngineConfig,
  validateFlowConfig,
} from "./config";
import {
  type ExportBaseDeps,
  type ExportStoreSnapshot,
  createDefaultExportDeps,
} from "./defaultDeps";
import { ExportFlowError } from "./exportSink";
import {
  type ExportFlowPhase,
  type ExportRunner,
  type ExportRunnerDeps,
  FFMPEG_UNAVAILABLE,
  createExportRunner,
  progressPatchFor,
} from "./runner";
import type { SystemPort } from "./systemPort";
import { useExportProgress } from "./useExportProgress";

/**
 * Export flow controller (SPEC §10, guide S22 + S28). Owns one export runner per
 * editor window: dialog config → validate → route → run, with progress, cancel,
 * done / failed / low-disk / codec-unsupported panels and a background toast.
 *
 * Keep it mounted for the editor's lifetime: closing the dialog while an export
 * runs moves it to the background toast; unmounting cancels it.
 */

export interface ExportControllerProps {
  open: boolean;
  onClose(): void;
  systemPort: SystemPort;
  /** Re-open the dialog (toast "Details"). */
  onOpen?: (() => void) | undefined;
  /** Timeline selection / In–Out points, when the timeline has them. */
  selection?: TimeRange | null | undefined;
  inOut?: TimeRange | null | undefined;
  /** Test seam; defaults to the real WebCodecs / GIF worker / IPC deps. */
  createDeps?:
    | ((snapshot: ExportStoreSnapshot, base: ExportBaseDeps) => ExportRunnerDeps)
    | undefined;
  capabilities?: EncoderCapabilityCache | undefined;
  now?: (() => number) | undefined;
}

type CopyState = "idle" | "copied" | "path-copied" | "failed";

const PLACEHOLDER_SOURCE = { width: 1920, height: 1080 };

function toUiConfig(c: ExportFlowConfig): ExportUiConfig {
  return {
    format: c.format,
    width: c.width,
    height: c.height,
    fps: c.fps === 30 ? 30 : 60,
    codec: c.codec,
    quality: c.quality,
    destinationPath: c.destinationDir ?? "",
  };
}

export function ExportController(props: ExportControllerProps): ReactElement | null {
  const { open, onClose, systemPort } = props;
  const t = useT();
  const durationMs = useEditorStore((s) => s.durationMs);
  const captionCount = useEditorStore((s) => s.captions.length);
  const projectId = useProjectSession((s) => s.projectId);
  const projectName = useProjectSession((s) => s.meta?.name ?? null);
  const videoUrl = useProjectSession((s) => s.videoUrl);
  const mediaOffline = useProjectSession((s) => s.mediaOffline);
  const sourceSize = useProjectSession((s) => s.sourceSize);

  const [cache] = useState(() => props.capabilities ?? sessionEncoderCapabilities());
  const [caps, setCaps] = useState<EncoderCapabilities | null>(() => cache.peek());
  const [phase, setPhase] = useState<ExportFlowPhase>({ kind: "configuring" });
  const [config, setConfig] = useState<ExportFlowConfig>(() =>
    defaultFlowConfig(projectName ?? t("exportFlow.defaultFileName")),
  );
  const [attempted, setAttempted] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [toastDismissed, setToastDismissed] = useState(false);

  const propsRef = useRef(props);
  propsRef.current = props;
  const depsRef = useRef<ExportRunnerDeps | null>(null);
  const runnerRef = useRef<ExportRunner | null>(null);

  const requireDeps = (): ExportRunnerDeps => {
    if (!depsRef.current) throw new Error("export deps not built");
    return depsRef.current;
  };
  const now = (): number => (propsRef.current.now ?? Date.now)();

  if (!runnerRef.current) {
    runnerRef.current = createExportRunner({
      runVideo: (a) => requireDeps().runVideo(a),
      runGif: (a) => requireDeps().runGif(a),
      createSink: (t) => requireDeps().createSink(t),
      writeFile: (t, c, b) => requireDeps().writeFile(t, c, b),
      streamFile: (t, c, w) => requireDeps().streamFile(t, c, w),
      muxAudio: (r) => {
        const mux = requireDeps().muxAudio;
        if (!mux) {
          return Promise.reject(
            new ExportFlowError(FFMPEG_UNAVAILABLE, "ffmpeg is not available to mux audio"),
          );
        }
        return mux(r);
      },
      deleteRawSource: async () => {
        const removed = await requireDeps().deleteRawSource?.();
        // The editor's video is in the OS trash now: show it offline instead of a broken preview.
        const session = useProjectSession.getState();
        const video = session.meta?.sources.video.path;
        if (Array.isArray(removed) && video !== undefined && removed.includes(video)) {
          session.setSession({ mediaOffline: true });
        }
      },
      get system() {
        return propsRef.current.systemPort;
      },
      onChange: (p) => {
        setPhase(p);
        useExportProgress.getState().set(progressPatchFor(p));
        if (p.kind === "running") setToastDismissed(false);
      },
      now,
      environment: () => depsRef.current?.environment?.() ?? {},
    });
  }
  const runner = runnerRef.current;

  useEffect(() => () => runnerRef.current?.cancel(), []);

  useEffect(() => {
    if (projectName) setConfig((c) => ({ ...c, fileName: projectName }));
  }, [projectName]);

  useEffect(() => {
    if (!open || caps) return;
    let live = true;
    cache.get().then(
      (c) => live && setCaps(c),
      () => live && setCaps(NO_CAPABILITIES),
    );
    return () => {
      live = false;
    };
  }, [open, caps, cache]);

  const rangeSources = { durationMs, selection: props.selection, inOut: props.inOut };
  const validationContext = {
    range: rangeSources,
    caps,
    hasVideo: videoUrl !== null,
    mediaOffline,
    captionCount,
  };
  const issues = validateFlowConfig(config, validationContext);

  const buildDeps = (): void => {
    const snapshot: ExportStoreSnapshot = {
      editor: useEditorStore.getState(),
      session: useProjectSession.getState(),
    };
    const base: ExportBaseDeps = { system: systemPort, onChange: () => undefined, now };
    depsRef.current = (props.createDeps ?? createDefaultExportDeps)(snapshot, base);
  };

  const startExport = (merged: ExportFlowConfig): void => {
    setAttempted(true);
    if (!projectId || validateFlowConfig(merged, validationContext).length > 0) return;
    const range = resolveRange(merged.range, rangeSources);
    if (!range) return;
    const editor = useEditorStore.getState();
    const session = useProjectSession.getState();
    const { gpuExport, autoDeleteRawAfterExport } = useAppSettings.getState().settings;
    let preferHardware = merged.hardwareAcceleration;
    let notice: string | null = null;
    if (merged.format !== "gif" && gpuExport === "off") {
      // Settings → Advanced → GPU export: off forces the software encoder.
      if (preferHardware) notice = t("exportFlow.notice.gpuOff");
      preferHardware = false;
    } else if (merged.format !== "gif" && caps) {
      const route = selectRoute(
        toEngineConfig(merged),
        {
          hasZooms: editor.zoomRegions.length > 0,
          hasCursor: session.cursorTrack !== null,
          hasAnnotations: editor.annotations.length > 0,
          hasWebcam: session.webcamUrl !== null,
          hasCaptions: merged.captions === "burn-in",
          hasSpeeds: editor.speedRegions.length > 0,
        },
        hardwareCaps(caps),
        { gpuExport },
      );
      // `native-static` (ffmpeg fast path) isn't bundled in this build; it runs on WebCodecs.
      if (route === "software-fallback" && preferHardware) {
        preferHardware = false;
        notice = t("exportFlow.notice.hardwareUnavailable");
      }
    }
    buildDeps();
    setCopyState("idle");
    setDiagnosticsCopied(false);
    void runner.start({
      config: merged,
      projectId,
      range,
      sourceSize: session.sourceSize ?? PLACEHOLDER_SOURCE,
      preferHardware,
      notice,
      captions: editor.captions,
      speeds: editor.speedRegions,
      deleteRawAfterExport: autoDeleteRawAfterExport,
    });
  };

  const onDialogExport = (ui: ExportUiConfig): void => {
    const merged: ExportFlowConfig = {
      ...config,
      format: ui.format,
      width: ui.width,
      height: ui.height,
      fps: ui.fps,
      codec: ui.codec,
      quality: ui.quality,
    };
    setConfig(merged);
    startExport(merged);
  };

  const patch = (p: Partial<ExportFlowConfig>): void => setConfig((c) => ({ ...c, ...p }));

  const pickFolder = async (): Promise<boolean> => {
    const dir = await systemPort
      .pickFolder({ title: t("exportFlow.pickFolderTitle") })
      .catch(() => null);
    if (dir) patch({ destinationDir: dir });
    return dir !== null;
  };

  const reveal = (): void => {
    const p = runner.phase();
    const path = p.kind === "done" ? p.path : useExportProgress.getState().path;
    if (path) void systemPort.reveal(path).catch(() => undefined);
  };

  const copy = async (): Promise<void> => {
    const p = runner.phase();
    const path = p.kind === "done" ? p.path : useExportProgress.getState().path;
    if (!path) return;
    try {
      await systemPort.clipboardWriteFile(path);
      setCopyState("copied");
    } catch {
      try {
        await systemPort.copyText(path);
        setCopyState("path-copied");
      } catch {
        setCopyState("failed");
      }
    }
  };

  const retrySoftware = (): void => {
    if (!runner.lastRequest()) return;
    buildDeps();
    void runner.retrySoftware();
  };

  const backToSettings = (): void => {
    runner.reset();
    setAttempted(false);
  };

  const closeDialog = (): void => {
    if (phase.kind !== "running") backToSettings();
    onClose();
  };

  // ── Background: toast only ────────────────────────────────────────────────
  if (!open) {
    if (toastDismissed || phase.kind === "configuring" || phase.kind === "cancelled") return null;
    return (
      <ExportToast
        onCancel={() => runner.cancel()}
        onReveal={reveal}
        onCopy={() => void copy()}
        onRetry={() => {
          const p = runner.phase();
          if (p.kind === "failed" && p.canRetrySoftware) retrySoftware();
          else props.onOpen?.();
        }}
        onDetails={() => props.onOpen?.()}
        onDismiss={() => {
          setToastDismissed(true);
          if (phase.kind !== "running") backToSettings();
        }}
      />
    );
  }

  // ── Empty state: no project open ──────────────────────────────────────────
  if (!projectId) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={t("exportFlow.title")}
        actions={
          <Button variant="primary" onClick={onClose}>
            {t("exportFlow.close")}
          </Button>
        }
      >
        <div
          data-testid="export-empty"
          style={{ fontFamily: "var(--font-body)", color: "var(--text-2)" }}
        >
          {t("exportFlow.empty")}
        </div>
      </Dialog>
    );
  }

  switch (phase.kind) {
    case "running":
      return (
        <Dialog open={open} onClose={onClose} title={t("exportFlow.title.running")}>
          <ExportProgressView
            phase={phase}
            onCancel={() => runner.cancel()}
            onBackground={onClose}
          />
        </Dialog>
      );
    case "done":
      return (
        <Dialog open={open} onClose={closeDialog} title={t("exportFlow.title")}>
          <ExportDoneView
            phase={phase}
            copyState={copyState}
            onReveal={reveal}
            onCopy={() => void copy()}
            onExportAnother={backToSettings}
            onClose={closeDialog}
          />
        </Dialog>
      );
    case "failed":
    case "low-disk":
    case "codec-unsupported":
      return (
        <Dialog open={open} onClose={closeDialog} title={t("exportFlow.title")}>
          <ExportProblemView
            phase={phase}
            diagnosticsCopied={diagnosticsCopied}
            onRetrySoftware={retrySoftware}
            onRetry={() => startExport(config)}
            onChooseFolder={() => {
              void pickFolder().then((picked) => {
                if (picked) backToSettings();
              });
            }}
            onCopyDiagnostics={() => {
              void runner.copyDiagnostics().then(
                () => setDiagnosticsCopied(true),
                () => setDiagnosticsCopied(false),
              );
            }}
            onBack={backToSettings}
          />
        </Dialog>
      );
    case "configuring":
    case "cancelled":
      break;
  }

  // ── Configuring ───────────────────────────────────────────────────────────
  const range = resolveRange(config.range, rangeSources);
  const rangeMs = range ? range.endMs - range.startMs : Math.max(0, durationMs);
  const gifSize = gifDimensions(config.gif.sizePreset, sourceSize ?? PLACEHOLDER_SOURCE);
  const sizeEstimate = formatBytes(
    config.format === "gif"
      ? roughGifBytes(
          gifSize.width,
          gifSize.height,
          config.gif.fps,
          config.gif.colors,
          rangeMs,
          config.gif.palette,
        )
      : estimateVideoBytes(config, rangeMs),
  );
  const shownIssues = issues
    .filter((i) => attempted || i.field === "codec" || i.field === "source")
    .map((i) => i.message);

  return (
    <ExportDialog
      open={open}
      durationMs={rangeMs}
      initialConfig={toUiConfig(config)}
      phase="idle"
      onExport={onDialogExport}
      onCancel={closeDialog}
      onClose={closeDialog}
      onChangeDestination={() => void pickFolder()}
      onConfigChange={(ui) =>
        patch({
          format: ui.format,
          width: ui.width,
          height: ui.height,
          fps: ui.fps,
          codec: ui.codec,
          quality: ui.quality,
        })
      }
      unsupportedCodecs={unsupportedCodecs(caps)}
      destinationPath={config.destinationDir ?? t("exportFlow.defaultDestination")}
      sizeEstimate={sizeEstimate}
      issues={shownIssues}
      exportDisabled={issues.length > 0}
    >
      {caps === null && config.format !== "gif" ? (
        <output
          style={{
            display: "block",
            fontFamily: "var(--font-body)",
            color: "var(--text-3)",
            marginBottom: "var(--space-3)",
          }}
        >
          {t("exportFlow.checkingEncoders")}
        </output>
      ) : null}
      {phase.kind === "cancelled" ? (
        <output
          style={{
            display: "block",
            fontFamily: "var(--font-body)",
            color: "var(--text-2)",
            marginBottom: "var(--space-3)",
          }}
        >
          {t("exportFlow.cancelled")}
        </output>
      ) : null}
      <ExportOptions
        config={config}
        onChange={patch}
        hasSelection={resolveRange("selection", rangeSources) !== null}
        hasInOut={resolveRange("in-out", rangeSources) !== null}
        hasCaptions={captionCount > 0}
      />
    </ExportDialog>
  );
}
