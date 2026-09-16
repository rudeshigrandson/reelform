import { Button } from "@design/components";
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from "react";
import {
  Callout,
  ChoiceRow,
  ColorField,
  EmptyState,
  NumberField,
  ProgressBar,
  Section,
  Slider,
  Switch,
  clamp,
  hintStyle,
  inspectorRootStyle,
  monoStyle,
  useInspectorControlStyles,
  visuallyHidden,
} from "../controls";
import { type InspectorMessageKey, useInspectorT } from "../i18n";
import {
  addCaptionAt,
  filterCaptions,
  findActiveCaption,
  formatClock,
  formatCueTime,
  mergeWithPrevious,
  splitCaption,
  updateCaptionText,
} from "./logic";
import {
  CAPTION_LANGUAGES,
  CAPTION_MODELS,
  CAPTION_PRESETS,
  DEFAULT_CAPTION_FONTS,
  applyPreset,
  modelInfo,
} from "./types";
import type {
  Caption,
  CaptionLanguage,
  CaptionModel,
  CaptionPosition,
  CaptionStyle,
  GenerationStatus,
} from "./types";

export interface CaptionsInspectorProps {
  captions: readonly Caption[];
  onCaptionsChange: (captions: Caption[]) => void;
  style: CaptionStyle;
  onStyleChange: (style: CaptionStyle) => void;
  status: GenerationStatus;
  /** Whether the selected model is present in `userData/models`. */
  modelDownloaded: boolean;
  model: CaptionModel;
  onModelChange: (model: CaptionModel) => void;
  /** Whisper language code or "auto". */
  language: string;
  onLanguageChange: (language: string) => void;
  languages?: readonly CaptionLanguage[] | undefined;
  onGenerate: () => void;
  onDownloadModel: () => void;
  onSeek: (ms: number) => void;
  /** Playhead, timeline ms. */
  currentMs: number;
  /** Timeline duration; new captions never extend past it. */
  durationMs?: number | undefined;
  burnIn: boolean;
  onBurnInChange: (burnIn: boolean) => void;
  onExportSrt: () => void;
  onExportVtt: () => void;
  fonts?: readonly string[] | undefined;
  onAddCustomFont?: (() => void) | undefined;
  /** "Cancel" while the model downloads; hidden when absent. */
  onCancelDownload?: (() => void) | undefined;
  /** "Import .srt/.vtt…"; hidden when absent. */
  onImportSidecar?: (() => void) | undefined;
  /** Transient note under the export buttons, e.g. "Saved captions.srt". */
  exportNotice?: string | null | undefined;
}

const ADD_FONT = "__add-custom-font__";

const columnStyle = (gap: string): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap,
  minWidth: 0,
});

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  minWidth: 0,
};

/** Design pill select: sunken, 999px, strong border, trailing ⌄. */
const pillSelectStyle: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "6px 24px 6px 10px",
  borderRadius: "999px",
  background: "var(--bg-sunken)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "11px",
  cursor: "pointer",
  textOverflow: "ellipsis",
};

const POSITION_OPTIONS: ReadonlyArray<{ value: CaptionPosition; labelKey: InspectorMessageKey }> = [
  { value: "bottom", labelKey: "inspector.captions.position.bottom" },
  { value: "top", labelKey: "inspector.captions.position.top" },
  { value: "custom", labelKey: "inspector.captions.position.custom" },
];

function PillSelect({
  id,
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean | undefined;
  onChange: (value: string) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <span style={{ position: "relative", flex: "1 1 0", minWidth: 0, display: "flex" }}>
      <label htmlFor={id} style={visuallyHidden}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...pillSelectStyle, opacity: disabled ? 0.45 : 1 }}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "10px",
          top: "50%",
          transform: "translateY(-55%)",
          color: "var(--text-3)",
          pointerEvents: "none",
        }}
      >
        ⌄
      </span>
    </span>
  );
}

