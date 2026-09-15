import { Button } from "@design/components";
import type { CSSProperties, ReactElement } from "react";
import { useEditorStore } from "../store";
import { ITEM_NOUNS, type TrackKind } from "../timeline/types";
import {
  alignSelectionStart,
  countSelection,
  deleteSelection,
  duplicateSelection,
} from "../timelineBinding";
import type { InspectorHost } from "./host/types";

/**
 * Multi-select summary (SPEC §6.8, guide S12 state 6): "3 items" with a count
 * per kind and the actions common to every kind. Each action is one undoable edit.
 */

export interface MultiSelectSummaryProps {
  selectedIds: ReadonlySet<string>;
  host: InspectorHost;
  /** Replace the timeline selection (after Duplicate / Delete). */
  onSelect?: ((ids: ReadonlySet<string>) => void) | undefined;
  /** Id factory for duplicated regions. */
  makeId: (prefix: string) => string;
}

const KIND_ORDER: readonly TrackKind[] = ["video", "zoom", "speed", "annotations", "captions"];

const plural = (n: number, noun: string): string =>
  `${n} ${noun.toLowerCase()}${n === 1 ? "" : "s"}`;

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel-raised)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
};

export function MultiSelectSummary({
  selectedIds,
  host,
  onSelect,
  makeId,
}: MultiSelectSummaryProps): ReactElement {
  // Only the timeline lists: selection and canvas writes must not re-render the summary.
  const durationMs = useEditorStore((s) => s.durationMs);
  const clips = useEditorStore((s) => s.clips);
  const zoomRegions = useEditorStore((s) => s.zoomRegions);
  const speedRegions = useEditorStore((s) => s.speedRegions);
  const annotations = useEditorStore((s) => s.annotations);
  const captions = useEditorStore((s) => s.captions);
  const audio = useEditorStore((s) => s.audio);
  const doc = { durationMs, clips, zoomRegions, speedRegions, annotations, captions, audio };
  const counts = countSelection(doc, selectedIds);
  const total = KIND_ORDER.reduce((sum, k) => sum + counts[k], 0);
  const regions = total - counts.video;
  const canAlign = alignSelectionStart(doc, selectedIds) !== null;
  const canDuplicate = regions > 0;

  const onDelete = () => {
    const current = useEditorStore.getState();
    const patch = deleteSelection(current, selectedIds);
    if (patch) {
      const ripple = current.clips.some((c) => selectedIds.has(c.id));
      host.documentUpdate(ripple ? "Ripple delete" : "Delete", patch);
    }
    onSelect?.(new Set());
  };

  const onDuplicate = () => {
    const res = duplicateSelection(useEditorStore.getState(), selectedIds, makeId);
    if (!res) return;
    host.documentUpdate("Duplicate", res.patch);
    onSelect?.(new Set(res.ids));
  };

  const onAlign = () => {
    const patch = alignSelectionStart(useEditorStore.getState(), selectedIds);
    if (patch) host.documentUpdate("Align start", patch);
  };

  return (
    <section aria-label="Selection summary" style={cardStyle}>
      <strong style={{ fontSize: "14px" }}>{plural(total, "item")}</strong>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          color: "var(--text-2)",
        }}
      >
        {KIND_ORDER.filter((k) => counts[k] > 0).map((k) => (
          <li key={k}>{plural(counts[k], ITEM_NOUNS[k])}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="secondary" onClick={onDuplicate} disabled={!canDuplicate}>
          Duplicate
        </Button>
        <Button variant="secondary" onClick={onAlign} disabled={!canAlign}>
          Align start
        </Button>
      </div>
    </section>
  );
}
