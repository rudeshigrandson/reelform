import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  type EditorShellProps,
  INSPECTOR_TABS,
  type InspectorTab,
  type PreviewQuality,
  TIMELINE_LANES,
} from "./types";

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
  background: "var(--color-neutral-900)",
  color: "var(--color-neutral-100)",
  fontFamily: "var(--font-body)",
  overflow: "hidden",
};

const topBarStyle: CSSProperties = {
  gridArea: "topbar",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "0 var(--space-4)",
  background: "var(--color-neutral-900)",
  borderBottom: "1px solid var(--color-neutral-800)",
};

const stageStyle: CSSProperties = {
  gridArea: "stage",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-6)",
  background: "var(--color-surface)",
  minHeight: 0,
};

const previewBoxStyle: CSSProperties = {
  aspectRatio: "16 / 9",
  width: "min(100%, 960px)",
  maxHeight: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--color-neutral-900)",
  color: "var(--color-neutral-400)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
};

const timelineStyle: CSSProperties = {
  gridArea: "timeline",
  display: "flex",
  flexDirection: "column",
  background: "var(--color-neutral-900)",
  borderTop: "1px solid var(--color-neutral-800)",
  position: "relative",
  minHeight: 0,
};

const rulerStyle: CSSProperties = {
  height: "24px",
  display: "flex",
  alignItems: "center",
  padding: "0 var(--space-3)",
  fontSize: "11px",
  color: "var(--color-neutral-400)",
  background: "var(--color-neutral-800)",
  borderBottom: "1px solid var(--color-neutral-800)",
};

const laneStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "32px",
  borderBottom: "1px solid var(--color-neutral-800)",
};

const laneLabelStyle: CSSProperties = {
  width: "84px",
  flex: "0 0 auto",
  padding: "0 var(--space-3)",
  fontSize: "12px",
  color: "var(--color-neutral-300)",
  borderRight: "1px solid var(--color-neutral-800)",
};

const laneTrackStyle: CSSProperties = {
  flex: "1 1 auto",
  height: "100%",
  background: "var(--color-neutral-800)",
  opacity: 0.4,
};

const inspectorStyle: CSSProperties = {
  gridArea: "inspector",
  display: "flex",
  background: "var(--color-neutral-900)",
  borderLeft: "1px solid var(--color-neutral-800)",
  minHeight: 0,
};

const tabRailStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "0 0 auto",
  padding: "var(--space-2)",
  gap: "var(--space-1)",
  borderRight: "1px solid var(--color-neutral-800)",
  background: "var(--color-neutral-800)",
};

const inspectorBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "var(--space-4)",
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
    background: active ? "var(--color-accent)" : "transparent",
    color: active ? "var(--color-neutral-100)" : "var(--color-neutral-300)",
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
  } = props;

  const [activeTab, setActiveTab] = useState<InspectorTab>("Frame");

  const playheadPct =
    durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;

  const gridStyle: CSSProperties = renderPlaybackBar
    ? {
        ...shellStyle,
        gridTemplateRows: "56px 1fr 44px 260px",
        gridTemplateAreas: `
          "topbar   topbar"
          "stage    inspector"
          "playback inspector"
          "timeline inspector"
        `,
      }
    : shellStyle;

  return (
    <div style={gridStyle} data-testid="editor-shell">
      {/* Top bar */}
      <header style={topBarStyle}>
        <Button icon variant="ghost" aria-label="Back">
          ‹
        </Button>
        <div style={{ width: "240px" }}>
          <Input
            aria-label="Project name"
            value={projectName}
            onChange={(e) => onRename?.(e.target.value)}
            readOnly={!onRename}
          />
        </div>
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
            <span style={{ fontSize: "13px", color: "var(--color-neutral-300)" }}>
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
                  background: "var(--color-accent)",
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
                style={tabButtonStyle(active)}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            );
          })}
        </nav>
        <div style={inspectorBodyStyle} role="tabpanel">
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              fontSize: "18px",
              color: "var(--color-neutral-100)",
            }}
          >
            {activeTab}
          </h2>
          <div style={{ marginTop: "var(--space-3)", color: "var(--color-neutral-400)" }}>
            {renderInspector ? renderInspector(activeTab) : `${activeTab} inspector`}
          </div>
        </div>
      </aside>
    </div>
  );
}
