import type { CSSProperties, ReactNode } from "react";
import { DragGrip } from "./RecordingHud";
import { type HudMessageKey, useHudT } from "./i18n";
import {
  CHIP_ROW_HEIGHT,
  HUD_GAP,
  MENU_PANEL_WIDTH,
  MENU_SIZE,
  PILL_HEIGHT,
  PILL_WIDTH,
} from "./layout";
import type {
  HudChip,
  HudDevice,
  PreRecordHudProps,
  PreRecordMode,
  PreRecordOptions,
} from "./types";

/**
 * S05 — pre-record HUD pill (620×64 glass): source segmented, source chip
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
const MINI_METER_HEIGHTS = [6, 11, 14, 8, 4] as const;

const accentTint = (pct: number) => `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;

export const prePillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: PILL_WIDTH,
  height: PILL_HEIGHT,
  boxSizing: "border-box",
  padding: "0 12px",
  background: "color-mix(in srgb, var(--bg-panel) 72%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-full)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  userSelect: "none",
};

const resetButton: CSSProperties = {
  font: "inherit",
  color: "inherit",
  margin: 0,
  cursor: "pointer",
};

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 1, height: 28, background: "var(--border-strong)" }}
    />
  );
}

function Chevron() {
  return (
    <span aria-hidden="true" style={{ color: "var(--text-2)", fontSize: 11, lineHeight: 1 }}>
      ⌄
    </span>
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
      {MINI_METER_HEIGHTS.map((h, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static meter
          key={i}
          data-lit={i < lit ? "true" : "false"}
          style={{
            width: 3,
            height: h,
            borderRadius: "var(--radius-full)",
            background: active
              ? i < lit
                ? "var(--accent-hover)"
                : "color-mix(in srgb, var(--accent-hover) 40%, transparent)"
              : "var(--border-strong)",
          }}
        />
      ))}
    </span>
  );
}

/** On: accent tint + hairline; off: quiet outline. */
const toggleStyle = (on: boolean): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  flex: "none",
  boxSizing: "border-box",
  borderRadius: "var(--radius-full)",
  border: `1px solid ${on ? accentTint(50) : "var(--border)"}`,
  background: on ? accentTint(24) : "transparent",
  color: on ? "var(--accent-hover)" : "var(--text-2)",
});

function ModeSegmented({
  value,
  onChange,
}: {
  value: PreRecordMode;
  onChange: (mode: PreRecordMode) => void;
}) {
  const t = useHudT();
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        flex: "none",
        padding: 3,
        borderRadius: "var(--radius-full)",
        background: "color-mix(in srgb, var(--bg-sunken) 60%, transparent)",
      }}
    >
      {MODE_OPTIONS.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-full)",
              background: checked ? "var(--accent)" : "transparent",
              color: checked ? "var(--on-accent)" : "var(--text-2)",
              fontWeight: checked ? 600 : 400,
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="hud-mode"
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0, margin: 0 }}
            />
            {t(o.labelKey)}
          </label>
        );
      })}
    </div>
  );
}

function MicGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        width: 7,
        height: 13,
        borderRadius: "var(--radius-full)",
        background: on ? "var(--accent-hover)" : "var(--text-3)",
      }}
    />
  );
}

function CameraGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "none",
        boxSizing: "border-box",
        width: 15,
        height: 11,
        borderRadius: 3,
        border: `1.5px solid ${on ? "var(--accent-hover)" : "var(--text-3)"}`,
      }}
    />
  );
}

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
  const toggleMenu = (menu: NonNullable<PreRecordHudProps["openMenu"]>) =>
    onMenuChange(openMenu === menu ? null : menu);
  const systemOn = systemAudioSupported && systemAudio;

  return (
    <div style={prePillStyle} data-testid="pre-record-hud" data-mode={mode}>
      <DragGrip />
      <ModeSegmented value={mode} onChange={onModeChange} />
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
          ...resetButton,
          flex: "0 1 auto",
          minWidth: 0,
          maxWidth: 190,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          border: `1px solid ${sourcePickerOpen ? accentTint(50) : "transparent"}`,
          borderRadius: "var(--radius-full)",
          background: sourcePickerOpen
            ? accentTint(24)
            : "color-mix(in srgb, var(--bg-sunken) 50%, transparent)",
          color: "var(--text-1)",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sourceLabel}
        </span>
        <Chevron />
      </button>
      <Divider />
      <button
        type="button"
        onClick={() => toggleMenu("mic")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "mic"}
        aria-label={t(micOn ? "hud.pre.micOn" : "hud.pre.micOff")}
        title={t("hud.pre.microphone")}
        style={{ ...resetButton, ...toggleStyle(micOn), padding: "7px 10px" }}
      >
        <MicGlyph on={micOn} />
        <MiniMeter level={micLevel} active={micOn} />
        <Chevron />
      </button>
      <button
        type="button"
        aria-pressed={systemOn}
        aria-label={t("hud.pre.systemAudio")}
        disabled={!systemAudioSupported}
        title={
          systemAudioSupported
            ? t("hud.pre.systemAudio")
            : (systemAudioNote ?? t("hud.pre.unavailable"))
        }
        onClick={() => onSystemAudioChange(!systemAudio)}
        style={{
          ...resetButton,
          ...toggleStyle(systemOn),
          width: 34,
          height: 34,
          padding: 0,
          fontSize: 14,
          opacity: systemAudioSupported ? 1 : 0.45,
          cursor: systemAudioSupported ? "pointer" : "not-allowed",
        }}
      >
        <span aria-hidden="true">♪</span>
      </button>
      <button
        type="button"
        onClick={() => toggleMenu("camera")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "camera"}
        aria-label={t(cameraOn ? "hud.pre.cameraOn" : "hud.pre.cameraOff")}
        title={t("hud.pre.camera")}
        style={{ ...resetButton, ...toggleStyle(cameraOn), padding: "7px 10px" }}
      >
        <CameraGlyph on={cameraOn} />
        <Chevron />
      </button>
      <Divider />
      <button
        type="button"
        onClick={onRecord}
        disabled={recordDisabled}
        aria-label={busyLabel ?? t("hud.pre.startRecording")}
        title={busyLabel ?? t("hud.pre.startRecordingShortcut", { shortcut: recordShortcut })}
        data-testid="hud-record"
        style={{
          ...resetButton,
          width: 44,
          height: 44,
          flex: "none",
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          borderRadius: "var(--radius-full)",
          border: "none",
          background: "var(--record)",
          boxShadow: "0 6px 18px color-mix(in srgb, var(--record) 45%, transparent)",
          cursor: recordDisabled ? "not-allowed" : "pointer",
          opacity: recordDisabled ? 0.5 : 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            boxSizing: "border-box",
            width: 16,
            height: 16,
            borderRadius: "var(--radius-full)",
            border: "3px solid var(--text-1)",
          }}
        />
      </button>
      <button
        type="button"
        onClick={() => toggleMenu("overflow")}
        aria-haspopup="menu"
        aria-expanded={openMenu === "overflow"}
        aria-label={t("hud.pre.moreOptions")}
        title={t("hud.more")}
        style={{
          ...resetButton,
          flex: "none",
          width: 28,
          height: 28,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-full)",
          background: openMenu === "overflow" ? "var(--bg-active)" : "transparent",
          color: "var(--text-2)",
          fontSize: 14,
        }}
      >
        ⋯
      </button>
    </div>
  );
}

// ---- menus ----------------------------------------------------------------------

const menuStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  width: MENU_PANEL_WIDTH,
  maxHeight: MENU_SIZE.height,
  boxSizing: "border-box",
  overflow: "auto",
  padding: 8,
  background: "color-mix(in srgb, var(--bg-panel) 94%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
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
        justifyContent: "space-between",
        gap: 8,
        flex: "none",
        width: "100%",
        padding: "7px 10px",
        border: "none",
        borderRadius: 10,
        background: checked ? "var(--accent-soft)" : "transparent",
        color: "var(--text-1)",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {checked ? (
        <span aria-hidden="true" style={{ color: "var(--accent-hover)" }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** Group heading with the current value on the right (guide S05 "Countdown   3 s ›"). */
function MenuLabel({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        flex: "none",
        padding: "7px 10px 3px",
        color: "var(--text-3)",
        fontSize: 11,
      }}
    >
      <span>{children}</span>
      {value !== undefined ? <span style={{ color: "var(--accent-hover)" }}>{value} ›</span> : null}
    </div>
  );
}

function MenuSeparator() {
  return (
    <div
      aria-hidden="true"
      style={{ flex: "none", height: 1, margin: "4px 8px", background: "var(--border)" }}
    />
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
        <MenuSeparator />
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

  const countdownLabel = (c: PreRecordOptions["countdown"]) =>
    c === 0 ? t("hud.menu.off") : t("hud.menu.countdownSeconds", { seconds: c });

  return (
    <div
      role="menu"
      aria-label={t("hud.pre.moreOptions")}
      style={{ ...menuStyle, alignSelf: "flex-end" }}
      data-testid="hud-menu-overflow"
    >
      <MenuLabel value={countdownLabel(options.countdown)}>{t("hud.menu.countdown")}</MenuLabel>
      {COUNTDOWNS.map((c) => (
        <MenuItem
          key={c}
          checked={options.countdown === c}
          onClick={() => onOptionsChange({ countdown: c })}
        >
          {countdownLabel(c)}
        </MenuItem>
      ))}
      <MenuLabel value={t(options.hideCursor ? "hud.menu.cursorHide" : "hud.menu.cursorShow")}>
        {t("hud.menu.cursor")}
      </MenuLabel>
      <MenuItem
        checked={!options.hideCursor}
        onClick={() => onOptionsChange({ hideCursor: false })}
      >
        {t("hud.menu.cursorShow")}
      </MenuItem>
      <MenuItem checked={options.hideCursor} onClick={() => onOptionsChange({ hideCursor: true })}>
        {t("hud.menu.cursorHide")}
      </MenuItem>
      <MenuLabel value={options.fps}>{t("hud.menu.frameRate")}</MenuLabel>
      {([30, 60] as const).map((f) => (
        <MenuItem key={f} checked={options.fps === f} onClick={() => onOptionsChange({ fps: f })}>
          {t("hud.menu.fps", { fps: f })}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        checked={options.hideHudWhileRecording}
        onClick={() => onOptionsChange({ hideHudWhileRecording: !options.hideHudWhileRecording })}
      >
        {t("hud.menu.hideHudWhileRecording")}
      </MenuItem>
      {props.onOpenSettings ? (
        <>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              props.onOpenSettings?.();
              close();
            }}
          >
            {t("hud.menu.settings")}
          </MenuItem>
        </>
      ) : null}
    </div>
  );
}

/** Warm tint for a chip / strip: warning (terracotta) or danger (record crimson). */
export function toneStyle(tone: "warning" | "danger"): CSSProperties {
  const c = tone === "danger" ? "var(--record)" : "var(--warning)";
  return {
    background: `color-mix(in srgb, ${c} ${tone === "danger" ? 14 : 20}%, transparent)`,
    border: `1px solid color-mix(in srgb, ${c} ${tone === "danger" ? 50 : 55}%, transparent)`,
    color: `color-mix(in srgb, ${c} 35%, var(--text-1))`,
  };
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
        <span
          key={c.id}
          role={c.tone === "danger" ? "alert" : "status"}
          data-testid={`hud-chip-${c.id}`}
          data-tone={c.tone}
          title={c.message}
          style={{
            ...toneStyle(c.tone),
            boxSizing: "border-box",
            height: CHIP_ROW_HEIGHT - 4,
            margin: "2px 0",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            maxWidth: PILL_WIDTH,
            padding: "0 14px",
            borderRadius: "var(--radius-full)",
            backdropFilter: "blur(18px)",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden="true">⚠</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {c.message}
          </span>
        </span>
      ))}
    </div>
  );
}
