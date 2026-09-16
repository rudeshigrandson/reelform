import { Button, Dialog, Tag } from "@design/components";
import { type CSSProperties, type ReactElement, useEffect, useId, useState } from "react";
import {
  Callout,
  Card,
  GroupLabel,
  InfoRow,
  Switch,
  groupLabelStyle,
  hintStyle,
  inspectorRootStyle,
  monoStyle,
} from "../controls";
import { useInspectorT } from "../i18n";
import { formatBytes, formatDateTime, formatDurationMs } from "./logic";
import type { DeleteProjectOptions, ProjectInfo, SourceInfo } from "./types";

/** Inspector → Project tab (design guide S21). Presentational; all effects go through callbacks. */
export interface ProjectInspectorProps {
  info: ProjectInfo;
  /** Called with the trimmed new name when it changes. */
  onRename: (name: string) => void;
  /** Reveal a path in Finder / Explorer. */
  onReveal: (path: string) => void;
  /** Open the relink flow for a source (relative path). */
  onRelink: (sourcePath: string) => void;
  saveRaw: boolean;
  onSaveRawChange: (saveRaw: boolean) => void;
  /** `null` = not computable (button hidden); `0` = nothing to trim (disabled). */
  trimSavingsBytes: number | null;
  onTrim: () => void;
  onDelete: (opts: DeleteProjectOptions) => void;
  /** Deterministic date formatting (tests, user locale). */
  locale?: string | undefined;
  timeZone?: string | undefined;
}

const rootStyle: CSSProperties = { ...inspectorRootStyle };

const stack = (gap: string): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap,
  minWidth: 0,
});

const ellipsis: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

/** Accent text action (design "Reveal" / "Relink…"). */
const linkButton: CSSProperties = {
  flex: "0 0 auto",
  height: "auto",
  minHeight: 0,
  padding: "0 2px",
  fontSize: "11px",
  color: "var(--accent-hover)",
};

/** Secondary full-width pill (design "Trim source to used range"). */
const pillButton: CSSProperties = { width: "100%", fontSize: "12px" };

function NameField({
  name,
  onRename,
}: { name: string; onRename: (name: string) => void }): ReactElement {
  const t = useInspectorT();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = (): void => {
    const next = draft.trim();
    if (next === "" || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };
  return (
    <input
      aria-label={t("inspector.project.name")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(name);
      }}
      style={{
        boxSizing: "border-box",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "10px",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
        fontSize: "13px",
        outline: "none",
      }}
    />
  );
}

