import { Button, Segmented, Tag } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { CSSProperties, ReactNode } from "react";
import { DragGrip } from "./RecordingHud";
import { type HudMessageKey, useHudT } from "./i18n";
import { CHIP_ROW_HEIGHT, HUD_GAP, MENU_SIZE, PILL_HEIGHT, PILL_WIDTH } from "./layout";
import type {
  HudChip,
  HudDevice,
  PreRecordHudProps,
  PreRecordMode,
  PreRecordOptions,
} from "./types";

/**
 * S05 — pre-record HUD pill (560×64 glass): source segmented, source chip
 * (opens S06), mic with 5-bar live meter + device menu, system audio toggle,
 * camera + device menu + "Show preview", red Record, overflow. Presentational:
 * the container owns data, window growth and where menus are placed.
 */

const MODE_OPTIONS: ReadonlyArray<{ value: PreRecordMode; labelKey: HudMessageKey }> = [
  { value: "screen", labelKey: "hud.mode.display" },
  { value: "window", labelKey: "hud.mode.window" },
  { value: "region", labelKey: "hud.mode.region" },
];

export const MINI_METER_BARS = 5;

export const prePillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  width: PILL_WIDTH,
  height: PILL_HEIGHT,
  boxSizing: "border-box",
  padding: "0 var(--space-3)",
  background: "color-mix(in srgb, var(--bg-panel) 88%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-full)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  userSelect: "none",
};

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 1, alignSelf: "stretch", margin: "14px 0", background: "var(--border)" }}
    />
  );
}

/** 5-bar level meter; bars light proportionally to `level` (0..1). */
export function MiniMeter({ level, active }: { level: number | undefined; active: boolean }) {
  const t = useHudT();
  const clamped = active && level !== undefined ? Math.max(0, Math.min(1, level)) : 0;
  const lit = Math.round(clamped * MINI_METER_BARS);
  return (
    <span
      role="meter"
      aria-label={t(active ? "hud.pre.micLevel" : "hud.pre.micOff")}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={active ? clamped : undefined}
      data-testid="pre-mic-meter"
      style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 14 }}
    >
      {Array.from({ length: MINI_METER_BARS }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static meter
          key={i}
          data-lit={i < lit ? "true" : "false"}
          style={{
            width: 2,
            height: 5 + i * 2,
            borderRadius: 1,
            background: i < lit ? "var(--accent)" : "var(--border-strong)",
          }}
        />
      ))}
    </span>
  );
}

const toggleStyle = (on: boolean): CSSProperties => ({
  color: on ? "var(--accent)" : "var(--text-2)",
  background: on ? "var(--accent-soft)" : undefined,
});

