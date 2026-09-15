import { useEffect, useState } from "react";
import { SourceOutline } from "../../overlays/SourceOutline";
import type { RecordingBus, RegionRect } from "./bus";

/**
 * Source-outline overlay window container (SPEC §5.7): one per display. The
 * pre-record HUD publishes the selected window source's display-local bounds
 * (refreshed at 4 Hz) as `hud:sourceOutline`; this draws them when they are
 * for this display and hides otherwise.
 */

export interface SourceOutlineContainerProps {
  displayId: string;
  bus: RecordingBus;
}

interface Outline {
  bounds: RegionRect;
  label: string | undefined;
}

export function SourceOutlineContainer({ displayId, bus }: SourceOutlineContainerProps) {
  const [outline, setOutline] = useState<Outline | null>(null);

  useEffect(
    () =>
      bus.subscribe((m) => {
        if (m.type !== "hud:sourceOutline") return;
        if (m.displayId !== displayId || m.bounds === null) {
          setOutline(null);
          return;
        }
        const bounds = m.bounds;
        const label = m.label;
        setOutline((prev) =>
          prev &&
          prev.label === label &&
          prev.bounds.x === bounds.x &&
          prev.bounds.y === bounds.y &&
          prev.bounds.width === bounds.width &&
          prev.bounds.height === bounds.height
            ? prev
            : { bounds, label },
        );
      }),
    [bus, displayId],
  );

  if (!outline) return null;
  return <SourceOutline bounds={outline.bounds} label={outline.label} />;
}
