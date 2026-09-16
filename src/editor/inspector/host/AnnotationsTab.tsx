import { type ReactElement, useMemo, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import { useEditorStore } from "../../store";
import {
  AnnotationsInspector,
  duplicateAnnotation,
  keystrokeBadgesFromCandidates,
} from "../annotations";
import { useInspectorT, withDetail } from "../i18n";
import { errorMessage, hostId } from "./hooks";
import { detectTelemetryShortcuts } from "./telemetryInputs";
import { timelineClips } from "./timeMap";
import type { InspectorHost } from "./types";

/** Annotations tab: keystroke badges from telemetry, image sources via import (guide S19, SPEC §9.7). */

export const IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
];

export function AnnotationsTab({ host }: { host: InspectorHost }): ReactElement {
  const t = useInspectorT();
  const e = useEditorStore();
  const telemetry = useProjectSession((s) => s.telemetry);
  const meta = useProjectSession((s) => s.meta);
  const [imageError, setImageError] = useState<string | null>(null);

  const detected = useMemo(
    () =>
      detectTelemetryShortcuts(
        telemetry?.telemetry ?? null,
        timelineClips(e.clips, meta),
        host.platform,
      ),
    [telemetry, e.clips, meta, host.platform],
  );

  const selected = e.annotations.find((a) => a.id === e.selectedAnnotationId) ?? null;

  return (
    <AnnotationsInspector
      activeTool={e.activeTool}
      onToolChange={(activeTool) => useEditorStore.getState().update({ activeTool })}
      selected={selected}
      onChange={(next) =>
        host.documentUpdate(
          t("inspector.annotations.history.edit"),
          { annotations: e.annotations.map((a) => (a.id === next.id ? next : a)) },
          `annotation-edit-${next.id}`,
        )
      }
      onDuplicate={(a) => {
        const copy = duplicateAnnotation(a, hostId("ann"), e.annotations);
        host.documentUpdate(t("inspector.annotations.history.duplicate"), {
          annotations: [...e.annotations, copy],
          selectedAnnotationId: copy.id,
        });
      }}
      onDelete={(a) =>
        host.documentUpdate(t("inspector.annotations.history.delete"), {
          annotations: e.annotations.filter((x) => x.id !== a.id),
          selectedAnnotationId: null,
        })
      }
      detectedShortcuts={detected}
      onAddAllShortcuts={() => {
        const current = useEditorStore.getState();
        const badges = keystrokeBadgesFromCandidates(detected, {
          timelineDurationMs: current.durationMs,
          newId: () => hostId("key"),
          existing: current.annotations,
        });
        if (badges.length === 0) return;
        host.documentUpdate(t("inspector.annotations.history.addBadges"), {
          annotations: [...current.annotations, ...badges],
        });
      }}
      timelineDurationMs={e.durationMs}
      imageError={imageError}
      onPickImage={(a) => {
        setImageError(null);
        void (async () => {
          try {
            const picked = await host.pickFile({
              title: t("inspector.annotations.chooseImageTitle"),
              filters: IMAGE_FILTERS,
            });
            if (!picked) return;
            const media = await host.importMedia("image", picked);
            const annotations = useEditorStore
              .getState()
              .annotations.map((x) =>
                x.id === a.id && x.kind === "image" ? { ...x, src: media.path } : x,
              );
            host.documentUpdate(t("inspector.annotations.history.setImage"), { annotations });
          } catch (err) {
            setImageError(
              withDetail(t, "inspector.annotations.error.image", errorMessage(err, "")),
            );
          }
        })();
      }}
    />
  );
}
