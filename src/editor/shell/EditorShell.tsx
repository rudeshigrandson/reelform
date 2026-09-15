import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  type EditorShellProps,
  INSPECTOR_TABS,
  type InspectorTab,
  type PreviewQuality,
  TIMELINE_LANES,
} from "./types";
import { useNarrowLayout } from "./useNarrowLayout";

const QUALITY_OPTIONS: ReadonlyArray<SegmentedOption<PreviewQuality>> = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "half", label: "Half" },
];

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const shellStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 380px",
  gridTemplateRows: "56px 1fr 220px",
  gridTemplateAreas: `
    "topbar   topbar"
    "stage    inspector"
    "timeline inspector"
  `,
  // Fills its window; the guide's 1440×900 is the default window size, not a frame.
  width: "100%",
  height: "100%",
  minWidth: "1024px",
  minHeight: "700px",
  background: "var(--bg-app)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  overflow: "hidden",
};

const topBarStyle: CSSProperties = {
  gridArea: "topbar",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "0 var(--space-4)",
  background: "var(--bg-panel)",
  borderBottom: "1px solid var(--border)",
};

const stageStyle: CSSProperties = {
  gridArea: "stage",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-6)",
  background: "var(--bg-sunken)",
  minHeight: 0,
};

const previewBoxStyle: CSSProperties = {
  aspectRatio: "16 / 9",
  width: "min(100%, 960px)",
  maxHeight: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-panel)",
  color: "var(--text-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
};

const timelineStyle: CSSProperties = {
  gridArea: "timeline",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-panel)",
  borderTop: "1px solid var(--border)",
  position: "relative",
  minHeight: 0,
};

const rulerStyle: CSSProperties = {
  height: "24px",
  display: "flex",
  alignItems: "center",
  padding: "0 var(--space-3)",
  fontSize: "11px",
  color: "var(--text-2)",
  background: "var(--bg-panel)",
  borderBottom: "1px solid var(--border)",
};

const laneStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "32px",
  borderBottom: "1px solid var(--border)",
};

const laneLabelStyle: CSSProperties = {
  width: "84px",
  flex: "0 0 auto",
  padding: "0 var(--space-3)",
  fontSize: "12px",
  color: "var(--text-2)",
  borderRight: "1px solid var(--border)",
};

const laneTrackStyle: CSSProperties = {
  flex: "1 1 auto",
  height: "100%",
  background: "var(--bg-sunken)",
};

const inspectorStyle: CSSProperties = {
  gridArea: "inspector",
  position: "relative",
  display: "flex",
  background: "var(--bg-panel)",
  borderLeft: "1px solid var(--border)",
  minHeight: 0,
};

const tabRailStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "0 0 auto",
  padding: "var(--space-2)",
  gap: "var(--space-1)",
  borderRight: "1px solid var(--border)",
  background: "var(--bg-app)",
};

const inspectorBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "var(--space-4)",
};

/** Narrow layout: the active tab's panel floats left of the icon rail. */
const popoverStyle: CSSProperties = {
  position: "absolute",
  top: "var(--space-2)",
  right: "calc(100% + var(--space-1))",
  bottom: "var(--space-2)",
  width: "320px",
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
};

const dirtyDotStyle: CSSProperties = {
  color: "var(--text-2)",
  fontSize: "18px",
  lineHeight: 1,
  marginLeft: "calc(-1 * var(--space-2))",
};

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    textAlign: "left",
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: "pointer",
    fontSize: "13px",
    fontFamily: "var(--font-body)",
    background: active ? "var(--accent)" : "transparent",
    color: active ? "var(--on-accent)" : "var(--text-2)",
    fontWeight: active ? 600 : 400,
  };
}

