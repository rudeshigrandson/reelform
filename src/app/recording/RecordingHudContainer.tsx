import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { HudStage, type HudStageLayout } from "../../hud/HudStage";
import {
  RecordingHudPanel,
  RecordingPill,
  type RecordingPillProps,
  RecordingWarningStrip,
} from "../../hud/RecordingHud";
import {
  PRE_RECORD_PILL,
  RECORDING_PILL,
  type RecordingPanel,
  recordingExpansionSize,
} from "../../hud/layout";
import type { RecordingHudProps } from "../../hud/types";
import {
  type FrameWait,
  type ResizeSubscribe,
  type Shift,
  planShift,
  runHudTransition,
} from "./hudTransition";
import type { HudWindowsPort } from "./port";

/**
 * The recording pill inside the HUD window (guide S10, SPEC §5.7). The window
 * is the 300×48 pill; the low-disk / capture warning strip, the overflow menu
 * and the discard confirm grow it around the pill with the same
 * prepare → paint → commit handshake as the pre-record HUD.
 */

export interface RecordingHudContainerProps {
  hud: RecordingHudProps;
  windows?: HudWindowsPort | undefined;
  frames?: FrameWait | undefined;
  onResize?: ResizeSubscribe | undefined;
  /** The window already has this phase's pill size; no growth is requested before. */
  windowReady?: boolean | undefined;
  /** Where the pill sits in the window once a change is on screen (null: bare pill). */
  onPillOffsetChange?: ((offset: { x: number; y: number } | null) => void) | undefined;
}

export function RecordingHudContainer({
  hud,
  windows,
  frames,
  onResize,
  windowReady = true,
  onPillOffsetChange,
}: RecordingHudContainerProps) {
  const [panel, setPanel] = useState<RecordingPanel | null>(null);
  const [layout, setLayout] = useState<HudStageLayout | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const live = hud.phase === "recording" || hud.phase === "paused";
  const openPanel = live ? panel : null;
  useEffect(() => {
    if (!live) setPanel(null);
  }, [live]);

  const wide = hud.phase === "interrupted";
  const pillSize = wide ? PRE_RECORD_PILL : RECORDING_PILL;
  const warningRows = live && hud.warning ? 1 : 0;
  const expansion = wide ? null : recordingExpansionSize(openPanel, warningRows, pillSize);
  const expansionKey = expansion ? `${expansion.width}x${expansion.height}` : "";
  const wantedKey = useRef(expansionKey);
  wantedKey.current = expansionKey;
  const pillOffsetListener = useRef(onPillOffsetChange);
  pillOffsetListener.current = onPillOffsetChange;

  useEffect(() => {
    if (!windows) return;
    if (!windowReady) {
      setLayout(null);
      setShift(null);
      return;
    }
    const key = expansionKey;
    const [w, h] = key.split("x").map(Number);
    const size = key && w && h ? { width: w, height: h } : null;
    void runHudTransition(
      { windows, frames, onResize },
      {
        isCurrent: () => mounted.current && wantedKey.current === key,
        prepare: () => windows.setHudExpansion(size),
        apply: (plan) => {
          if (!mounted.current) return;
          setLayout(plan?.layout ?? null);
          setShift(plan ? planShift(plan) : null);
          if (!plan) pillOffsetListener.current?.(null);
        },
        settle: (plan) => {
          pillOffsetListener.current?.(plan.layout?.pillOffset ?? null);
          if (mounted.current) flushSync(() => setShift(null));
        },
      },
    );
  }, [windows, expansionKey, windowReady, frames, onResize]);

  const full: RecordingPillProps = { ...hud, openPanel, onPanelChange: setPanel };
  const panelNode = openPanel ? <RecordingHudPanel {...full} /> : null;
  const warningNode = warningRows > 0 ? <RecordingWarningStrip warning={hud.warning} /> : null;
  const overlay =
    panelNode || warningNode ? (
      <>
        {warningNode}
        {panelNode}
      </>
    ) : null;

  return (
    <HudStage
      pill={<RecordingPill {...full} />}
      pillSize={pillSize}
      overlay={overlay}
      layout={windows ? layout : null}
      shift={shift}
      onDismiss={() => setPanel(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && openPanel) setPanel(null);
      }}
    />
  );
}
