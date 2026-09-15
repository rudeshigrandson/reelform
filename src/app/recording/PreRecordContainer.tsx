import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HudChips, PreRecordHud, PreRecordMenuPanel } from "../../hud/PreRecordHud";
import {
  HUD_GAP,
  type HudPopover,
  PILL_HEIGHT,
  PILL_WIDTH,
  hudExpansionSize,
} from "../../hud/layout";
import type {
  HudChip,
  PreRecordHudProps,
  PreRecordMenu,
  PreRecordMode,
  PreRecordOptions,
} from "../../hud/types";
import { SourcePicker } from "../../launcher/SourcePicker";
import { effectiveDeviceId, effectiveSourceId, modeForPick } from "../../launcher/selection";
import type { LauncherDefaults, RecordOptions } from "../../launcher/types";
import type { Platform } from "../../recording/constraints";
import {
  type DeviceLike,
  type IntervalTimers,
  SOURCES_REFRESH_MS,
  toDeviceLists,
} from "./LauncherContainer";
import type { RecordingBus, SnapshotPhase } from "./bus";
import {
  FALLBACK_CAPTURE_COPY,
  SYSTEM_AUDIO_UNSUPPORTED_COPY,
  systemAudioSupported,
  toPickerSources,
  usesFallbackCapture,
} from "./document";
import type { HudLayoutInfo, HudWindowsPort, SourcesResult } from "./port";

/**
 * Pre-record mode of the HUD window (guide S05/S06, SPEC §5.7). Owns the
 * choices; the launcher-hosted recording flow does the work: Record posts a
 * `startRequest` on the bus and the flow runs exactly what the launcher's
 * Record runs (region → overlays first). Progress comes back as bus snapshots.
 *
 * Menus, the source picker and warning chips need more than the 560×64 window,
 * so the window grows around the pill via `setHudExpansion` (pill anchored).
 */

export interface MicLevelHandlers {
  onLevel: (level: number) => void;
  /** The device went away mid-preview. */
  onEnded: () => void;
}

export interface HudTimers extends IntervalTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PreRecordDeps {
  listSources(): Promise<SourcesResult>;
  enumerateDevices(): Promise<DeviceLike[]>;
  /** Live mic meter for a device ("" = default). Resolves a stop function; rejects on device errors. */
  openMicLevel?:
    | ((deviceId: string, handlers: MicLevelHandlers) => Promise<() => void>)
    | undefined;
  windows?: HudWindowsPort | undefined;
  platform: Platform;
  defaults?: LauncherDefaults | undefined;
  timers?: HudTimers | undefined;
  refreshIntervalMs?: number | undefined;
  /** How long to wait for the launcher to acknowledge a start. */
  startTimeoutMs?: number | undefined;
}

export interface PreRecordContainerProps {
  deps: PreRecordDeps;
  bus?: RecordingBus | undefined;
  /** Latest flow snapshot phase from the launcher (null = no live session). */
  flowPhase: SnapshotPhase | null;
  /** Filled with the Record action so the `record.toggle` shortcut can start. */
  startRef?: MutableRefObject<(() => void) | null> | undefined;
  hideHudWhileRecording: boolean;
  onHideHudWhileRecordingChange: (hide: boolean) => void;
}

export const START_TIMEOUT_MS = 3000;

