import { useEffect, useRef, useState } from "react";
import { RecordingHud } from "../../hud/RecordingHud";
import type { RecordingEvent, RecordingPort } from "../../recording/port";
import {
  type RecordingSessionStore,
  createRecordingSessionStore,
  selectHudProps,
  warningCopy,
} from "../../recording/sessionStore";
import { PreRecordContainer, type PreRecordDeps } from "./PreRecordContainer";
import type { RecordingBus, SessionSnapshot, SnapshotPhase } from "./bus";
import { createBrowserPreRecordDeps } from "./hudDeps";
import {
  type ShortcutSubscribe,
  bridgeShortcutSubscribe,
  hudShortcutAction,
  isTypingTarget,
} from "./hudShortcuts";

/**
 * HUD window container (guide S10, SPEC §5.7). Binds {@link RecordingHud} to a
 * recording session store fed by `recording:event`:
 * - timer from main `stats`, pause/resume, stop, discard (confirm in the pill),
 * - mic meter from the launcher's renderer meter over the bus (Electron
 *   backend) or helper RMS in `stats` (native),
 * - interrupted ("Recording saved up to 00:42") and disk-low warning states.
 *
 * The HUD is a separate window opened without a session id: it adopts the
 * session from the launcher's bus snapshot or the first live event. With no
 * live session it shows the S05 pre-record pill ({@link PreRecordContainer}).
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

export function HudContainer({
  port,
  bus,
  store: injected,
  sessionId,
  sourceLabel,
  preRecord: preRecordProp,
  onShortcut = bridgeShortcutSubscribe,
  activeElement = () => (typeof document === "undefined" ? null : document.activeElement),
}: HudContainerProps) {
  const [store] = useState<RecordingSessionStore>(() => injected ?? createRecordingSessionStore());
  const [label, setLabel] = useState(sourceLabel ?? "");
  const [preRecord] = useState<PreRecordDeps | null>(() =>
    preRecordProp === undefined ? createBrowserPreRecordDeps() : preRecordProp,
  );
  const [flowPhase, setFlowPhase] = useState<SnapshotPhase | null>(null);
  const [hideWhileRecording, setHideWhileRecording] = useState(false);
  const [hidden, setHidden] = useState(false);
  const startRef = useRef<(() => void) | null>(null);
  const useSession = store;
  const state = useSession();

  useEffect(() => {
    if (sessionId) store.getState().attach(port, sessionId);
    const adopt = (id: string): boolean => {
      if (store.getState().sessionId) return false;
      store.getState().attach(port, id);
      return true;
    };
    const offPort = port.subscribe((e) => {
      if (!store.getState().sessionId && ADOPTABLE.has(e.type) && adopt(e.sessionId)) {
        store.getState().handleEvent(e);
      }
    });
    const offBus = bus?.subscribe((m) => {
      const s = store.getState();
      switch (m.type) {
        case "snapshot":
          setFlowPhase(m.snapshot?.phase ?? null);
          if (!m.snapshot) return;
          if (m.snapshot.sourceLabel && !sourceLabel) setLabel(m.snapshot.sourceLabel);
          if (m.snapshot.sessionId && adopt(m.snapshot.sessionId)) applySnapshot(store, m.snapshot);
          return;
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

  if (props && recordingLike && hidden) {
    return (
      <button
        type="button"
        data-testid="hud-hidden-dot"
        aria-label="Show recording controls"
        title="Show recording controls"
        onClick={() => setHidden(false)}
        style={{
          width: 20,
          height: 20,
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: "var(--record)",
          opacity: livePhase === "paused" ? 0.6 : 1,
          cursor: "pointer",
        }}
      />
    );
  }

  if (showPreRecord && preRecord) {
    return (
      <PreRecordContainer
        deps={preRecord}
        bus={bus}
        flowPhase={flowPhase}
        startRef={startRef}
        hideHudWhileRecording={hideWhileRecording}
        onHideHudWhileRecordingChange={setHideWhileRecording}
      />
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
  return <RecordingHud {...props} />;
}