export function PreRecordHud(props: PreRecordHudProps) {
  const {
    mode,
    onModeChange,
    sourceLabel,
    onOpenSourcePicker,
    sourcePickerOpen = false,
    micOn,
    micLevel,
    systemAudio,
    systemAudioSupported,
    systemAudioNote,
    onSystemAudioChange,
    cameraOn,
    onRecord,
    recordDisabled = false,
    busyLabel,
    recordShortcut,
    openMenu,
    onMenuChange,
  } = props;

  const t = useHudT();
  const modeOptions: ReadonlyArray<SegmentedOption<PreRecordMode>> = MODE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.labelKey),
  }));
  const toggleMenu = (menu: NonNullable<PreRecordHudProps["openMenu"]>) =>
    onMenuChange(openMenu === menu ? null : menu);

  return (
    <div style={prePillStyle} data-testid="pre-record-hud" data-mode={mode}>
      <DragGrip />
      <Segmented<PreRecordMode>
        name="hud-mode"
        size="sm"
        value={mode}
        options={modeOptions}
        onChange={onModeChange}
      />
      <Divider />
      <button
        type="button"
        onClick={onOpenSourcePicker}
        aria-haspopup="dialog"
        aria-expanded={sourcePickerOpen}
        aria-label={t("hud.pre.source", { source: sourceLabel })}
        data-testid="hud-source-chip"
        title={sourceLabel}
        style={{
          flex: 1,
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          padding: "var(--space-1) var(--space-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-full)",
          background: sourcePickerOpen ? "var(--bg-active)" : "transparent",
          color: "var(--text-1)",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sourceLabel}
        </span>
        <span aria-hidden="true" style={{ color: "var(--text-3)" }}>
          ▾
        </span>
      </button>
      <Divider />
      <Button
        variant="ghost"
        onClick={() => toggleMenu("mic")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "mic"}
        aria-label={t(micOn ? "hud.pre.micOn" : "hud.pre.micOff")}
        title={t("hud.pre.microphone")}
        style={{ ...toggleStyle(micOn), gap: 4, padding: "0 var(--space-2)" }}
      >
        <span aria-hidden="true" style={{ textDecoration: micOn ? undefined : "line-through" }}>
          🎙
        </span>
        <MiniMeter level={micLevel} active={micOn} />
      </Button>
      <Button
        variant="ghost"
        icon
        aria-pressed={systemAudioSupported && systemAudio}
        aria-label={t("hud.pre.systemAudio")}
        disabled={!systemAudioSupported}
        title={
          systemAudioSupported
            ? t("hud.pre.systemAudio")
            : (systemAudioNote ?? t("hud.pre.unavailable"))
        }
        onClick={() => onSystemAudioChange(!systemAudio)}
        style={toggleStyle(systemAudioSupported && systemAudio)}
      >
        <span aria-hidden="true">🔊</span>
      </Button>
      <Button
        variant="ghost"
        icon
        onClick={() => toggleMenu("camera")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "camera"}
        aria-label={t(cameraOn ? "hud.pre.cameraOn" : "hud.pre.cameraOff")}
        title={t("hud.pre.camera")}
        style={toggleStyle(cameraOn)}
      >
        <span aria-hidden="true">📷</span>
      </Button>
      <Divider />
      <button
        type="button"
        onClick={onRecord}
        disabled={recordDisabled}
        aria-label={busyLabel ?? t("hud.pre.startRecording")}
        title={busyLabel ?? t("hud.pre.startRecordingShortcut", { shortcut: recordShortcut })}
        data-testid="hud-record"
        style={{
          width: 40,
          height: 40,
          flex: "none",
          borderRadius: "50%",
          border: "3px solid var(--text-1)",
          background: "var(--record)",
          cursor: recordDisabled ? "not-allowed" : "pointer",
          opacity: recordDisabled ? 0.5 : 1,
        }}
      />
      <Button
        variant="ghost"
        icon
        onClick={() => toggleMenu("overflow")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "overflow"}
        aria-label={t("hud.pre.moreOptions")}
        title={t("hud.more")}
      >
        ⋯
      </Button>
    </div>
  );
}

// ---- menus ----------------------------------------------------------------------

const menuStyle: CSSProperties = {
  width: MENU_SIZE.width,
  maxHeight: MENU_SIZE.height,
  boxSizing: "border-box",
  overflow: "auto",
  padding: "var(--space-2)",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
};

function MenuItem({
  checked,
  onClick,
  children,
}: {
  checked?: boolean | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        padding: "var(--space-1) var(--space-2)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        background: checked ? "var(--accent-soft)" : "transparent",
        color: "var(--text-1)",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "var(--space-1) var(--space-2)", color: "var(--text-3)", fontSize: 12 }}>
      {children}
    </div>
  );
}

function DeviceList({
  devices,
  on,
  selectedId,
  empty,
  onChange,
}: {
  devices: ReadonlyArray<HudDevice>;
  on: boolean;
  selectedId: string;
  empty: string;
  onChange: (id: string | null) => void;
}) {
  const t = useHudT();
  return (
    <>
      {devices.length === 0 ? <MenuLabel>{empty}</MenuLabel> : null}
      {devices.map((d) => (
        <MenuItem key={d.id} checked={on && d.id === selectedId} onClick={() => onChange(d.id)}>
          {d.label}
        </MenuItem>
      ))}
      <MenuItem checked={!on} onClick={() => onChange(null)}>
        {t("hud.menu.off")}
      </MenuItem>
    </>
  );
}

const COUNTDOWNS: ReadonlyArray<PreRecordOptions["countdown"]> = [0, 3, 5, 10];

