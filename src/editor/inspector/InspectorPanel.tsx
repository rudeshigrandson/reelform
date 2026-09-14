import type { ReactElement } from "react";
import type { InspectorTab } from "../shell/types";
import { useEditorStore } from "../store";
import { AnnotationsInspector, duplicateAnnotation } from "./annotations";
import { AudioInspector } from "./audio";
import { CaptionsInspector } from "./captions";
import { CursorInspector } from "./cursor";
import { EffectsInspector } from "./effects";
import { FrameInspector } from "./frame";
import { ProjectInspector } from "./project";
// Mock project metadata until the fs/IPC-backed project info lands.
import { makeInfo } from "./project/fixtures";
import { WebcamInspector } from "./webcam";
import { ZoomInspector, deleteRegion, duplicateRegion } from "./zoom";

const noop = (): void => {};

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** Binds the active inspector tab to the editor store. */
export function InspectorPanel({ tab }: { tab: InspectorTab }): ReactElement {
  const e = useEditorStore();
  const update = e.update;

  switch (tab) {
    case "Frame":
      return <FrameInspector value={e.frame} onChange={(frame) => update({ frame })} />;

    case "Cursor":
      return (
        <CursorInspector
          value={e.cursor}
          onChange={(cursor) => update({ cursor })}
          cursorPointCount={e.cursorPointCount}
        />
      );

    case "Zoom": {
      const selectedRegion = e.zoomRegions.find((r) => r.id === e.selectedZoomId) ?? null;
      return (
        <ZoomInspector
          settings={e.zoom}
          onSettingsChange={(zoom) => update({ zoom })}
          selectedRegion={selectedRegion}
          onRegionChange={(next) =>
            update({ zoomRegions: e.zoomRegions.map((r) => (r.id === next.id ? next : r)) })
          }
          onDuplicate={(id) => {
            const regions = duplicateRegion(e.zoomRegions, id, e.durationMs, newId("zoom"));
            if (regions) update({ zoomRegions: regions });
          }}
          onDelete={(id) =>
            update({ zoomRegions: deleteRegion(e.zoomRegions, id), selectedZoomId: null })
          }
          onGenerate={noop}
          status="idle"
          hasTelemetry={e.cursorPointCount !== null && e.cursorPointCount > 0}
          hasSuggestions={e.zoomRegions.some((r) => r.source === "auto")}
          timelineDurationMs={e.durationMs}
        />
      );
    }

    case "Webcam":
      return (
        <WebcamInspector
          value={e.webcam}
          onChange={(webcam) => update({ webcam })}
          source={null}
          onUpload={noop}
          onReplace={noop}
          onRemove={noop}
          onAutoSync={noop}
        />
      );

    case "Audio":
      return (
        <AudioInspector
          value={e.audio}
          onChange={(audio) => update({ audio })}
          availableTracks={{ mic: true, system: true }}
          trackDurationMs={e.durationMs}
          onAddAudio={noop}
        />
      );

    case "Captions":
      return (
        <CaptionsInspector
          captions={e.captions}
          onCaptionsChange={(captions) => update({ captions })}
          style={e.captionStyle}
          onStyleChange={(captionStyle) => update({ captionStyle })}
          status={e.captionStatus}
          modelDownloaded={false}
          model={e.captionModel}
          onModelChange={(captionModel) => update({ captionModel })}
          language={e.captionLanguage}
          onLanguageChange={(captionLanguage) => update({ captionLanguage })}
          onGenerate={noop}
          onDownloadModel={noop}
          onSeek={(currentMs) => update({ currentMs })}
          currentMs={e.currentMs}
          durationMs={e.durationMs}
          burnIn={e.burnInCaptions}
          onBurnInChange={(burnInCaptions) => update({ burnInCaptions })}
          onExportSrt={noop}
          onExportVtt={noop}
        />
      );

    case "Annotations": {
      const selected = e.annotations.find((a) => a.id === e.selectedAnnotationId) ?? null;
      return (
        <AnnotationsInspector
          activeTool={e.activeTool}
          onToolChange={(activeTool) => update({ activeTool })}
          selected={selected}
          onChange={(next) =>
            update({ annotations: e.annotations.map((a) => (a.id === next.id ? next : a)) })
          }
          onDuplicate={(a) => {
            const copy = duplicateAnnotation(a, newId("ann"), e.annotations);
            update({ annotations: [...e.annotations, copy], selectedAnnotationId: copy.id });
          }}
          onDelete={(a) =>
            update({
              annotations: e.annotations.filter((x) => x.id !== a.id),
              selectedAnnotationId: null,
            })
          }
          detectedShortcuts={[]}
          onAddAllShortcuts={noop}
          timelineDurationMs={e.durationMs}
        />
      );
    }

    case "Effects": {
      const selectedSpeedRegion = e.speedRegions.find((r) => r.id === e.selectedSpeedId) ?? null;
      return (
        <EffectsInspector
          value={e.effects}
          onChange={(effects) => update({ effects })}
          selectedSpeedRegion={selectedSpeedRegion}
          onSpeedRegionChange={(next) =>
            update({ speedRegions: e.speedRegions.map((r) => (r.id === next.id ? next : r)) })
          }
          envelope={null}
          onApplyRemoveSilence={noop}
          cursorSamples={null}
          onAutoSpeedIdle={(regions) => update({ speedRegions: [...e.speedRegions, ...regions] })}
        />
      );
    }

    case "Project":
      return (
        <ProjectInspector
          info={makeInfo()}
          onRename={noop}
          onReveal={noop}
          onRelink={noop}
          saveRaw={e.saveRawWithProject}
          onSaveRawChange={(saveRawWithProject) => update({ saveRawWithProject })}
          trimSavingsBytes={null}
          onTrim={noop}
          onDelete={noop}
        />
      );
  }
}
