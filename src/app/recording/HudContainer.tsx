import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { HIDDEN_DOT_SIZE, type HudView, hudPillSize } from "../../hud/layout";
import type { RecordingHudProps } from "../../hud/types";
import type { RecordOptions } from "../../launcher/types";
import type { RecordingEvent, RecordingPort } from "../../recording/port";
import {
  type RecordingSessionStore,
  createRecordingSessionStore,
  selectHudProps,
  warningCopy,
} from "../../recording/sessionStore";
import { PreRecordContainer, type PreRecordDeps } from "./PreRecordContainer";
import { RecordingHudContainer } from "./RecordingHudContainer";
import type { RecordingBus, SessionSnapshot, SnapshotPhase } from "./bus";
import { createBrowserPreRecordDeps } from "./hudDeps";
import {
  type ShortcutSubscribe,
  bridgeShortcutSubscribe,
  hudShortcutAction,
  isTypingTarget,
} from "./hudShortcuts";
import {
  type FrameWait,
  type ResizeSubscribe,
  type Shift,
  planShift,
  runHudTransition,
} from "./hudTransition";
import type { HudWindowsPort } from "./port";

/**
 * HUD window container (guide S10, SPEC §5.7). Binds the recording pill to a
 * recording session store fed by `recording:event`:
 * - timer from main `stats`, pause/resume, stop, discard (confirm next to the pill),
 * - mic meter from the launcher's renderer meter over the bus (Electron
 *   backend) or helper RMS in `stats` (native),
 * - interrupted ("Recording saved up to 00:42") and disk-low warning states,
 * - overflow: Restart (discard, then start again with the same setup), Hide
 *   pill (the 20px dot), Mute mic (`hud:setMicMuted` on the bus).
 *
 * The HUD is a separate window opened without a session id: it adopts the
 * session from the launcher's bus snapshot or the first live event. With no
 * live session it shows the S05 pre-record pill ({@link PreRecordContainer}).
 *
 * The window is sized to what it shows (560×64 pre-record, 300×48 recording,
 * 36×36 hidden dot) through the prepare → paint → commit handshake.
 *
 * Global shortcuts (`shortcuts:triggered`): record.toggle → stop (start in
 * pre-record), record.pause → pause/resume, record.cancelCountdown → discard
 * during the countdown; ignored while focus is in a text field.
 */

export interface HudContainerProps {
  port: RecordingPort;
  bus?: RecordingBus | undefined;
  /** Defaults to a store private to this container. */
  store?: RecordingSessionStore | undefined;
  sessionId?: string | undefined;
  sourceLabel?: string | undefined;
  /** Pre-record pill deps; defaults to the Electron bindings (null outside Electron = no pill). */
  preRecord?: PreRecordDeps | null | undefined;
  /** HUD window port for pill sizing; defaults to the pre-record deps' port. */
  windows?: HudWindowsPort | undefined;
  frames?: FrameWait | undefined;
  onResize?: ResizeSubscribe | undefined;
  /** Global shortcut broadcasts; defaults to `window.reelform.on("shortcuts:triggered")`. */
  onShortcut?: ShortcutSubscribe | undefined;
  /** Focused element (typing check); defaults to `document.activeElement`. */
  activeElement?: (() => Element | null) | undefined;
}

const ADOPTABLE: ReadonlySet<RecordingEvent["type"]> = new Set([
  "countdown",
  "started",
  "paused",
  "resumed",
  "stats",
  "stopped",
  "interrupted",
]);

/** Replay a snapshot into a freshly attached store (HUD opened mid-session). */
function applySnapshot(store: RecordingSessionStore, snap: SessionSnapshot): void {
  const s = store.getState();
  const id = snap.sessionId;
  if (!id) return;
  if (snap.phase === "countdown" && snap.countdownRemaining !== null) {
    s.handleEvent({ sessionId: id, type: "countdown", remaining: snap.countdownRemaining });
  } else if (snap.phase === "recording" || snap.phase === "paused" || snap.phase === "finalizing") {
    s.handleEvent({ sessionId: id, type: "started", backend: "" });
    if (snap.phase === "paused") s.handleEvent({ sessionId: id, type: "paused", elapsedMs: 0 });
    if (snap.phase === "finalizing") {
      s.handleEvent({ sessionId: id, type: "stopped", elapsedMs: 0, reason: "user" });
    }
  }
}

const sizeKeyOf = (view: HudView | null): string => {
  if (!view) return "";
  const s = hudPillSize(view);
  return `${s.width}x${s.height}`;
};

const parseKey = (key: string) => {
  const [width, height] = key.split("x").map(Number);
  return { width: width ?? 0, height: height ?? 0 };
};

