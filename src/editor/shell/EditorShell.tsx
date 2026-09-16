import { Button } from "@design/components";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { type MessageKey, type Translate, useT } from "../../i18n";
import {
  type EditorShellProps,
  INSPECTOR_RAIL_PX,
  INSPECTOR_TABS,
  type InspectorTab,
  type PreviewQuality,
  SHELL_LAYOUT,
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

/** Tab rail glyphs (design S12 inspector rail). */
const TAB_GLYPHS: Readonly<Record<InspectorTab, string>> = {
  Frame: "▣",
  Cursor: "↖",
  Zoom: "⊕",
  Webcam: "◉",
  Audio: "♪",
  Captions: "CC",
  Annotations: "T",
  Effects: "◐",
  Project: "☰",
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

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** macOS draws the traffic lights over the top-left of the window (hidden-inset title bar). */
function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
}

/** Room left for the native traffic lights; the shell never draws them. */
const TRAFFIC_LIGHT_INSET_PX = 80;

const MONO = 'ui-monospace, "JetBrains Mono", monospace';

const shellStyle: CSSProperties = {
  display: "grid",
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

function topBarStyle(narrow: boolean, mac: boolean): CSSProperties {
  const side = narrow ? 12 : 14;
  return {
    gridArea: "topbar",
    display: "flex",
    alignItems: "center",
    gap: `${narrow ? 12 : 14}px`,
    minWidth: 0,
    padding: `0 ${side}px 0 ${mac ? TRAFFIC_LIGHT_INSET_PX : side}px`,
    background: "var(--bg-panel)",
    borderBottom: "1px solid var(--border)",
  };
}

const breadcrumbStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  fontSize: "13px",
};

const backLinkStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  background: "transparent",
  padding: "4px 2px",
  margin: 0,
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  color: "var(--text-3)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function nameInputStyle(narrow: boolean, focused: boolean, length: number): CSSProperties {
  return {
    appearance: "none",
    width: `${Math.min(40, Math.max(6, length + 2))}ch`,
    maxWidth: narrow ? "220px" : "360px",
    minWidth: 0,
    padding: "4px 6px",
    margin: 0,
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${focused ? "var(--border-strong)" : "transparent"}`,
    background: focused ? "var(--bg-sunken)" : "transparent",
    color: "var(--text-1)",
    fontFamily: "var(--font-body)",
    fontSize: narrow ? "12px" : "13px",
    fontWeight: 600,
    textOverflow: "ellipsis",
    outline: "none",
  };
}

const dirtyDotStyle: CSSProperties = {
  color: "var(--accent-hover)",
  fontSize: "13px",
  lineHeight: 1,
};

const clusterStyle: CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

function squareButtonStyle(size: number, raised: boolean, enabled: boolean): CSSProperties {
  return {
    appearance: "none",
    width: `${size}px`,
    height: `${size}px`,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: size >= 30 ? "10px" : "var(--radius-sm)",
    border: "none",
    background: raised ? "var(--bg-panel-raised)" : "transparent",
    color: enabled ? "var(--text-2)" : "var(--text-3)",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    cursor: enabled ? "pointer" : "default",
  };
}

const vDividerStyle: CSSProperties = {
  width: "1px",
  height: "22px",
  margin: "0 2px",
  background: "var(--border-strong)",
};

const qualityPillStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 12px",
  borderRadius: "10px",
  background: "var(--bg-panel-raised)",
  fontSize: "12px",
  color: "var(--text-1)",
  whiteSpace: "nowrap",
};

const qualitySelectStyle: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  border: "none",
  background: "transparent",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "12px",
  padding: "0 18px 0 0",
  margin: "0 -18px 0 0",
  cursor: "pointer",
  outline: "none",
};

function exportButtonStyle(narrow: boolean): CSSProperties {
  return {
    borderRadius: "var(--radius-full)",
    padding: narrow ? "7px 14px" : "8px 16px",
    fontSize: narrow ? "12px" : "13px",
    gap: "8px",
  };
}

const kbdHintStyle: CSSProperties = { fontFamily: MONO, opacity: 0.65, fontWeight: 400 };

const stageStyle: CSSProperties = {
  gridArea: "stage",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-6)",
  background: "var(--bg-sunken)",
  minHeight: 0,
  minWidth: 0,
};

const previewBoxStyle: CSSProperties = {
  aspectRatio: "16 / 9",
  width: "min(100%, 832px)",
  maxHeight: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-panel)",
  color: "var(--text-3)",
  borderRadius: "12px",
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
  minWidth: 0,
};

const PLACEHOLDER_HEADER_PX = 140;

const rulerStyle: CSSProperties = {
  height: "26px",
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  paddingLeft: `${PLACEHOLDER_HEADER_PX + 8}px`,
  fontSize: "10px",
  fontFamily: MONO,
  color: "var(--text-3)",
  borderBottom: "1px solid var(--border)",
  background:
    "linear-gradient(to right, var(--bg-panel) 0 140px, var(--border) 140px 141px, var(--bg-sunken) 141px)",
};

const laneStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "26px",
  borderBottom: "1px solid var(--border)",
};

const laneLabelStyle: CSSProperties = {
  width: `${PLACEHOLDER_HEADER_PX}px`,
  height: "100%",
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  flex: "0 0 auto",
  padding: "0 10px",
  fontSize: "11px",
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
  minWidth: 0,
};

function tabRailStyle(narrow: boolean): CSSProperties {
  return {
    width: `${INSPECTOR_RAIL_PX}px`,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: "none",
    padding: "8px 0",
    gap: "4px",
    overflowY: "auto",
    borderRight: narrow ? "none" : "1px solid var(--border)",
  };
}

function tabButtonStyle(active: boolean, glyph: string): CSSProperties {
  return {
    appearance: "none",
    flex: "none",
    width: "36px",
    height: "36px",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    fontSize: glyph.length > 1 ? "11px" : "14px",
    fontWeight: glyph.length > 1 ? 600 : 400,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent-hover)" : "var(--text-2)",
  };
}

const panelStyle: CSSProperties = {
  flex: "1 1 auto",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
};

const panelHeaderStyle: CSSProperties = {
  height: "42px",
  flex: "none",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 14px",
  borderBottom: "1px solid var(--border)",
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
  fontSize: "15px",
  lineHeight: 1.2,
  color: "var(--text-1)",
};

const panelBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "12px 14px",
  color: "var(--text-2)",
};

/** Narrow layout: the active tab's panel floats left of the icon rail. */
const popoverStyle: CSSProperties = {
  position: "absolute",
  top: "8px",
  right: "calc(100% + 4px)",
  bottom: "8px",
  width: "320px",
  zIndex: 5,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
};

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
  const [mac] = useState(isMacPlatform);

  // Rename edits a local draft; blur / Enter commits, Escape reverts (S12 top bar).
  const [nameDraft, setNameDraft] = useState(projectName);
  const [nameFocused, setNameFocused] = useState(false);
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

  const geo = narrow ? SHELL_LAYOUT.narrow : SHELL_LAYOUT.wide;
  const gridStyle: CSSProperties = {
    ...shellStyle,
    gridTemplateColumns: `minmax(0, 1fr) ${geo.inspector}px`,
    ...(renderPlaybackBar
      ? {
          gridTemplateRows: `${geo.topBar}px 1fr ${geo.playback}px ${geo.timeline}px`,
          gridTemplateAreas: `
          "topbar   topbar"
          "stage    inspector"
          "playback inspector"
          "timeline inspector"
        `,
        }
      : {
          gridTemplateRows: `${geo.topBar}px 1fr ${geo.timeline}px`,
          gridTemplateAreas: `
          "topbar   topbar"
          "stage    inspector"
          "timeline inspector"
        `,
        }),
  };

  const onTabClick = (tab: InspectorTab): void => {
    if (narrow) setPopoverOpen((open) => !(open && tab === activeTab));
    if (tab !== activeTab) setActiveTab(tab);
  };
  const showPanel = !narrow || popoverOpen;
  const activeLabel = t(TAB_LABEL_KEYS[activeTab]);
  const panel = (
    <div
      style={panelStyle}
      role="tabpanel"
      aria-label={narrow ? t("editor.shell.inspector.panel", { tab: activeLabel }) : undefined}
    >
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{activeLabel}</h2>
      </div>
      <div style={panelBodyStyle}>
        {renderInspector
          ? renderInspector(activeTab)
          : t("editor.shell.inspector.placeholder", { tab: activeLabel })}
      </div>
    </div>
  );

  const exportKeys = mac ? "⌘E" : "Ctrl+E";

  return (
    <div style={gridStyle} data-testid="editor-shell" data-layout={narrow ? "narrow" : "wide"}>
      {/* Top bar */}
      <header style={topBarStyle(narrow, mac)}>
        <div style={breadcrumbStyle}>
          <button
            type="button"
            style={backLinkStyle}
            aria-label={t("editor.shell.back")}
            title={t("editor.shell.backTitle")}
            onClick={() => onBack?.()}
          >
            {t("editor.shell.backTitle")} ▸
          </button>
          <input
            type="text"
            aria-label={t("editor.shell.projectName")}
            value={onRename ? nameDraft : projectName}
            spellCheck={false}
            style={nameInputStyle(
              narrow,
              nameFocused && onRename !== undefined,
              (onRename ? nameDraft : projectName).length,
            )}
            onChange={(e) => setNameDraft(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => {
              setNameFocused(false);
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
          {dirty && (
            <output
              aria-label={t("editor.shell.unsavedChanges")}
              title={t("editor.shell.unsavedChanges")}
              style={dirtyDotStyle}
            >
              •
            </output>
          )}
        </div>

        {/* Transport moves to the playback bar when one is provided (guide S12 D). */}
        {!renderPlaybackBar && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              style={{
                ...squareButtonStyle(30, false, true),
                borderRadius: "var(--radius-full)",
                background: "var(--accent)",
                color: "var(--on-accent)",
              }}
              aria-label={isPlaying ? t("editor.shell.pause") : t("editor.shell.play")}
              aria-pressed={isPlaying}
              onClick={() => onTogglePlay?.()}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>
            <span
              style={{
                fontSize: "12px",
                fontFamily: MONO,
                fontVariantNumeric: "tabular-nums",
                color: "var(--text-2)",
              }}
            >
              {t("editor.shell.time", {
                current: formatTime(currentMs),
                duration: formatTime(durationMs),
              })}
            </span>
          </div>
        )}

        <div style={clusterStyle}>
          {history && (
            <>
              <button
                type="button"
                style={squareButtonStyle(narrow ? 28 : 30, history.canUndo, history.canUndo)}
                aria-label={t("editor.shell.undo")}
                title={history.undoLabel ?? t("editor.shell.nothingToUndo")}
                disabled={!history.canUndo}
                onClick={() => history.onUndo()}
              >
                ↶
              </button>
              <button
                type="button"
                style={squareButtonStyle(narrow ? 28 : 30, history.canRedo, history.canRedo)}
                aria-label={t("editor.shell.redo")}
                title={history.redoLabel ?? t("editor.shell.nothingToRedo")}
                disabled={!history.canRedo}
                onClick={() => history.onRedo()}
              >
                ↷
              </button>
              <span aria-hidden="true" style={vDividerStyle} />
            </>
          )}
          <label style={qualityPillStyle}>
            <span>{t("editor.shell.quality.label")}</span>
            <select
              aria-label={t("editor.shell.quality.aria")}
              value={previewQuality}
              style={qualitySelectStyle}
              onChange={(e) => onQualityChange?.(e.currentTarget.value as PreviewQuality)}
            >
              {(Object.keys(QUALITY_LABEL_KEYS) as PreviewQuality[]).map((q) => (
                <option key={q} value={q}>
                  {t(QUALITY_LABEL_KEYS[q])}
                </option>
              ))}
            </select>
            <span aria-hidden="true" style={{ color: "var(--text-3)", pointerEvents: "none" }}>
              ⌄
            </span>
          </label>
          <Button
            variant="primary"
            style={exportButtonStyle(narrow)}
            aria-label={t("editor.shell.export")}
            aria-keyshortcuts={mac ? "Meta+E" : "Control+E"}
            title={`${t("editor.shell.export")} (${exportKeys})`}
            onClick={() => onExport()}
          >
            {t("editor.shell.export")}
            {!narrow && (
              <span aria-hidden="true" style={kbdHintStyle}>
                {exportKeys}
              </span>
            )}
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
        <div style={{ gridArea: "playback", minHeight: 0, minWidth: 0 }}>{renderPlaybackBar()}</div>
      )}

      {/* Timeline */}
      <section style={timelineStyle} aria-label={t("editor.shell.timeline")}>
        {renderTimeline ? (
          renderTimeline()
        ) : (
          <>
            <div style={rulerStyle}>00:00</div>
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
                  left: `calc(${PLACEHOLDER_HEADER_PX}px + (100% - ${PLACEHOLDER_HEADER_PX}px) * ${playheadPct / 100})`,
                  width: "1px",
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
        <nav style={tabRailStyle(narrow)} role="tablist" aria-orientation="vertical">
          {INSPECTOR_TABS.map((tab) => {
            const active = tab === activeTab;
            const label = t(TAB_LABEL_KEYS[tab]);
            const glyph = TAB_GLYPHS[tab];
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                aria-expanded={narrow ? active && popoverOpen : undefined}
                aria-label={label}
                title={label}
                style={tabButtonStyle(active, glyph)}
                onClick={() => onTabClick(tab)}
              >
                <span aria-hidden="true">{glyph}</span>
              </button>
            );
          })}
        </nav>
        {showPanel && (narrow ? <div style={popoverStyle}>{panel}</div> : panel)}
      </aside>
    </div>
  );
}
