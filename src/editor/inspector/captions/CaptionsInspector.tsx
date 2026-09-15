import { Button, Input, Segmented } from "@design/components";
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { ColorField, EmptyState, NumberField, Section, Slider, Switch, clamp } from "../controls";
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

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const ADD_FONT = "__add-custom-font__";

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "28px",
};
const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--text-2)" };
const hintStyle: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };

const selectStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  background: "var(--bg-sunken)",
  color: "var(--text-1)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  padding: "2px var(--space-1)",
  fontFamily: "var(--font-body)",
  fontSize: "12px",
};

const POSITION_OPTIONS: ReadonlyArray<{ value: CaptionPosition; labelKey: InspectorMessageKey }> = [
  { value: "bottom", labelKey: "inspector.captions.position.bottom" },
  { value: "top", labelKey: "inspector.captions.position.top" },
  { value: "custom", labelKey: "inspector.captions.position.custom" },
];

function ProgressBar({ value, label }: { value: number; label: string }): ReactElement {
  const pct = Math.round(clamp(value, 0, 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={{
        height: "4px",
        borderRadius: "999px",
        background: "var(--bg-active)",
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
    </div>
  );
}

/** Pending caret placement after split/merge re-renders the list. */
interface FocusRequest {
  id: string;
  caret: number;
}

/** Captions inspector tab (design guide S18). Presentational — all state via props. */
export function CaptionsInspector(props: CaptionsInspectorProps): ReactElement {
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
  const set = <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]): void =>
    onStyleChange({ ...style, [key]: value });

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

  return (
    <div style={rootStyle} aria-label={t("inspector.captions.label")}>
      {/* ── Generate ─────────────────────────────────────────── */}
      <Section title={t("inspector.captions.generate")}>
        <div style={rowStyle}>
          <label htmlFor="captions-language" style={labelStyle}>
            {t("inspector.captions.language")}
          </label>
          <select
            id="captions-language"
            value={language}
            disabled={busy}
            onChange={(e) => onLanguageChange(e.target.value)}
            style={selectStyle}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.labelKey ? t(l.labelKey) : l.label}
              </option>
            ))}
          </select>
        </div>
        <div style={rowStyle}>
          <label htmlFor="captions-model" style={labelStyle}>
            {t("inspector.captions.model")}
          </label>
          <select
            id="captions-model"
            value={model}
            disabled={busy}
            onChange={(e) => {
              const next = CAPTION_MODELS.find((m) => m.id === e.target.value);
              if (next) onModelChange(next.id);
            }}
            style={selectStyle}
          >
            {CAPTION_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.labelKey)} · {m.size}
              </option>
            ))}
          </select>
        </div>

        {status.kind === "downloading" ? (
          <div
            role="status"
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            <span>
              {t("inspector.captions.downloading", {
                model: t(info.labelKey),
                percent: Math.round(clamp(status.progress, 0, 1) * 100),
                size: info.size,
              })}
            </span>
            <ProgressBar value={status.progress} label={t("inspector.captions.modelDownload")} />
            {props.onCancelDownload && (
              <Button variant="ghost" onClick={props.onCancelDownload}>
                {t("inspector.common.cancel")}
              </Button>
            )}
          </div>
        ) : status.kind === "transcribing" ? (
          <div
            role="status"
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {t("inspector.captions.transcribing", {
                percent: Math.round(clamp(status.progress, 0, 1) * 100),
                done: formatClock(status.doneMs),
                total: formatClock(status.totalMs),
              })}
            </span>
            <ProgressBar value={status.progress} label={t("inspector.captions.transcription")} />
          </div>
        ) : modelDownloaded ? (
          <Button variant="primary" block onClick={onGenerate}>
            {t("inspector.captions.generateCaptions")}
          </Button>
        ) : (
          <Button variant="primary" block onClick={onDownloadModel}>
            {t("inspector.captions.download", { size: info.size })}
          </Button>
        )}

        {status.kind === "error" && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
              color: "var(--danger)",
            }}
          >
            <span>{status.message}</span>
            {modelDownloaded && (
              <Button variant="ghost" onClick={onGenerate}>
                {t("inspector.captions.tryAgain")}
              </Button>
            )}
          </div>
        )}
        <span style={hintStyle}>{t("inspector.captions.onDevice")}</span>
      </Section>

      {/* ── Caption list ─────────────────────────────────────── */}
      <Section title={t("inspector.captions.captions")}>
        {captions.length === 0 ? (
          status.kind === "transcribing" ? null : (
            <EmptyState title={t("inspector.captions.empty.title")}>
              {t("inspector.captions.empty.body")}
            </EmptyState>
          )
        ) : (
          <>
            <Input
              type="search"
              aria-label={t("inspector.captions.search")}
              placeholder={t("inspector.captions.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
                  gap: "2px",
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
                        flexDirection: "column",
                        gap: "2px",
                        padding: "var(--space-1) var(--space-2)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        border: `1px solid ${isEditing ? "var(--accent)" : "transparent"}`,
                        background: isActive ? "var(--bg-active)" : "transparent",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: "11px",
                          color: "var(--text-2)",
                        }}
                      >
                        {formatCueTime(c.startMs)} – {formatCueTime(c.endMs)}
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
                          resize: "none",
                          background: "transparent",
                          color: "var(--text-1)",
                          border: 0,
                          outline: "none",
                          padding: 0,
                          fontFamily: "var(--font-body)",
                          fontSize: "13px",
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
      </Section>

      {/* ── Style ────────────────────────────────────────────── */}
      <Section title={t("inspector.common.style")}>
        <div
          role="radiogroup"
          aria-label={t("inspector.captions.preset")}
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}
        >
          {CAPTION_PRESETS.map((p) => {
            const selected = style.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onStyleChange(applyPreset(style, p.id))}
                style={{
                  appearance: "none",
                  cursor: "pointer",
                  padding: "2px var(--space-2)",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontFamily: "var(--font-body)",
                  border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                  background: selected ? "var(--accent)" : "var(--bg-sunken)",
                  color: selected ? "var(--on-accent)" : "var(--text-1)",
                }}
              >
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
        <div style={rowStyle}>
          <label htmlFor="captions-font" style={labelStyle}>
            {t("inspector.common.font")}
          </label>
          <select
            id="captions-font"
            value={style.font}
            onChange={(e) => {
              if (e.target.value === ADD_FONT) onAddCustomFont?.();
              else set("font", e.target.value);
            }}
            style={selectStyle}
          >
            {(fonts.includes(style.font) ? fonts : [style.font, ...fonts]).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            {onAddCustomFont && <option value={ADD_FONT}>{t("inspector.captions.addFont")}</option>}
          </select>
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
        <div style={rowStyle}>
          <span style={labelStyle}>{t("inspector.common.position")}</span>
          <Segmented
            name="captions-position"
            size="sm"
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
        <NumberField
          label={t("inspector.captions.maxLines")}
          value={style.maxLines}
          min={1}
          max={3}
          onChange={(v) => set("maxLines", Math.round(v))}
        />
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
        <Switch
          label={t("inspector.captions.uppercase")}
          checked={style.uppercase}
          onChange={(v) => set("uppercase", v)}
        />
      </Section>

      {/* ── Export ───────────────────────────────────────────── */}
      <Section title={t("inspector.captions.export")}>
        <Switch label={t("inspector.captions.burnIn")} checked={burnIn} onChange={onBurnInChange} />
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" disabled={!hasExportable} onClick={onExportSrt}>
            {t("inspector.captions.exportSrt")}
          </Button>
          <Button variant="secondary" disabled={!hasExportable} onClick={onExportVtt}>
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
      </Section>
    </div>
  );
}
