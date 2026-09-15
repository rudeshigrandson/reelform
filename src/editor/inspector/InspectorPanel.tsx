import { type ReactElement, memo, useMemo } from "react";
import type { InspectorTab } from "../shell/types";
import { MultiSelectSummary } from "./MultiSelectSummary";
import { AnnotationsTab } from "./host/AnnotationsTab";
import { AudioTab } from "./host/AudioTab";
import { CaptionsTab } from "./host/CaptionsTab";
import { CursorTab } from "./host/CursorTab";
import { EffectsTab } from "./host/EffectsTab";
import { FrameTab } from "./host/FrameTab";
import { ProjectTab } from "./host/ProjectTab";
import { WebcamTab } from "./host/WebcamTab";
import { ZoomTab } from "./host/ZoomTab";
import { createDefaultInspectorHost } from "./host/defaultHost";
import { hostId } from "./host/hooks";
import type { InspectorHost } from "./host/types";

export interface InspectorPanelProps {
  tab: InspectorTab;
  /**
   * Dialogs, project-folder operations, captions runtime, audio decoding and
   * history. Defaults to a stand-in that edits the stores directly; pass a
   * stable object (re-creating it re-decodes audio).
   */
  host?: InspectorHost | undefined;
  /** Timeline selection; more than one item shows the multi-select summary (§6.8). */
  selectedIds?: ReadonlySet<string> | undefined;
  /** Replace the timeline selection (summary Delete / Duplicate). Pass a stable callback. */
  onSelect?: ((ids: ReadonlySet<string>) => void) | undefined;
  /** Id factory for duplicated regions; defaults to a host id. */
  makeId?: ((prefix: string) => string) | undefined;
}

/**
 * Binds the active inspector tab to the editor store and the host. Memoised so
 * the editor window's per-frame playhead re-renders don't cascade into the tabs;
 * Captions and Zoom subscribe to playback on their own.
 */
export const InspectorPanel = memo(InspectorPanelImpl);

function InspectorPanelImpl({
  tab,
  host,
  selectedIds,
  onSelect,
  makeId = defaultMakeId,
}: InspectorPanelProps): ReactElement {
  const fallback = useMemo(() => createDefaultInspectorHost(), []);
  const h = host ?? fallback;

  if (selectedIds && selectedIds.size > 1) {
    return (
      <>
        <MultiSelectSummary
          selectedIds={selectedIds}
          host={h}
          onSelect={onSelect}
          makeId={makeId}
        />
        <div style={{ marginTop: "var(--space-3)" }}>
          <TabBody tab={tab} host={h} />
        </div>
      </>
    );
  }
  return <TabBody tab={tab} host={h} />;
}

const defaultMakeId = hostId;

function TabBody({ tab, host: h }: { tab: InspectorTab; host: InspectorHost }): ReactElement {
  switch (tab) {
    case "Frame":
      return <FrameTab host={h} />;
    case "Cursor":
      return <CursorTab host={h} />;
    case "Zoom":
      return <ZoomTab host={h} />;
    case "Webcam":
      return <WebcamTab host={h} />;
    case "Audio":
      return <AudioTab host={h} />;
    case "Captions":
      return <CaptionsTab host={h} />;
    case "Annotations":
      return <AnnotationsTab host={h} />;
    case "Effects":
      return <EffectsTab host={h} />;
    case "Project":
      return <ProjectTab host={h} />;
  }
}