export function HudContainer({
  port,
  bus,
  store: injected,
  sessionId,
  sourceLabel,
  preRecord: preRecordProp,
  windows: windowsProp,
  frames: framesProp,
  onResize: onResizeProp,
  onShortcut = bridgeShortcutSubscribe,
  activeElement = () => (typeof document === "undefined" ? null : document.activeElement),
}: HudContainerProps) {
  const [store] = useState<RecordingSessionStore>(() => injected ?? createRecordingSessionStore());
  const [label, setLabel] = useState(sourceLabel ?? "");
  const [browserDeps] = useState<PreRecordDeps | null | undefined>(() =>
    preRecordProp === undefined ? createBrowserPreRecordDeps() : undefined,
  );
  const preRecord = preRecordProp === undefined ? (browserDeps ?? null) : preRecordProp;
  const hudWindows = windowsProp ?? preRecord?.windows;
  const frames = framesProp ?? preRecord?.frames;
  const onResize = onResizeProp ?? preRecord?.onResize;
  const [flowPhase, setFlowPhase] = useState<SnapshotPhase | null>(null);
  const [hideWhileRecording, setHideWhileRecording] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const startRef = useRef<(() => void) | null>(null);
  const lastSetup = useRef<RecordOptions | null>(null);
  const pendingRestart = useRef<RecordOptions | null>(null);
  const mounted = useRef(true);
  const useSession = store;
  const state = useSession();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (sessionId) store.getState().attach(port, sessionId);
    const adopt = (id: string): boolean => {
      const cur = store.getState();
      // A finished or discarded session gives way to the next one (Restart, Record again).
      if (
        cur.sessionId &&
        (cur.sessionId === id || (cur.phase !== "discarded" && cur.phase !== "done"))
      )
        return false;
      cur.attach(port, id);
      return true;
    };
    const offPort = port.subscribe((e) => {
      const cur = store.getState();
      if (e.sessionId !== cur.sessionId && ADOPTABLE.has(e.type) && adopt(e.sessionId)) {
        store.getState().handleEvent(e);
      }
    });
    const offBus = bus?.subscribe((m) => {
      const s = store.getState();
      switch (m.type) {
        case "snapshot": {
          setFlowPhase(m.snapshot?.phase ?? null);
          const restart = pendingRestart.current;
          if (!m.snapshot) {
            // The discarded session is gone in the flow: start again with the same setup.
            if (restart) {
              pendingRestart.current = null;
              store.getState().reset();
              bus.post({ type: "startRequest", setup: restart });
            }
            return;
          }
          if (m.snapshot.setup) lastSetup.current = m.snapshot.setup;
          if (m.snapshot.sourceLabel && !sourceLabel) setLabel(m.snapshot.sourceLabel);
          if (m.snapshot.sessionId && adopt(m.snapshot.sessionId)) applySnapshot(store, m.snapshot);
          return;
        }
        case "micLevel":
          if (m.sessionId === s.sessionId && (s.phase === "recording" || s.phase === "paused")) {
            s.setMicLevel(s.phase === "paused" ? 0 : m.level);
          }
          return;
        case "warning":
          if (m.sessionId === s.sessionId) s.setWarning(warningCopy(m.code));
          return;
        default:
          return;
      }
    });
    bus?.post({ type: "snapshotRequest" });
    return () => {
      offPort();
      offBus?.();
      store.getState().detach();
    };
  }, [port, bus, store, sessionId, sourceLabel]);

  const props = selectHudProps(state, label);
  const livePhase = props?.phase ?? null;
  const showPreRecord = !props && preRecord !== null;

  // Latest values for the shortcut listener without resubscribing each render.
  const shortcutState = useRef({ livePhase, showPreRecord, activeElement });
  shortcutState.current = { livePhase, showPreRecord, activeElement };
  useEffect(
    () =>
      onShortcut((id) => {
        const cur = shortcutState.current;
        if (isTypingTarget(cur.activeElement())) return;
        const phase = cur.livePhase ?? (cur.showPreRecord ? "prerecord" : null);
        const s = store.getState();
        switch (hudShortcutAction(id, phase)) {
          case "stop":
            void s.stop();
            return;
          case "pauseToggle":
            void s.pauseToggle();
            return;
          case "discard":
            void s.discard();
            return;
          case "start":
            startRef.current?.();
            return;
          default:
            return;
        }
      }),
    [onShortcut, store],
  );

  // A new recording shows the pill again unless the user hides it.
  const recordingLike = livePhase === "recording" || livePhase === "paused";
  useEffect(() => {
    if (!recordingLike) setHidden(false);
    else if (hideWhileRecording) setHidden(true);
  }, [recordingLike, hideWhileRecording]);

  // Mute is per session: a new session starts unmuted.
  const currentSession = state.sessionId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the session changes
  useEffect(() => {
    setMicMuted(false);
  }, [currentSession]);

  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;
  const toggleMute = useCallback(() => {
    // Side effect outside the state updater (updaters may run twice).
    const muted = !micMutedRef.current;
    micMutedRef.current = muted;
    setMicMuted(muted);
    bus?.post({ type: "hud:setMicMuted", muted });
  }, [bus]);

  const restart = useCallback(() => {
    const setup = lastSetup.current;
    if (!bus || !setup) return;
    pendingRestart.current = setup;
    void store.getState().discard();
  }, [bus, store]);

  // ---- window size ------------------------------------------------------------------

  const view: HudView | null = props
    ? recordingLike && hidden
      ? "hidden"
      : props.phase === "interrupted"
        ? "interrupted"
        : "recording"
    : showPreRecord
      ? "prerecord"
      : null;
  const sizeKey = sizeKeyOf(view);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [sizeShift, setSizeShift] = useState<Shift | null>(null);
  const wantedSize = useRef(sizeKey);
  wantedSize.current = sizeKey;
  /**
   * Where the pill sits inside the window as it is on screen now: a child grew
   * it for a menu, chips or a confirm (null: the window is the bare pill).
   */
  const pillOffset = useRef<Shift | null>(null);
  const onPillOffsetChange = useCallback((offset: Shift | null) => {
    pillOffset.current = offset;
  }, []);
  useEffect(() => {
    if (!hudWindows || !sizeKey) return;
    const key = sizeKey;
    const { width, height } = parseKey(key);
    void runHudTransition(
      { windows: hudWindows, frames, onResize },
      {
        isCurrent: () => mounted.current && wantedSize.current === key,
        prepare: () => hudWindows.setHudSize({ width, height, anchor: "center" }),
        apply: (plan) => {
          if (!mounted.current) return;
          setReadyKey(key);
          setSizeShift(plan ? planShift(plan) : null);
        },
        settle: () => {
          // A pill resize also collapses any growth around the pill.
          pillOffset.current = null;
          if (mounted.current) flushSync(() => setSizeShift(null));
        },
      },
    );
  }, [hudWindows, sizeKey, frames, onResize]);

  const windowReady = !hudWindows || readyKey === sizeKey;
  // Until main answers, draw the new content centred on the old pill (which may
  // sit inside a window grown for a menu or chips) so it doesn't jump.
  const offsetNow = pillOffset.current;
  const shift = useMemo<Shift | null>(() => {
    if (!hudWindows) return null;
    if (windowReady || readyKey === null || !sizeKey) return sizeShift;
    const from = parseKey(readyKey);
    const to = parseKey(sizeKey);
    return {
      x: (offsetNow?.x ?? 0) + Math.round((from.width - to.width) / 2),
      y: (offsetNow?.y ?? 0) + Math.round((from.height - to.height) / 2),
    };
  }, [hudWindows, windowReady, readyKey, sizeKey, sizeShift, offsetNow]);

  const frame = (node: React.ReactNode) => (
    <div
      data-testid="hud-window"
      data-view={view ?? "waiting"}
      data-ready={windowReady ? "true" : "false"}
      style={
        shift && (shift.x !== 0 || shift.y !== 0)
          ? { transform: `translate(${shift.x}px, ${shift.y}px)` }
          : undefined
      }
    >
      {node}
    </div>
  );

  if (props && view === "hidden") {
    const dotWindow = hudPillSize("hidden");
    return frame(
      <div
        style={{
          width: dotWindow.width,
          height: dotWindow.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          data-testid="hud-hidden-dot"
          aria-label="Show recording controls"
          title="Show recording controls"
          onClick={() => setHidden(false)}
          style={{
            width: HIDDEN_DOT_SIZE,
            height: HIDDEN_DOT_SIZE,
            padding: 0,
            border: "none",
            borderRadius: "50%",
            background: "var(--record)",
            boxShadow: "var(--shadow-sm)",
            opacity: livePhase === "paused" ? 0.6 : 1,
            cursor: "pointer",
          }}
        />
      </div>,
    );
  }

  if (showPreRecord && preRecord) {
    return frame(
      <PreRecordContainer
        deps={preRecord}
        bus={bus}
        flowPhase={flowPhase}
        startRef={startRef}
        hideHudWhileRecording={hideWhileRecording}
        onHideHudWhileRecordingChange={setHideWhileRecording}
        onStartRequested={(setup) => {
          lastSetup.current = setup;
        }}
        windowReady={windowReady}
        onPillOffsetChange={onPillOffsetChange}
      />,
    );
  }
  if (!props) {
    return (
      <output
        data-testid="hud-waiting"
        style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-3)" }}
      >
        {state.phase === "discarded" ? "Recording discarded" : "Waiting for recording…"}
      </output>
    );
  }
  const hud: RecordingHudProps = {
    ...props,
    micMuted,
    onMuteToggle: bus ? toggleMute : undefined,
    onHidePill: () => setHidden(true),
    onRestart: bus && lastSetup.current ? restart : undefined,
  };
  return frame(
    <RecordingHudContainer
      hud={hud}
      windows={hudWindows}
      frames={frames}
      onResize={onResize}
      windowReady={windowReady}
      onPillOffsetChange={onPillOffsetChange}
    />,
  );
}