export function EditorShell(props: EditorShellProps): ReactElement {
  const {
    projectName,
    durationMs,
    currentMs,
    isPlaying,
    previewQuality,
    onExport,
    onTogglePlay,
    onQualityChange,
    onRename,
    renderInspector,
    renderPreview,
    renderPlaybackBar,
    renderTimeline,
    onTabChange,
    onBack,
    dirty = false,
    history,
  } = props;

  const [uncontrolledTab, setUncontrolledTab] = useState<InspectorTab>("Frame");
  const activeTab = props.activeTab ?? uncontrolledTab;
  const setActiveTab = (tab: InspectorTab): void => {
    setUncontrolledTab(tab);
    onTabChange?.(tab);
  };

  const narrow = useNarrowLayout(props.narrow);
  const [popoverOpen, setPopoverOpen] = useState(false);
  useEffect(() => {
    if (!narrow) setPopoverOpen(false);
  }, [narrow]);
  useEffect(() => {
    if (!narrow || !popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, popoverOpen]);

  const playheadPct =
    durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;

  const timelineRow = narrow ? "180px" : renderPlaybackBar ? "260px" : "220px";
  const baseStyle: CSSProperties = narrow
    ? { ...shellStyle, gridTemplateColumns: "minmax(0, 1fr) auto" }
    : shellStyle;
  const gridStyle: CSSProperties = renderPlaybackBar
    ? {
        ...baseStyle,
        gridTemplateRows: `56px 1fr 44px ${timelineRow}`,
        gridTemplateAreas: `
          "topbar   topbar"
          "stage    inspector"
          "playback inspector"
          "timeline inspector"
        `,
      }
    : { ...baseStyle, gridTemplateRows: `56px 1fr ${timelineRow}` };

  const onTabClick = (tab: InspectorTab): void => {
    if (narrow) setPopoverOpen((open) => !(open && tab === activeTab));
    if (tab !== activeTab) setActiveTab(tab);
  };
  const showPanel = !narrow || popoverOpen;
  const panel = (
    <div
      style={narrow ? { ...inspectorBodyStyle, flex: "1 1 auto" } : inspectorBodyStyle}
      role="tabpanel"
      aria-label={narrow ? `${activeTab} panel` : undefined}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-heading)",
          fontSize: "18px",
          color: "var(--text-1)",
        }}
      >
        {activeTab}
      </h2>
      <div style={{ marginTop: "var(--space-3)", color: "var(--text-2)" }}>
        {renderInspector ? renderInspector(activeTab) : `${activeTab} inspector`}
      </div>
    </div>
  );

  return (
    <div style={gridStyle} data-testid="editor-shell" data-layout={narrow ? "narrow" : "wide"}>
      {/* Top bar */}
      <header style={topBarStyle}>
        <Button icon variant="ghost" aria-label="Back" title="Projects" onClick={() => onBack?.()}>
          ‹
        </Button>
        <div style={{ width: narrow ? "180px" : "240px" }}>
          <Input
            aria-label="Project name"
            value={projectName}
            onChange={(e) => onRename?.(e.target.value)}
            readOnly={!onRename}
          />
        </div>
        {dirty && (
          <output aria-label="Unsaved changes" title="Unsaved changes" style={dirtyDotStyle}>
            •
          </output>
        )}
        {history && (
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <Button
              icon
              variant="ghost"
              aria-label="Undo"
              title={history.undoLabel ?? "Nothing to undo"}
              disabled={!history.canUndo}
              onClick={() => history.onUndo()}
            >
              ↶
            </Button>
            <Button
              icon
              variant="ghost"
              aria-label="Redo"
              title={history.redoLabel ?? "Nothing to redo"}
              disabled={!history.canRedo}
              onClick={() => history.onRedo()}
            >
              ↷
            </Button>
          </div>
        )}
        <Segmented<PreviewQuality>
          name="preview-quality"
          value={previewQuality}
          options={QUALITY_OPTIONS}
          onChange={(q) => onQualityChange?.(q)}
        />
        {/* Transport moves to the playback bar when one is provided (guide S12 D). */}
        {!renderPlaybackBar && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginLeft: "var(--space-2)",
            }}
          >
            <Button
              icon
              variant="secondary"
              aria-label={isPlaying ? "Pause" : "Play"}
              aria-pressed={isPlaying}
              onClick={() => onTogglePlay?.()}
            >
              {isPlaying ? "❚❚" : "▶"}
            </Button>
            <span style={{ fontSize: "13px", color: "var(--text-2)" }}>
              {formatTime(currentMs)} / {formatTime(durationMs)}
            </span>
          </div>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="primary" onClick={() => onExport()}>
            Export
          </Button>
        </div>
      </header>

      {/* Preview stage */}
      <main style={renderPreview ? { ...stageStyle, padding: 0 } : stageStyle}>
        {renderPreview ? (
          renderPreview()
        ) : (
          <div style={previewBoxStyle} aria-label="Preview">
            Preview
          </div>
        )}
      </main>

      {/* Playback bar */}
      {renderPlaybackBar && (
        <div style={{ gridArea: "playback", minHeight: 0 }}>{renderPlaybackBar()}</div>
      )}

      {/* Timeline */}
      <section style={timelineStyle} aria-label="Timeline">
        {renderTimeline ? (
          renderTimeline()
        ) : (
          <>
            <div style={rulerStyle}>0:00</div>
            <div style={{ position: "relative", flex: "1 1 auto", overflow: "hidden" }}>
              {TIMELINE_LANES.map((lane) => (
                <div key={lane} style={laneStyle}>
                  <div style={laneLabelStyle}>{lane}</div>
                  <div style={laneTrackStyle} />
                </div>
              ))}
              {/* Playhead */}
              <div
                data-testid="playhead"
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `calc(84px + (100% - 84px) * ${playheadPct / 100})`,
                  width: "2px",
                  background: "var(--accent)",
                  pointerEvents: "none",
                }}
              />
            </div>
          </>
        )}
      </section>

      {/* Inspector */}
      <aside style={inspectorStyle} aria-label="Inspector">
        <nav style={tabRailStyle} role="tablist" aria-orientation="vertical">
          {INSPECTOR_TABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                aria-expanded={narrow ? active && popoverOpen : undefined}
                title={narrow ? tab : undefined}
                aria-label={narrow ? tab : undefined}
                style={
                  narrow
                    ? {
                        ...tabButtonStyle(active && popoverOpen),
                        padding: "var(--space-2)",
                        fontSize: "12px",
                      }
                    : tabButtonStyle(active)
                }
                onClick={() => onTabClick(tab)}
              >
                {narrow ? tab.slice(0, 2) : tab}
              </button>
            );
          })}
        </nav>
        {showPanel && (narrow ? <div style={popoverStyle}>{panel}</div> : panel)}
      </aside>
    </div>
  );
}
