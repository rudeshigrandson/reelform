import { Button, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { type MessageKey, type Translate, useT } from "../../i18n";
import {
  type EditorShellProps,
  INSPECTOR_TABS,
  type InspectorTab,
  type PreviewQuality,
  TIMELINE_LANES,
} from "./types";
import { useNarrowLayout } from "./useNarrowLayout";

const QUALITY_LABEL_KEYS: Readonly<Record<PreviewQuality, MessageKey>> = {
  auto: "editor.shell.quality.auto",
  full: "editor.shell.quality.full",
  half: "editor.shell.quality.half",
};

/** Display labels for the inspector tabs; the `InspectorTab` ids stay stable. */
const TAB_LABEL_KEYS: Readonly<Record<InspectorTab, MessageKey>> = {
  Frame: "editor.shell.tab.frame",
  Cursor: "editor.shell.tab.cursor",
  Zoom: "editor.shell.tab.zoom",
  Webcam: "editor.shell.tab.webcam",
  Audio: "editor.shell.tab.audio",
  Captions: "editor.shell.tab.captions",
  Annotations: "editor.shell.tab.annotations",
  Effects: "editor.shell.tab.effects",
  Project: "editor.shell.tab.project",
};

const LANE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  Video: "editor.shell.lane.video",
  Zoom: "editor.shell.lane.zoom",
  Cursor: "editor.shell.lane.cursor",
  Captions: "editor.shell.lane.captions",
  Audio: "editor.shell.lane.audio",
};

function laneLabel(lane: string, t: Translate): string {
  const key = LANE_LABEL_KEYS[lane];
  return key ? t(key) : lane;
}

function qualityOptions(t: Translate): ReadonlyArray<SegmentedOption<PreviewQuality>> {
  return (Object.keys(QUALITY_LABEL_KEYS) as PreviewQuality[]).map((value) => ({
    value,
    label: t(QUALITY_LABEL_KEYS[value]),
  }));
}

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
  const t = useT();

  // Rename edits a local draft; blur / Enter commits, Escape reverts (S12 top bar).
  const [nameDraft, setNameDraft] = useState(projectName);
  useEffect(() => setNameDraft(projectName), [projectName]);
  const revertingName = useRef(false);
  const latestName = useRef(projectName);
  latestName.current = projectName;
  const commitName = (): void => {
    const trimmed = nameDraft.trim();
    if (revertingName.current || trimmed === "" || trimmed === projectName) {
      revertingName.current = false;
      setNameDraft(projectName);
      return;
    }
    const result = onRename?.(trimmed);
    // A rename that resolves `false` failed: show the current name again.
    if (result instanceof Promise) {
      void result.then(
        (ok) => {
          if (ok === false) setNameDraft(latestName.current);
        },
        () => setNameDraft(latestName.current),
      );
    }
  };

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
  const activeLabel = t(TAB_LABEL_KEYS[activeTab]);
  const panel = (
    <div
      style={narrow ? { ...inspectorBodyStyle, flex: "1 1 auto" } : inspectorBodyStyle}
      role="tabpanel"
      aria-label={narrow ? t("editor.shell.inspector.panel", { tab: activeLabel }) : undefined}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-heading)",
          fontSize: "18px",
          color: "var(--text-1)",
        }}
      >
        {activeLabel}
      </h2>
      <div style={{ marginTop: "var(--space-3)", color: "var(--text-2)" }}>
        {renderInspector
          ? renderInspector(activeTab)
          : t("editor.shell.inspector.placeholder", { tab: activeLabel })}
      </div>
    </div>
  );

  return (
    <div style={gridStyle} data-testid="editor-shell" data-layout={narrow ? "narrow" : "wide"}>
      {/* Top bar */}
      <header style={topBarStyle}>
        <Button
          icon
          variant="ghost"
          aria-label={t("editor.shell.back")}
          title={t("editor.shell.backTitle")}
          onClick={() => onBack?.()}
        >
          ‹
        </Button>
        <div style={{ width: narrow ? "180px" : "240px" }}>
          <Input
            aria-label={t("editor.shell.projectName")}
            value={onRename ? nameDraft : projectName}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (onRename) commitName();
            }}
            onKeyDown={(e) => {
              if (!onRename) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                revertingName.current = true;
                e.currentTarget.blur();
              }
            }}
            readOnly={!onRename}
          />
        </div>
        {dirty && (
          <output
            aria-label={t("editor.shell.unsavedChanges")}
            title={t("editor.shell.unsavedChanges")}
            style={dirtyDotStyle}
          >
            •
          </output>
        )}
        {history && (
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <Button
              icon
              variant="ghost"
              aria-label={t("editor.shell.undo")}
              title={history.undoLabel ?? t("editor.shell.nothingToUndo")}
              disabled={!history.canUndo}
              onClick={() => history.onUndo()}
            >
              ↶
            </Button>
            <Button
              icon
              variant="ghost"
              aria-label={t("editor.shell.redo")}
              title={history.redoLabel ?? t("editor.shell.nothingToRedo")}
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
          options={qualityOptions(t)}
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
              aria-label={isPlaying ? t("editor.shell.pause") : t("editor.shell.play")}
              aria-pressed={isPlaying}
              onClick={() => onTogglePlay?.()}
            >
              {isPlaying ? "❚❚" : "▶"}
            </Button>
            <span style={{ fontSize: "13px", color: "var(--text-2)" }}>
              {t("editor.shell.time", {
                current: formatTime(currentMs),
                duration: formatTime(durationMs),
              })}
            </span>
          </div>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="primary" onClick={() => onExport()}>
            {t("editor.shell.export")}
          </Button>
        </div>
      </header>

      {/* Preview stage */}
      <main style={renderPreview ? { ...stageStyle, padding: 0 } : stageStyle}>
        {renderPreview ? (
          renderPreview()
        ) : (
          <div style={previewBoxStyle} aria-label={t("editor.shell.preview")}>
            {t("editor.shell.preview")}
          </div>
        )}
      </main>

      {/* Playback bar */}
      {renderPlaybackBar && (
        <div style={{ gridArea: "playback", minHeight: 0 }}>{renderPlaybackBar()}</div>
      )}

      {/* Timeline */}
      <section style={timelineStyle} aria-label={t("editor.shell.timeline")}>
        {renderTimeline ? (
          renderTimeline()
        ) : (
          <>
            <div style={rulerStyle}>0:00</div>
            <div style={{ position: "relative", flex: "1 1 auto", overflow: "hidden" }}>
              {TIMELINE_LANES.map((lane) => (
                <div key={lane} style={laneStyle}>
                  <div style={laneLabelStyle}>{laneLabel(lane, t)}</div>
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
      <aside style={inspectorStyle} aria-label={t("editor.shell.inspector")}>
        <nav style={tabRailStyle} role="tablist" aria-orientation="vertical">
          {INSPECTOR_TABS.map((tab) => {
            const active = tab === activeTab;
            const label = t(TAB_LABEL_KEYS[tab]);
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                aria-expanded={narrow ? active && popoverOpen : undefined}
                title={narrow ? label : undefined}
                aria-label={narrow ? label : undefined}
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
                {narrow ? label.slice(0, 2) : label}
              </button>
            );
          })}
        </nav>
        {showPanel && (narrow ? <div style={popoverStyle}>{panel}</div> : panel)}
      </aside>
    </div>
  );
}