/** Menu content for the open pre-record menu. */
export function PreRecordMenuPanel(props: PreRecordHudProps) {
  const { openMenu, onMenuChange, options, onOptionsChange } = props;
  const t = useHudT();
  if (!openMenu) return null;
  const close = () => onMenuChange(null);

  if (openMenu === "mic") {
    return (
      <div
        role="menu"
        aria-label={t("hud.pre.microphone")}
        style={menuStyle}
        data-testid="hud-menu-mic"
      >
        <DeviceList
          devices={props.micDevices}
          on={props.micOn}
          selectedId={props.micDeviceId}
          empty={t("hud.menu.noMicrophones")}
          onChange={(id) => {
            props.onMicChange(id);
            close();
          }}
        />
      </div>
    );
  }

  if (openMenu === "camera") {
    return (
      <div
        role="menu"
        aria-label={t("hud.pre.camera")}
        style={menuStyle}
        data-testid="hud-menu-camera"
      >
        <DeviceList
          devices={props.cameraDevices}
          on={props.cameraOn}
          selectedId={props.cameraDeviceId}
          empty={t("hud.menu.noCameras")}
          onChange={(id) => {
            props.onCameraChange(id);
            close();
          }}
        />
        <MenuItem
          onClick={() => {
            props.onShowPreview();
            close();
          }}
        >
          {t("hud.menu.showPreview")}
        </MenuItem>
      </div>
    );
  }

  return (
    <div
      role="menu"
      aria-label={t("hud.pre.moreOptions")}
      style={menuStyle}
      data-testid="hud-menu-overflow"
    >
      <MenuLabel>{t("hud.menu.countdown")}</MenuLabel>
      {COUNTDOWNS.map((c) => (
        <MenuItem
          key={c}
          checked={options.countdown === c}
          onClick={() => onOptionsChange({ countdown: c })}
        >
          {c === 0 ? t("hud.menu.off") : t("hud.menu.countdownSeconds", { seconds: c })}
        </MenuItem>
      ))}
      <MenuLabel>{t("hud.menu.cursor")}</MenuLabel>
      <MenuItem
        checked={!options.hideCursor}
        onClick={() => onOptionsChange({ hideCursor: false })}
      >
        {t("hud.menu.cursorShow")}
      </MenuItem>
      <MenuItem checked={options.hideCursor} onClick={() => onOptionsChange({ hideCursor: true })}>
        {t("hud.menu.cursorHide")}
      </MenuItem>
      <MenuLabel>{t("hud.menu.frameRate")}</MenuLabel>
      {([30, 60] as const).map((f) => (
        <MenuItem key={f} checked={options.fps === f} onClick={() => onOptionsChange({ fps: f })}>
          {t("hud.menu.fps", { fps: f })}
        </MenuItem>
      ))}
      <MenuItem
        checked={options.hideHudWhileRecording}
        onClick={() => onOptionsChange({ hideHudWhileRecording: !options.hideHudWhileRecording })}
      >
        {t("hud.menu.hideHudWhileRecording")}
      </MenuItem>
      {props.onOpenSettings ? (
        <MenuItem
          onClick={() => {
            props.onOpenSettings?.();
            close();
          }}
        >
          {t("hud.menu.settings")}
        </MenuItem>
      ) : null}
    </div>
  );
}

/** Chips above the pill (fallback capture, device errors). */
export function HudChips({ chips }: { chips: ReadonlyArray<HudChip> }) {
  if (chips.length === 0) return null;
  return (
    <div
      data-testid="hud-chips"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: HUD_GAP,
        width: PILL_WIDTH,
      }}
    >
      {chips.map((c) => (
        <Tag
          key={c.id}
          variant="outline"
          role={c.tone === "danger" ? "alert" : "status"}
          data-testid={`hud-chip-${c.id}`}
          data-tone={c.tone}
          title={c.message}
          style={{
            boxSizing: "border-box",
            height: CHIP_ROW_HEIGHT,
            display: "inline-flex",
            alignItems: "center",
            maxWidth: PILL_WIDTH,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: c.tone === "danger" ? "var(--danger)" : "var(--warning)",
            borderColor: c.tone === "danger" ? "var(--danger)" : "var(--warning)",
            background: "var(--bg-panel-raised)",
          }}
        >
          {c.message}
        </Tag>
      ))}
    </div>
  );
}
