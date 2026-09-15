import { Button, Dialog, Input, Tag } from "@design/components";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { EmptyState, Section, Switch } from "../controls";
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

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "0 var(--space-3)",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  color: "var(--text-1)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  minHeight: "24px",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--text-2)" };

const monoStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  color: "var(--text-2)",
  fontVariantNumeric: "tabular-nums",
  overflowWrap: "anywhere",
  minWidth: 0,
};

function InfoRow({
  label,
  children,
  mono = false,
}: { label: string; children: ReactNode; mono?: boolean }): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={mono ? monoStyle : { minWidth: 0 }}>{children}</span>
    </div>
  );
}

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
    <Input
      label={t("inspector.project.name")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(name);
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
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${source.missing ? "var(--warning)" : "var(--border)"}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          justifyContent: "space-between",
        }}
      >
        <span style={monoStyle} title={source.absolutePath}>
          {source.path}
        </span>
        {source.missing ? (
          <Tag variant="accent">{t("inspector.project.missing")}</Tag>
        ) : (
          <span style={{ ...monoStyle, flex: "0 0 auto" }}>
            {source.sizeBytes === null ? "—" : formatBytes(source.sizeBytes)}
          </span>
        )}
      </div>
      {source.missing && (
        <span style={{ fontSize: "12px", color: "var(--text-2)" }}>
          {t("inspector.project.fileNotFound")} <span style={monoStyle}>{source.absolutePath}</span>
        </span>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button
          variant={source.missing ? "primary" : "secondary"}
          onClick={() => onRelink(source.path)}
        >
          {t("inspector.project.relinkButton")}
        </Button>
        {!source.missing && (
          <Button
            variant="ghost"
            onClick={() => onReveal(source.absolutePath)}
            aria-label={t("inspector.project.revealPath", { path: source.path })}
          >
            {t("inspector.project.reveal")}
          </Button>
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
      <Section title={t("inspector.project.section.project")}>
        <NameField name={info.name} onRename={onRename} />
        <div style={{ ...rowStyle, alignItems: "center" }}>
          <span style={labelStyle}>{t("inspector.project.location")}</span>
          <span style={{ ...monoStyle, flex: "1 1 auto" }} data-testid="project-location">
            {info.locationPath}
          </span>
          <Button variant="ghost" onClick={() => onReveal(info.locationPath)}>
            {t("inspector.project.reveal")}
          </Button>
        </div>
        <InfoRow label={t("inspector.project.created")} mono>
          {formatDateTime(info.createdAt, dateOpts)}
        </InfoRow>
        <InfoRow label={t("inspector.project.modified")} mono>
          {formatDateTime(info.modifiedAt, dateOpts)}
        </InfoRow>
      </Section>

      <Section title={t("inspector.project.sourceFiles")}>
        {anyMissing && (
          <EmptyState title={t("inspector.project.offline.title")}>
            {t("inspector.project.offline.body")}
          </EmptyState>
        )}
        {info.sources.map((s) => (
          <SourceRow
            key={`${s.role}:${s.path}`}
            source={s}
            onRelink={onRelink}
            onReveal={onReveal}
          />
        ))}
      </Section>

      <Section title={t("inspector.project.recordingInfo")}>
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
            <span style={{ display: "flex", flexDirection: "column" }}>
              {rec.audioTracks.map((track) => (
                <span key={track}>{track}</span>
              ))}
            </span>
          )}
        </InfoRow>
      </Section>

      <Section title={t("inspector.project.storage")}>
        <Switch
          label={t("inspector.project.saveRaw")}
          hint={t("inspector.project.saveRaw.hint")}
          checked={saveRaw}
          onChange={onSaveRawChange}
        />
        {trimSavingsBytes !== null && (
          <Button onClick={onTrim} disabled={trimSavingsBytes <= 0 || anyMissing}>
            {trimSavingsBytes > 0
              ? t("inspector.project.trimSaves", { size: formatBytes(trimSavingsBytes) })
              : t("inspector.project.trim")}
          </Button>
        )}
      </Section>

      <Section title={t("inspector.project.dangerZone")}>
        <div>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            {t("inspector.project.delete")}
          </Button>
        </div>
      </Section>

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
            gap: "var(--space-2)",
            marginTop: "var(--space-3)",
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
