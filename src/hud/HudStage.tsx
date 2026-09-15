import type { CSSProperties, KeyboardEventHandler, ReactNode } from "react";
import { HUD_GAP, type HudSize } from "./layout";

/**
 * Lays out the HUD window content (SPEC §5.7): the pill, plus an overlay
 * (chips, menus, picker, discard confirm) in the space the window grew for.
 *
 * - `layout` null: the window is the bare pill; the overlay flows under it
 *   (only reachable without a windows port, e.g. previews).
 * - `layout` set: the stage is the grown window, the pill sits at
 *   `pillOffset` (its unchanged screen spot) and the overlay fills the grown
 *   side (`above` / `below`).
 * - `shift`: while a prepared window change is not committed yet, the content
 *   laid out for the new bounds is drawn offset so nothing moves on screen.
 */

export interface HudStageLayout {
  bounds: { width: number; height: number };
  placement: "above" | "below";
  pillOffset: { x: number; y: number };
}

export interface HudStageProps {
  pill: ReactNode;
  pillSize: HudSize;
  overlay?: ReactNode | undefined;
  layout: HudStageLayout | null;
  shift?: { x: number; y: number } | null | undefined;
  /** A mouse-down on the transparent grown area (dismisses popovers). */
  onDismiss?: (() => void) | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined;
}

function shiftStyle(shift: HudStageProps["shift"]): CSSProperties {
  if (!shift || (shift.x === 0 && shift.y === 0)) return {};
  return { transform: `translate(${shift.x}px, ${shift.y}px)` };
}

export function HudStage({
  pill,
  pillSize,
  overlay,
  layout,
  shift,
  onDismiss,
  onKeyDown,
}: HudStageProps) {
  const hasOverlay = overlay !== null && overlay !== undefined && overlay !== false;
  const overlayNode = hasOverlay ? (
    <div
      data-testid="hud-overlay"
      style={{
        display: "flex",
        flexDirection: layout?.placement === "below" ? "column" : "column-reverse",
        alignItems: "center",
        gap: HUD_GAP,
      }}
    >
      {overlay}
    </div>
  ) : null;

  if (!layout) {
    return (
      <div
        data-testid="hud-stage"
        data-expanded="false"
        data-shifted={shift && (shift.x !== 0 || shift.y !== 0) ? "true" : undefined}
        onKeyDown={onKeyDown}
        style={{ width: "max-content", ...shiftStyle(shift) }}
      >
        {pill}
        {overlayNode}
      </div>
    );
  }

  const { pillOffset, bounds, placement } = layout;
  const overlayStyle: CSSProperties =
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
          top: pillOffset.y + pillSize.height + HUD_GAP,
          bottom: 0,
        };
  return (
    <div
      data-testid="hud-stage"
      data-expanded="true"
      data-placement={placement}
      data-shifted={shift && (shift.x !== 0 || shift.y !== 0) ? "true" : undefined}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
      style={{
        position: "relative",
        width: bounds.width,
        height: bounds.height,
        ...shiftStyle(shift),
      }}
    >
      <div
        data-testid="hud-pill-slot"
        style={{
          position: "absolute",
          left: pillOffset.x,
          top: pillOffset.y,
          width: pillSize.width,
          height: pillSize.height,
        }}
      >
        {pill}
      </div>
      {overlayNode ? (
        <div
          style={{
            ...overlayStyle,
            display: "flex",
            flexDirection: "column",
            justifyContent: placement === "above" ? "flex-end" : "flex-start",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>{overlayNode}</div>
        </div>
      ) : null}
    </div>
  );
}
