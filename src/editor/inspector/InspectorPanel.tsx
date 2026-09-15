import { type ReactElement, memo, useMemo } from "react";
import type { InspectorTab } from "../shell/types";
import { useEditorStore } from "../store";
import { CursorInspector } from "./cursor";
import { FrameInspector } from "./frame";
import { AnnotationsTab } from "./host/AnnotationsTab";
import { AudioTab } from "./host/AudioTab";
import { CaptionsTab } from "./host/CaptionsTab";
import { EffectsTab } from "./host/EffectsTab";
import { ProjectTab } from "./host/ProjectTab";
import { WebcamTab } from "./host/WebcamTab";
import { ZoomTab } from "./host/ZoomTab";
import { createDefaultInspectorHost } from "./host/defaultHost";
import type { InspectorHost } from "./host/types";

export interface InspectorPanelProps {
  tab: InspectorTab;
  /**
   * Dialogs, project-folder operations, captions runtime, audio decoding and
   * history. Defaults to a stand-in that edits the stores directly; pass a
   * stable object (re-creating it re-decodes audio).
   */
  host?: InspectorHost | undefined;
}

/**
 * Binds the active inspector tab to the editor store and the host. Memoised so
 * the editor window's per-frame playhead re-renders don't cascade into the tabs;
 * Captions and Zoom subscribe to playback on their own.
 */
export const InspectorPanel = memo(InspectorPanelImpl);

function InspectorPanelImpl({ tab, host }: InspectorPanelProps): ReactElement {
  const fallback = useMemo(() => createDefaultInspectorHost(), []);
  const h = host ?? fallback;

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

function FrameTab({ host }: { host: InspectorHost }): ReactElement {
  const frame = useEditorStore((s) => s.frame);
  return (
    <FrameInspector
      value={frame}
      onChange={(next) => host.documentUpdate("Frame", { frame: next }, "frame-settings")}
    />
  );
}

function CursorTab({ host }: { host: InspectorHost }): ReactElement {
  const cursor = useEditorStore((s) => s.cursor);
  const cursorPointCount = useEditorStore((s) => s.cursorPointCount);
  return (
    <CursorInspector
      value={cursor}
      onChange={(next) => host.documentUpdate("Cursor", { cursor: next }, "cursor-settings")}
      cursorPointCount={cursorPointCount}
    />
  );
}