export const defaultHudTimers: HudTimers = {
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const errorMessage = (err: unknown, fallback: string): string =>
  err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
    ? (err as { message: string }).message
    : fallback;

export function recordShortcutLabel(platform: Platform): string {
  return platform === "darwin" ? "⌘⇧R" : "Ctrl+Shift+R";
}

type StartState = "idle" | "requested" | "acknowledged";

export function PreRecordContainer({
  deps,
  bus,
  flowPhase,
  startRef,
  hideHudWhileRecording,
  onHideHudWhileRecordingChange,
}: PreRecordContainerProps) {
  const timers = deps.timers ?? defaultHudTimers;
  const intervalMs = deps.refreshIntervalMs ?? SOURCES_REFRESH_MS;
  const defaults = deps.defaults;

  const [sources, setSources] = useState<SourcesResult | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceLike[] | null>(null);
  const [mode, setMode] = useState<PreRecordMode>(defaults?.mode ?? "screen");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(defaults?.mic ?? false);
  const [micPick, setMicPick] = useState(defaults?.micDeviceId ?? "");
  const [micLevel, setMicLevel] = useState<number | undefined>(undefined);
  const [micError, setMicError] = useState<string | null>(null);
  const [systemAudio, setSystemAudio] = useState(defaults?.systemAudio ?? false);
  const [cameraOn, setCameraOn] = useState(defaults?.webcam ?? false);
  const [cameraPick, setCameraPick] = useState(defaults?.webcamDeviceId ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [options, setOptions] = useState<Omit<PreRecordOptions, "hideHudWhileRecording">>({
    countdown: defaults?.countdown ?? 3,
    hideCursor: defaults?.hideCursor ?? false,
    fps: defaults?.fps ?? 30,
  });
  const [popover, setPopover] = useState<HudPopover | null>(null);
  const [layout, setLayout] = useState<HudLayoutInfo | null>(null);
  const [startState, setStartState] = useState<StartState>("idle");
  const [startError, setStartError] = useState<HudChip | null>(null);
  const mounted = useRef(true);
  const lastFlowPhase = useRef<SnapshotPhase | null>(flowPhase);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- data -------------------------------------------------------------------

  const refreshSources = useCallback(async () => {
    try {
      const next = await deps.listSources();
      if (!mounted.current) return;
      setSources(next);
      setSourcesError(null);
    } catch (err) {
      if (mounted.current) setSourcesError(errorMessage(err, "Couldn't list screens and windows."));
    }
  }, [deps]);

  const refreshDevices = useCallback(async () => {
    try {
      const next = await deps.enumerateDevices();
      if (mounted.current) setDevices(next);
    } catch {
      // Keep the last known list; device errors surface through the meter.
    }
  }, [deps]);

  useEffect(() => {
    void refreshSources();
    void refreshDevices();
    // Device lists stay current so a disconnected mic/camera shows its chip.
    const handle = timers.setInterval(() => void refreshDevices(), intervalMs);
    return () => timers.clearInterval(handle);
  }, [refreshSources, refreshDevices, timers, intervalMs]);

  // Live thumbnails: refresh every 2 s while the picker is open (S06).
  const pickerOpen = popover === "picker";
  useEffect(() => {
    if (!pickerOpen) return;
    void refreshSources();
    const handle = timers.setInterval(() => void refreshSources(), intervalMs);
    return () => timers.clearInterval(handle);
  }, [pickerOpen, refreshSources, timers, intervalMs]);

  const pickerSources = useMemo(() => toPickerSources(sources), [sources]);
  const lists = useMemo(() => toDeviceLists(devices ?? []), [devices]);
  const micDeviceId = effectiveDeviceId(lists.mic, micPick);
  const cameraDeviceId = effectiveDeviceId(lists.webcam, cameraPick);
  const sourceId = effectiveSourceId(pickerSources, mode, selectedId);
  const backend = sources?.backend ?? null;
  const audioSupported = systemAudioSupported(deps.platform, backend);

  // ---- mic meter ------------------------------------------------------------------

  const openMicLevel = deps.openMicLevel;
  useEffect(() => {
    setMicLevel(undefined);
    setMicError(null);
    if (!micOn || !openMicLevel) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    openMicLevel(micDeviceId, {
      onLevel: (level) => {
        if (!cancelled) setMicLevel(level);
      },
      onEnded: () => {
        if (!cancelled) {
          setMicLevel(undefined);
          setMicError("Microphone disconnected");
        }
      },
    }).then(
      (s) => {
        if (cancelled) s();
        else stop = s;
      },
      (err: unknown) => {
        if (!cancelled)
          setMicError(`Microphone unavailable — ${errorMessage(err, "pick another")}`);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [micOn, micDeviceId, openMicLevel]);

  // ---- start acknowledgement --------------------------------------------------------

  useEffect(() => {
    const prev = lastFlowPhase.current;
    lastFlowPhase.current = flowPhase;
    if (flowPhase !== null) {
      setStartState((s) => (s === "requested" ? "acknowledged" : s));
      setStartError(null);
      return;
    }
    // A start the flow accepted ended without a session: it failed (region cancel is not an error).
    if (prev === "starting") {
      setStartError({
        id: "start",
        tone: "danger",
        message: "Recording didn't start — see the Reelform launcher for details.",
      });
    }
    setStartState((s) => (s === "acknowledged" ? "idle" : s));
  }, [flowPhase]);

  const startTimeoutMs = deps.startTimeoutMs ?? START_TIMEOUT_MS;
  useEffect(() => {
    if (startState !== "requested") return;
    const handle = timers.setTimeout(() => {
      if (!mounted.current) return;
      setStartState("idle");
      setStartError({
        id: "start",
        tone: "danger",
        message: "Couldn't reach the Reelform launcher. Open it and try again.",
      });
    }, startTimeoutMs);
    return () => timers.clearTimeout(handle);
  }, [startState, timers, startTimeoutMs]);

  // ---- chips ------------------------------------------------------------------------

  const chips: HudChip[] = [];
  if (usesFallbackCapture(deps.platform, backend)) {
    chips.push({ id: "fallback", tone: "warning", message: FALLBACK_CAPTURE_COPY });
  }
  if (micOn) {
    if (micError) chips.push({ id: "mic", tone: "warning", message: micError });
    else if (devices && micPick && !lists.mic.some((d) => d.id === micPick)) {
      const fallback = lists.mic.find((d) => d.id === micDeviceId);
      chips.push({
        id: "mic",
        tone: "warning",
        message: fallback
          ? `Microphone disconnected — using ${fallback.label}`
          : "Microphone disconnected",
      });
    }
  }
  if (cameraOn && devices && cameraPick && !lists.webcam.some((d) => d.id === cameraPick)) {
    chips.push({ id: "camera", tone: "warning", message: "Camera disconnected" });
  }
  if (sourcesError) chips.push({ id: "sources", tone: "danger", message: sourcesError });
  if (startError) chips.push(startError);

  // ---- window growth ----------------------------------------------------------------

  const windows = deps.windows;
  const expansion = hudExpansionSize(popover, chips.length);
  const expansionKey = expansion ? `${expansion.width}x${expansion.height}` : "";
  const requestSeq = useRef(0);
  useEffect(() => {
    if (!windows) return;
    const seq = ++requestSeq.current;
    const size = expansionKey
      ? { width: Number(expansionKey.split("x")[0]), height: Number(expansionKey.split("x")[1]) }
      : null;
    windows.setHudExpansion(size).then(
      (next) => {
        if (mounted.current && seq === requestSeq.current) setLayout(next);
      },
      () => {
        if (mounted.current && seq === requestSeq.current) setLayout(null);
      },
    );
  }, [windows, expansionKey]);

  useEffect(
    () => () => {
      // Leaving pre-record (recording started): back to the bare pill window.
      if (windows) void windows.setHudExpansion(null).catch(() => {});
    },
    [windows],
  );

  // ---- actions ----------------------------------------------------------------------

  const busy = startState === "requested" || flowPhase !== null;
  const busyLabel =
    flowPhase === "selectingRegion"
      ? "Selecting region…"
      : busy
        ? flowPhase === "finalizing"
          ? "Processing recording…"
          : "Starting…"
        : undefined;

  const record = (): void => {
    if (!bus || busy || sourceId === null) return;
    const setup: RecordOptions = {
      sourceId,
      mode,
      mic: micOn,
      systemAudio: audioSupported && systemAudio,
      webcam: cameraOn,
      fps: options.fps,
      countdown: options.countdown,
      hideCursor: options.hideCursor,
      ...(micOn && micDeviceId ? { micDeviceId } : {}),
      ...(cameraOn && cameraDeviceId ? { webcamDeviceId: cameraDeviceId } : {}),
    };
    setPopover(null);
    setStartError(null);
    setStartState("requested");
    bus.post({ type: "startRequest", setup });
  };
  if (startRef) startRef.current = record;

  const selected = pickerSources.find((s) => s.id === sourceId);
  const sourceLabel = !selected
    ? sources
      ? mode === "window"
        ? "No windows"
        : "No displays"
      : "Finding sources…"
    : mode === "region"
      ? `Region on ${selected.name}`
      : selected.name;

  const hudProps: PreRecordHudProps = {
    mode,
    onModeChange: setMode,
    sourceLabel,
    onOpenSourcePicker: () => setPopover((p) => (p === "picker" ? null : "picker")),
    sourcePickerOpen: pickerOpen,
    micOn,
    micDeviceId,
    micDevices: lists.mic,
    micLevel,
    onMicChange: (id) => {
      if (id === null) setMicOn(false);
      else {
        setMicPick(id);
        setMicOn(true);
      }
    },
    systemAudio,
    systemAudioSupported: audioSupported,
    systemAudioNote: SYSTEM_AUDIO_UNSUPPORTED_COPY,
    onSystemAudioChange: setSystemAudio,
    cameraOn,
    cameraDeviceId,
    cameraDevices: lists.webcam,
    onCameraChange: (id) => {
      if (id === null) {
        setCameraOn(false);
        if (previewOpen) {
          setPreviewOpen(false);
          void windows?.closeKind("webcam-bubble").catch(() => {});
        }
      } else {
        setCameraPick(id);
        setCameraOn(true);
      }
    },
    onShowPreview: () => {
      setCameraOn(true);
      setPreviewOpen(true);
      void windows?.openWebcamBubble().catch(() => {});
    },
    options: { ...options, hideHudWhileRecording },
    onOptionsChange: ({ hideHudWhileRecording: hide, ...rest }) => {
      if (hide !== undefined) onHideHudWhileRecordingChange(hide);
      if (Object.keys(rest).length > 0) setOptions((o) => ({ ...o, ...rest }));
    },
    onOpenSettings: windows ? () => void windows.openSettings().catch(() => {}) : undefined,
    onRecord: record,
    recordDisabled: !bus || busy || sourceId === null,
    busyLabel,
    recordShortcut: recordShortcutLabel(deps.platform),
    openMenu: popover === "picker" ? null : popover,
    onMenuChange: (menu: PreRecordMenu | null) => setPopover(menu),
  };

  const popoverNode =
    popover === "picker" ? (
      <SourcePicker
        sources={pickerSources}
        status={sourcesError ? "error" : sources ? "ready" : "loading"}
        error={sourcesError ?? undefined}
        selectedId={sourceId}
        initialTab={mode === "window" ? "windows" : "displays"}
        onCancel={() => setPopover(null)}
        onSelect={(source) => {
          setMode(modeForPick(mode, source.kind));
          setSelectedId(source.id);
          setPopover(null);
        }}
      />
    ) : popover ? (
      <PreRecordMenuPanel {...hudProps} />
    ) : null;

  const pill = <PreRecordHud {...hudProps} />;
  const chipsNode = <HudChips chips={chips} />;
  const overlay =
    popoverNode || chips.length > 0 ? (
      <div
        data-testid="hud-overlay"
        style={{
          display: "flex",
          flexDirection: layout?.placement === "below" ? "column" : "column-reverse",
          alignItems: "center",
          gap: HUD_GAP,
        }}
      >
        {chipsNode}
        {popoverNode}
      </div>
    ) : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && popover) setPopover(null);
  };

  if (!layout) {
    return (
      <div data-testid="hud-stage" data-expanded="false" onKeyDown={onKeyDown}>
        {pill}
        {overlay}
      </div>
    );
  }

  const { pillOffset, bounds, placement } = layout;
  const overlayStyle: React.CSSProperties =
    placement === "above"
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: Math.max(0, pillOffset.y - HUD_GAP),
        }
      : {
          position: "absolute",
          left: 0,
          right: 0,
          top: pillOffset.y + PILL_HEIGHT + HUD_GAP,
          bottom: 0,
        };
  return (
    <div
      data-testid="hud-stage"
      data-expanded="true"
      data-placement={placement}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Clicking the transparent grown area dismisses the popover.
        if (e.target === e.currentTarget) setPopover(null);
      }}
      style={{ position: "relative", width: bounds.width, height: bounds.height }}
    >
      <div
        data-testid="hud-pill-slot"
        style={{
          position: "absolute",
          left: pillOffset.x,
          top: pillOffset.y,
          width: PILL_WIDTH,
          height: PILL_HEIGHT,
        }}
      >
        {pill}
      </div>
      {overlay ? (
        <div
          style={{
            ...overlayStyle,
            display: "flex",
            flexDirection: "column",
            justifyContent: placement === "above" ? "flex-end" : "flex-start",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{overlay}</div>
        </div>
      ) : null}
    </div>
  );
}