function SourceRow({
  source,
  onRelink,
  onReveal,
}: {
  source: SourceInfo;
  onRelink: (p: string) => void;
  onReveal: (p: string) => void;
}): ReactElement {
  const t = useInspectorT();
  return (
    <div
      data-testid={`source-${source.path}`}
      style={{
        ...stack("6px"),
        ...(source.missing
          ? {
              padding: "10px 12px",
              borderRadius: "12px",
              background: "color-mix(in srgb, var(--accent-hover) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent-hover) 35%, transparent)",
            }
          : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ ...monoStyle, ...ellipsis, flex: "1 1 auto" }} title={source.absolutePath}>
          {source.path}
        </span>
        {source.missing ? (
          <Tag variant="accent">{t("inspector.project.missing")}</Tag>
        ) : (
          <span style={{ ...monoStyle, color: "var(--text-3)", flex: "0 0 auto" }}>
            {source.sizeBytes === null ? "—" : formatBytes(source.sizeBytes)}
          </span>
        )}
      </div>
      {source.missing && (
        <span style={{ color: "var(--text-2)", overflowWrap: "anywhere" }}>
          {t("inspector.project.fileNotFound")}{" "}
          <span style={{ ...monoStyle, color: "var(--text-2)" }}>{source.absolutePath}</span>
        </span>
      )}
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        {source.missing ? (
          <Button variant="primary" style={pillButton} onClick={() => onRelink(source.path)}>
            {t("inspector.project.relinkButton")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" style={linkButton} onClick={() => onRelink(source.path)}>
              {t("inspector.project.relinkButton")}
            </Button>
            <Button
              variant="ghost"
              style={linkButton}
              onClick={() => onReveal(source.absolutePath)}
              aria-label={t("inspector.project.revealPath", { path: source.path })}
            >
              {t("inspector.project.reveal")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function ProjectInspector({
  info,
  onRename,
  onReveal,
  onRelink,
  saveRaw,
  onSaveRawChange,
  trimSavingsBytes,
  onTrim,
  onDelete,
  locale,
  timeZone,
}: ProjectInspectorProps): ReactElement {
  const t = useInspectorT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [alsoDeleteRecordings, setAlsoDeleteRecordings] = useState(false);
  const checkboxId = useId();
  const dateOpts = { locale, timeZone };
  const rec = info.recording;
  const anyMissing = info.sources.some((s) => s.missing);

  const closeConfirm = (): void => {
    setConfirmOpen(false);
    setAlsoDeleteRecordings(false);
  };

  return (
    <div style={rootStyle} aria-label={t("inspector.project.label")}>
      <section aria-label={t("inspector.project.section.project")} style={stack("6px")}>
        <NameField name={info.name} onRename={onRename} />
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-3)" }}>
          <span
            style={{ ...monoStyle, ...ellipsis, color: "var(--text-3)", flex: "1 1 auto" }}
            title={info.locationPath}
            aria-label={t("inspector.project.location")}
            data-testid="project-location"
          >
            {info.locationPath}
          </span>
          <Button variant="ghost" style={linkButton} onClick={() => onReveal(info.locationPath)}>
            {t("inspector.project.reveal")}
          </Button>
        </div>
        <div style={{ ...hintStyle, display: "flex", flexWrap: "wrap", columnGap: "4px" }}>
          <span>{t("inspector.project.created")}</span>
          <span>{formatDateTime(info.createdAt, dateOpts)}</span>
          <span aria-hidden="true">·</span>
          <span>{t("inspector.project.modified")}</span>
          <span>{formatDateTime(info.modifiedAt, dateOpts)}</span>
        </div>
      </section>

      <Card gap="7px" aria-label={t("inspector.project.recordingInfo")} role="group">
        <GroupLabel>{t("inspector.project.recordingInfo")}</GroupLabel>
        <InfoRow label={t("inspector.project.resolution")} mono>
          {rec.width} × {rec.height}
        </InfoRow>
        <InfoRow label={t("inspector.project.frameRate")} mono>
          {t("inspector.project.fps", {
            fps: Number.isInteger(rec.fps) ? String(rec.fps) : rec.fps.toFixed(2),
          })}
        </InfoRow>
        <InfoRow label={t("inspector.common.duration")} mono>
          {formatDurationMs(rec.durationMs)}
        </InfoRow>
        <InfoRow label={t("inspector.project.codec")} mono>
          {rec.codec}
        </InfoRow>
        <InfoRow label={t("inspector.project.capture")}>
          {rec.captureBackend ?? t("inspector.common.unknown")}
        </InfoRow>
        <InfoRow label={t("inspector.project.cursorData")} mono>
          {rec.cursorPointCount === null
            ? t("inspector.common.none")
            : t("inspector.project.cursorPoints", { count: rec.cursorPointCount })}
        </InfoRow>
        <InfoRow label={t("inspector.project.audioTracks")}>
          {rec.audioTracks.length === 0 ? (
            t("inspector.common.none")
          ) : (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              {rec.audioTracks.map((track) => (
                <span key={track}>{track}</span>
              ))}
            </span>
          )}
        </InfoRow>
      </Card>

      <section aria-label={t("inspector.project.sourceFiles")} style={stack("8px")}>
        <span style={{ color: "var(--text-2)" }}>{t("inspector.project.sourceFiles")}</span>
        {anyMissing && (
          <Callout tone="warning" role="status" title={t("inspector.project.offline.title")}>
            {t("inspector.project.offline.body")}
          </Callout>
        )}
        {info.sources.map((s) => (
          <SourceRow
            key={`${s.role}:${s.path}`}
            source={s}
            onRelink={onRelink}
            onReveal={onReveal}
          />
        ))}
      </section>

      <section aria-label={t("inspector.project.storage")} style={stack("8px")}>
        <Switch
          label={t("inspector.project.saveRaw")}
          hint={t("inspector.project.saveRaw.hint")}
          checked={saveRaw}
          onChange={onSaveRawChange}
        />
        {trimSavingsBytes !== null && (
          <Button
            style={pillButton}
            onClick={onTrim}
            disabled={trimSavingsBytes <= 0 || anyMissing}
          >
            {trimSavingsBytes > 0
              ? t("inspector.project.trimSaves", { size: formatBytes(trimSavingsBytes) })
              : t("inspector.project.trim")}
          </Button>
        )}
      </section>

      <section
        aria-label={t("inspector.project.dangerZone")}
        style={{
          ...stack("8px"),
          padding: "12px",
          borderRadius: "12px",
          background: "color-mix(in srgb, var(--record) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--record) 40%, transparent)",
        }}
      >
        <span
          style={{
            ...groupLabelStyle,
            color: "color-mix(in srgb, var(--record) 45%, var(--text-1))",
          }}
        >
          {t("inspector.project.dangerZone")}
        </span>
        <Button
          variant="danger"
          style={{
            ...pillButton,
            background: "color-mix(in srgb, var(--record) 20%, transparent)",
            border: "1px solid color-mix(in srgb, var(--record) 60%, transparent)",
            color: "color-mix(in srgb, var(--record) 30%, var(--text-1))",
          }}
          onClick={() => setConfirmOpen(true)}
        >
          {t("inspector.project.delete")}
        </Button>
      </section>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        title={t("inspector.project.deleteConfirm.title")}
        actions={
          <>
            <Button variant="ghost" onClick={closeConfirm}>
              {t("inspector.common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onDelete({ alsoDeleteRecordings });
                closeConfirm();
              }}
            >
              {t("inspector.common.delete")}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {t("inspector.project.deleteConfirm.body", { name: info.name })}
        </p>
        <label
          htmlFor={checkboxId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "14px",
          }}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={alsoDeleteRecordings}
            onChange={(e) => setAlsoDeleteRecordings(e.target.checked)}
          />
          {t("inspector.project.deleteConfirm.recordings")}
        </label>
      </Dialog>
    </div>
  );
}
