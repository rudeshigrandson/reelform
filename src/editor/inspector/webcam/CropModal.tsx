import { Button, Dialog } from "@design/components";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Slider } from "../controls";
import { type Size, cropFromZoom, cropToView, shapeAspect } from "./logic";
import { type CropRect, WEBCAM_LIMITS, type WebcamShape } from "./types";

/**
 * S16b — Crop / reframe modal. Shows the webcam frame with a crop overlay in the
 * bubble's shape, a zoom slider, "Center on face", and Apply. The crop can be
 * dragged to reposition. Props-driven; the draft only commits on Apply.
 */

export interface CropModalProps {
  open: boolean;
  shape: WebcamShape;
  /** Webcam source dimensions in px; the crop is stored in these coords. */
  sourceSize: Size;
  /** Current crop (`null` = automatic full, centered). */
  value: CropRect | null;
  /** Optional frame (e.g. a <video>/<canvas>) rendered under the overlay. */
  preview?: ReactNode | undefined;
  /**
   * Face detection (§9.4). Resolves to the normalized face center, or `null` on
   * failure — in which case the crop is centered. When absent, centers.
   */
  onCenterOnFace?: (() => Promise<{ x: number; y: number } | null>) | undefined;
  onApply: (crop: CropRect) => void;
  onClose: () => void;
}

const ZOOM = WEBCAM_LIMITS.cropZoom;

export function CropModal(props: CropModalProps): ReactElement | null {
  const { open, shape, sourceSize, value, preview, onCenterOnFace, onApply, onClose } = props;
  const aspect = shapeAspect(shape);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [detecting, setDetecting] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; cx: number; cy: number } | null>(null);

  // Re-seed the draft each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const view = cropToView(value, sourceSize, aspect);
    setZoom(Math.round(view.zoom * 100) / 100);
    setCenter(view.center);
    setDetecting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only on open
  }, [open]);

  const crop = cropFromZoom(sourceSize, aspect, zoom, center);
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;

  const centerOnFace = async () => {
    if (!onCenterOnFace) {
      setCenter({ x: 0.5, y: 0.5 });
      return;
    }
    setDetecting(true);
    try {
      const face = await onCenterOnFace();
      setCenter(face ?? { x: 0.5, y: 0.5 });
    } catch {
      setCenter({ x: 0.5, y: 0.5 });
    } finally {
      setDetecting(false);
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    // Start from the clamped crop center so dragging from an edge doesn't jump.
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      cx: (crop.x + crop.w / 2) / sourceSize.width,
      cy: (crop.y + crop.h / 2) / sourceSize.height,
    };
  };
  const onMouseMove = (e: MouseEvent) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    setCenter({
      x: Math.min(1, Math.max(0, d.cx + (e.clientX - d.startX) / box.width)),
      y: Math.min(1, Math.max(0, d.cy + (e.clientY - d.startY) / box.height)),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const frameStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: `${sourceSize.width} / ${sourceSize.height}`,
    maxWidth: "100%",
    background: "var(--color-neutral-900)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    userSelect: "none",
  };

  const overlayStyle: CSSProperties = {
    position: "absolute",
    left: pct(crop.x, sourceSize.width),
    top: pct(crop.y, sourceSize.height),
    width: pct(crop.w, sourceSize.width),
    height: pct(crop.h, sourceSize.height),
    borderRadius: shape === "square" ? 0 : shape === "rounded" ? "18%" : "999px",
    border: "2px solid var(--color-accent)",
    // Dim everything outside the crop.
    boxShadow: "0 0 0 9999px color-mix(in srgb, var(--color-neutral-900) 60%, transparent)",
    cursor: "move",
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Crop / reframe"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onApply(crop)}>
            Apply
          </Button>
        </>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          minWidth: "min(480px, 100%)",
        }}
      >
        <div
          ref={frameRef}
          data-testid="crop-frame"
          style={frameStyle}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          {preview}
          <div
            data-testid="crop-overlay"
            data-shape={shape}
            aria-label="Crop area"
            style={overlayStyle}
            onMouseDown={onMouseDown}
          />
        </div>
        <Slider
          label="Zoom"
          value={zoom}
          min={ZOOM.min}
          max={ZOOM.max}
          step={0.05}
          unit="×"
          onChange={setZoom}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-2)",
          }}
        >
          <Button variant="secondary" onClick={() => void centerOnFace()} disabled={detecting}>
            {detecting ? "Detecting face…" : "Center on face"}
          </Button>
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "12px",
              color: "var(--color-neutral-400)",
            }}
          >
            {Math.round(crop.w)}×{Math.round(crop.h)}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