/** Live style sample on a sunken 12px box. Caption colours are user data. */
function CaptionPreview({ style, sample }: { style: CaptionStyle; sample: string }): ReactElement {
  const text = style.uppercase ? sample.toUpperCase() : sample;
  const space = text.indexOf(" ");
  const first = space === -1 ? text : text.slice(0, space);
  const rest = space === -1 ? "" : text.slice(space);
  return (
    <div
      aria-hidden="true"
      style={{
        padding: "12px",
        borderRadius: "12px",
        background: "var(--bg-sunken)",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          padding: "6px 14px",
          borderRadius: "999px",
          background: `color-mix(in srgb, ${style.bgColor} ${clamp(style.bgOpacity, 0, 100)}%, transparent)`,
          fontFamily: `"${style.font}", var(--font-body)`,
          fontSize: "13px",
          fontWeight: 700,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: style.color,
          WebkitTextStroke: style.outline ? `0.6px ${style.bgColor}` : undefined,
        }}
      >
        <span style={{ color: style.wordHighlight ? style.highlightColor : style.color }}>
          {first}
        </span>
        {rest}
      </div>
    </div>
  );
}

/** Pending caret placement after split/merge re-renders the list. */
interface FocusRequest {
  id: string;
  caret: number;
}

/** Captions inspector tab (design S18 / S18b). Presentational — all state via props. */
export function CaptionsInspector(props: CaptionsInspectorProps): ReactElement {
  useInspectorControlStyles();
  const t = useInspectorT();
  const {
    captions,
    onCaptionsChange,
    style,
    onStyleChange,
    status,
    modelDownloaded,
    model,
    onModelChange,
    language,
    onLanguageChange,
    languages = CAPTION_LANGUAGES,
    onGenerate,
    onDownloadModel,
    onSeek,
    currentMs,
    durationMs,
    burnIn,
    onBurnInChange,
    onExportSrt,
    onExportVtt,
    fonts = DEFAULT_CAPTION_FONTS,
    onAddCustomFont,
  } = props;

  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());

  useLayoutEffect(() => {
    if (!focusRequest) return;
    const el = inputs.current.get(focusRequest.id);
    if (el) {
      el.focus();
      el.setSelectionRange(focusRequest.caret, focusRequest.caret);
    }
    setFocusRequest(null);
  }, [focusRequest, captions]);

  const busy = status.kind === "downloading" || status.kind === "transcribing";
  const info = modelInfo(model);
  const visible = filterCaptions(captions, query);
  const searching = query.trim() !== "";
  const active = findActiveCaption(captions, currentMs);
  const addAtPlayhead = addCaptionAt(captions, currentMs, { maxMs: durationMs });
  const hasExportable = captions.some((c) => c.text.trim() !== "");
  const isEmpty = captions.length === 0;
  const set = <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]): void =>
    onStyleChange({ ...style, [key]: value });

  const languageEntry = languages.find((l) => l.code === language);
  const languageLabel = languageEntry
    ? languageEntry.labelKey
      ? t(languageEntry.labelKey)
      : languageEntry.label
    : language;
  const previewSample =
    (active ?? captions.find((c) => c.text.trim() !== ""))?.text.split("\n")[0]?.trim() ||
    t("inspector.captions.preview.sample");

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, cap: Caption): void => {
    const el = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (el.selectionStart !== el.selectionEnd) return;
      const r = splitCaption(captions, cap.id, el.selectionStart);
      if (!r) return;
      onCaptionsChange(r.captions);
      setFocusRequest({ id: r.newId, caret: 0 });
      return;
    }
    // Merging into a row hidden by the search filter would be surprising; only when unfiltered.
    if (e.key === "Backspace" && !searching && el.selectionStart === 0 && el.selectionEnd === 0) {
      const r = mergeWithPrevious(captions, cap.id);
      if (!r) return;
      e.preventDefault();
      onCaptionsChange(r.captions);
      setFocusRequest({ id: r.mergedId, caret: r.cursor });
    }
  };

  const handleAdd = (): void => {
    if (!addAtPlayhead) return;
    onCaptionsChange(addAtPlayhead.captions);
    setFocusRequest({ id: addAtPlayhead.id, caret: 0 });
  };

  const primaryAction = modelDownloaded ? (
    <Button variant={isEmpty ? "primary" : "secondary"} block={!isEmpty} onClick={onGenerate}>
      {t("inspector.captions.generateCaptions")}
    </Button>
  ) : (
    <Button variant="primary" block={!isEmpty} onClick={onDownloadModel}>
      {t("inspector.captions.download", { size: info.size })}
    </Button>
  );

  const statusBlock =
    status.kind === "downloading" ? (
      <div role="status" style={columnStyle("10px")}>
        <div style={rowStyle}>
          <span style={{ fontSize: "12px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {t("inspector.captions.downloading", {
              model: t(info.labelKey),
              percent: Math.round(clamp(status.progress, 0, 1) * 100),
              size: info.size,
            })}
          </span>
        </div>
        <ProgressBar value={status.progress} label={t("inspector.captions.modelDownload")} />
        <div style={{ ...rowStyle, justifyContent: "flex-start" }}>
          <span style={{ ...hintStyle, flex: "1 1 auto" }}>
            {CAPTION_MODELS.map((m) => `${t(m.labelKey)} ${m.size}`).join(" · ")}
          </span>
          {props.onCancelDownload && (
            <Button variant="ghost" onClick={props.onCancelDownload}>
              {t("inspector.common.cancel")}
            </Button>
          )}
        </div>
      </div>
    ) : status.kind === "transcribing" ? (
      <div role="status" style={columnStyle("10px")}>
        <span style={{ fontSize: "12px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {t("inspector.captions.transcribing", {
            percent: Math.round(clamp(status.progress, 0, 1) * 100),
            done: formatClock(status.doneMs),
            total: formatClock(status.totalMs),
          })}
        </span>
        <ProgressBar
          value={status.progress}
          label={t("inspector.captions.transcription")}
          color="var(--track-captions)"
        />
        <span style={{ ...hintStyle, color: "var(--text-3)" }}>
          {t("inspector.captions.keepEditing")}
        </span>
      </div>
    ) : null;

  return (
    <div style={{ ...inspectorRootStyle, gap: "12px" }} aria-label={t("inspector.captions.label")}>
      {/* ── Generate: language · model, privacy, progress ───────── */}
      <div role="group" aria-label={t("inspector.captions.generate")} style={columnStyle("12px")}>
        <div style={{ display: "flex", gap: "6px", minWidth: 0 }}>
          <PillSelect
            id="captions-language"
            label={t("inspector.captions.language")}
            value={language}
            disabled={busy}
            onChange={onLanguageChange}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.labelKey ? t(l.labelKey) : l.label}
              </option>
            ))}
          </PillSelect>
          <PillSelect
            id="captions-model"
            label={t("inspector.captions.model")}
            value={model}
            disabled={busy}
            onChange={(v) => {
              const next = CAPTION_MODELS.find((m) => m.id === v);
              if (next) onModelChange(next.id);
            }}
          >
            {CAPTION_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.labelKey)} · {m.size}
              </option>
            ))}
          </PillSelect>
        </div>
        <span style={{ color: "var(--text-3)" }}>{t("inspector.captions.onDevice")}</span>

        {statusBlock}

        {status.kind === "error" && (
          <Callout tone="danger" role="alert">
            <span>{status.message}</span>
            {modelDownloaded && (
              <span>
                <Button variant="ghost" onClick={onGenerate}>
                  {t("inspector.captions.tryAgain")}
                </Button>
              </span>
            )}
          </Callout>
        )}

        {!busy && !isEmpty && primaryAction}
      </div>

      {/* ── Caption list ─────────────────────────────────────── */}
      <div role="group" aria-label={t("inspector.captions.captions")} style={columnStyle("6px")}>
        {isEmpty ? (
          busy ? null : (
            <EmptyState
              icon={<span style={{ fontSize: "14px", fontWeight: 700 }}>CC</span>}
              title={t("inspector.captions.empty.title")}
              action={primaryAction}
              footnote={t("inspector.captions.empty.footnote", {
                language: languageLabel,
                model: t(info.labelKey),
              })}
            >
              {t("inspector.captions.empty.body")}
            </EmptyState>
          )
        ) : (
          <>
            <input
              type="search"
              aria-label={t("inspector.captions.search")}
              placeholder={t("inspector.captions.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...pillSelectStyle, cursor: "text", padding: "6px 12px" }}
            />
            {visible.length === 0 ? (
              <span role="status" style={hintStyle}>
                {t("inspector.captions.noMatch", { query: query.trim() })}
              </span>
            ) : (
              <ul
                aria-label={t("inspector.captions.list")}
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {visible.map((c) => {
                  const isActive = active?.id === c.id;
                  const isEditing = editingId === c.id;
                  return (
                    <li
                      key={c.id}
                      data-active={isActive || undefined}
                      data-editing={isEditing || undefined}
                      onClick={() => onSeek(c.startMs)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        padding: "9px 10px",
                        borderRadius: "10px",
                        cursor: "pointer",
                        background: "var(--bg-panel-raised)",
                        border: `1px solid ${
                          isEditing
                            ? "var(--accent)"
                            : isActive
                              ? "color-mix(in srgb, var(--accent) 45%, transparent)"
                              : "transparent"
                        }`,
                      }}
                    >
                      <span
                        title={`${formatCueTime(c.startMs)} – ${formatCueTime(c.endMs)}`}
                        style={{
                          ...monoStyle,
                          flex: "none",
                          lineHeight: "16px",
                          color: "var(--track-captions)",
                        }}
                      >
                        {formatCueTime(c.startMs)}
                      </span>
                      <textarea
                        ref={(el) => {
                          if (el) inputs.current.set(c.id, el);
                          else inputs.current.delete(c.id);
                        }}
                        aria-label={t("inspector.captions.caption", {
                          time: formatCueTime(c.startMs),
                        })}
                        rows={Math.max(1, c.text.split("\n").length)}
                        value={c.text}
                        placeholder={t("inspector.captions.placeholder")}
                        onFocus={() => setEditingId(c.id)}
                        onBlur={() => setEditingId((id) => (id === c.id ? null : id))}
                        onChange={(e) =>
                          onCaptionsChange(updateCaptionText(captions, c.id, e.target.value))
                        }
                        onKeyDown={(e) => handleKeyDown(e, c)}
                        style={{
                          flex: "1 1 auto",
                          minWidth: 0,
                          resize: "none",
                          background: "transparent",
                          color: "var(--text-1)",
                          caretColor: "var(--accent-hover)",
                          border: 0,
                          outline: "none",
                          padding: 0,
                          fontFamily: "var(--font-body)",
                          fontSize: "11px",
                          lineHeight: "16px",
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        <Button
          variant="secondary"
          block
          disabled={!addAtPlayhead}
          title={addAtPlayhead ? undefined : t("inspector.captions.playheadInside")}
          onClick={handleAdd}
        >
          {t("inspector.captions.add")}
        </Button>
      </div>

      {/* ── Style ────────────────────────────────────────────── */}
      <Section title={t("inspector.common.style")}>
        <ChoiceRow
          label={t("inspector.captions.preset")}
          variant="chip"
          value={style.preset}
          options={CAPTION_PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) }))}
          onChange={(id) => onStyleChange(applyPreset(style, id))}
        />
        <CaptionPreview style={style} sample={previewSample} />
        <Switch
          label={t("inspector.captions.wordHighlight")}
          hint={t("inspector.captions.wordHighlight.hint")}
          checked={style.wordHighlight}
          onChange={(v) => set("wordHighlight", v)}
        />
        {style.wordHighlight && (
          <ColorField
            label={t("inspector.common.highlight")}
            value={style.highlightColor}
            onChange={(v) => set("highlightColor", v)}
          />
        )}
        <div style={rowStyle}>
          <span style={{ color: "var(--text-2)" }}>{t("inspector.common.position")}</span>
          <ChoiceRow
            label={t("inspector.common.position")}
            value={style.position}
            options={POSITION_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => set("position", v)}
          />
        </div>
        {style.position === "custom" && (
          <Slider
            label={t("inspector.common.y")}
            value={style.customY}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => set("customY", v)}
          />
        )}
        <div style={rowStyle}>
          <label htmlFor="captions-font" style={{ color: "var(--text-2)", flex: "0 0 66px" }}>
            {t("inspector.common.font")}
          </label>
          <span style={{ position: "relative", flex: "1 1 auto", minWidth: 0, display: "flex" }}>
            <select
              id="captions-font"
              value={style.font}
              onChange={(e) => {
                if (e.target.value === ADD_FONT) onAddCustomFont?.();
                else set("font", e.target.value);
              }}
              style={pillSelectStyle}
            >
              {(fonts.includes(style.font) ? fonts : [style.font, ...fonts]).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {onAddCustomFont && (
                <option value={ADD_FONT}>{t("inspector.captions.addFont")}</option>
              )}
            </select>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-55%)",
                color: "var(--text-3)",
                pointerEvents: "none",
              }}
            >
              ⌄
            </span>
          </span>
        </div>
        <Slider
          label={t("inspector.common.size")}
          value={style.sizePx}
          min={12}
          max={120}
          unit="px"
          onChange={(v) => set("sizePx", v)}
        />
        <ColorField
          label={t("inspector.common.color")}
          value={style.color}
          onChange={(v) => set("color", v)}
        />
        <ColorField
          label={t("inspector.common.background")}
          value={style.bgColor}
          onChange={(v) => set("bgColor", v)}
        />
        <Slider
          label={t("inspector.captions.bgOpacity")}
          value={style.bgOpacity}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => set("bgOpacity", v)}
        />
        <NumberField
          label={t("inspector.captions.maxLines")}
          value={style.maxLines}
          min={1}
          max={3}
          onChange={(v) => set("maxLines", Math.round(v))}
        />
        <Switch
          label={t("inspector.captions.uppercase")}
          checked={style.uppercase}
          onChange={(v) => set("uppercase", v)}
        />
      </Section>

      {/* ── Export ───────────────────────────────────────────── */}
      <div
        role="group"
        aria-label={t("inspector.captions.export")}
        style={{
          ...columnStyle("12px"),
          paddingTop: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <Switch label={t("inspector.captions.burnIn")} checked={burnIn} onChange={onBurnInChange} />
        <div style={{ display: "flex", gap: "8px" }}>
          <Button
            variant="secondary"
            disabled={!hasExportable}
            onClick={onExportSrt}
            style={{ flex: "1 1 0" }}
          >
            {t("inspector.captions.exportSrt")}
          </Button>
          <Button
            variant="secondary"
            disabled={!hasExportable}
            onClick={onExportVtt}
            style={{ flex: "1 1 0" }}
          >
            {t("inspector.captions.exportVtt")}
          </Button>
        </div>
        {props.onImportSidecar && (
          <Button variant="ghost" disabled={busy} onClick={props.onImportSidecar}>
            {t("inspector.captions.importButton")}
          </Button>
        )}
        {props.exportNotice ? (
          <output style={{ ...hintStyle, display: "block" }}>{props.exportNotice}</output>
        ) : null}
      </div>
    </div>
  );
}
