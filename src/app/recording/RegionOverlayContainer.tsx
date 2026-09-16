import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RegionSelector } from "../../overlays/RegionSelector";
import type { Bounds } from "../../overlays/types";
import type { RecordingBus } from "./bus";
import type { SourcesResult, WindowsPort } from "./port";
import {
  type Viewport,
  defaultRegionBounds,
  toRegionSelection,
  windowSnapTargets,
} from "./regionMath";

/**
 * Region overlay window container (guide S07, SPEC §5.7): one per display.
 * Makes the overlay accept the mouse while selecting, then posts the region in
 * display DIP + device pixels + scaleFactor to the launcher over the bus (or a
 * cancel). A choice on any display ends selection on all of them. Edges snap
 * to the windows on this display (`listSources` bounds, fetched once).
 */

export interface RegionOverlayContainerProps {
  displayId: string;
  bus: RecordingBus;
  windows?: Pick<WindowsPort, "setRegionSelecting"> | undefined;
  /** Defaults to `window.devicePixelRatio` (the display's scale factor). */
  scaleFactor?: number | undefined;
  /** Defaults to the window's inner size (= the display in DIP). */
  viewport?: Viewport | undefined;
  initialBounds?: Bounds | undefined;
  /** Window bounds for edge snapping; desktopCapturer windows have none (no snapping). */
  listSources?: (() => Promise<SourcesResult>) | undefined;
}

export function RegionOverlayContainer({
  displayId,
  bus,
  windows,
  scaleFactor,
  viewport,
  initialBounds,
  listSources,
}: RegionOverlayContainerProps) {
  const vp = useMemo<Viewport>(
    () =>
      viewport ?? {
        width: typeof window === "undefined" ? 0 : window.innerWidth,
        height: typeof window === "undefined" ? 0 : window.innerHeight,
      },
    [viewport],
  );
  const scale = scaleFactor ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapTargets, setSnapTargets] = useState<Bounds[]>([]);
  const listSourcesRef = useRef(listSources);

  useEffect(() => {
    const load = listSourcesRef.current;
    if (!load) return;
    let alive = true;
    load().then(
      (sources) => {
        if (alive) setSnapTargets(windowSnapTargets(sources, displayId));
      },
      () => {
        // No snapping without sources; selection still works.
      },
    );
    return () => {
      alive = false;
    };
  }, [displayId]);
  const start = useMemo(() => initialBounds ?? defaultRegionBounds(vp), [initialBounds, vp]);

  useEffect(() => {
    void windows?.setRegionSelecting(displayId, true).catch(() => {});
    const off = bus.subscribe((m) => {
      if (m.type === "regionSelected" || m.type === "regionCancelled") setDone(true);
    });
    return off;
  }, [bus, windows, displayId]);

  const onConfirm = useCallback(
    (bounds: Bounds) => {
      const sel = toRegionSelection(bounds, vp, scale);
      if (!sel) {
        setError("Select an area inside this display");
        return;
      }
      setDone(true);
      bus.post({ type: "regionSelected", displayId, ...sel });
    },
    [bus, displayId, vp, scale],
  );

  const onCancel = useCallback(() => {
    setDone(true);
    bus.post({ type: "regionCancelled", displayId });
  }, [bus, displayId]);

  if (done) return null;
  return (
    <>
      <RegionSelector
        initialBounds={start}
        onConfirm={onConfirm}
        onCancel={onCancel}
        snapTargets={snapTargets}
      />
      {error ? (
        <p
          role="alert"
          style={{
            position: "fixed",
            top: "calc(var(--space-8) * 2)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            margin: 0,
            padding: "var(--space-1) var(--space-3)",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-panel-raised)",
            color: "var(--danger)",
            fontFamily: "var(--font-body)",
            fontSize: 13,
          }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
