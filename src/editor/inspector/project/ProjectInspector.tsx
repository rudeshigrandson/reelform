import { useEffect, useId, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Button, Dialog, Input, Tag } from "@design/components";
import { EmptyState, Section, Switch } from "../controls";
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
  color: "var(--color-neutral-200)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  minHeight: "24px",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--color-neutral-400)" };

const monoStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  color: "var(--color-neutral-300)",
  fontVariantNumeric: "tabular-nums",
  overflowWrap: "anywhere",
  minWidth: 0,
};

function InfoRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={mono ? monoStyle : { minWidth: 0 }}>{children}</span>
    </div>
  );
}

function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }): ReactElement {
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
      label="Name"
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

function SourceRow({ source, onRelink, onReveal }: { source: SourceInfo; onRelink: (p: string) => void; onReveal: (p: string) => void }): ReactElement {
  return (
    <div
      data-testid={`source-${source.path}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-2)",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${source.missing ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", justifyContent: "space-between" }}>
        <span style={monoStyle} title={source.absolutePath}>
          {source.path}
        </span>
        {source.missing ? (
          <Tag variant="accent">Missing</Tag>
        ) : (
          <span style={{ ...monoStyle, flex: "0 0 auto" }}>{source.sizeBytes === null ? "—" : formatBytes(source.sizeBytes)}</span>
        )}
      </div>
      {source.missing && (
        <span style={{ fontSize: "12px", color: "var(--color-neutral-400)" }}>
          File not found at <span style={monoStyle}>{source.absolutePath}</span>
        </span>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button variant={source.missing ? "primary" : "secondary"} onClick={() => onRelink(source.path)}>
          Relink media…
        </Button>
        {!source.missing && (
          <Button variant="ghost" onClick={() => onReveal(source.absolutePath)} aria-label={`Reveal ${source.path}`}>
            Reveal
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
    <div style={rootStyle} aria-label="Project inspector">
      <Section title="Project">
        <NameField name={info.name} onRename={onRename} />
        <div style={{ ...rowStyle, alignItems: "center" }}>
          <span style={labelStyle}>Location</span>
          <span style={{ ...monoStyle, flex: "1 1 auto" }} data-testid="project-location">
            {info.locationPath}
          </span>
          <Button variant="ghost" onClick={() => onReveal(info.locationPath)}>
            Reveal
          </Button>
        </div>
        <InfoRow label="Created" mono>
          {formatDateTime(info.createdAt, dateOpts)}
        </InfoRow>
        <InfoRow label="Modified" mono>
          {formatDateTime(info.modifiedAt, dateOpts)}
        </InfoRow>
      </Section>

      <Section title="Source files">
        {anyMissing && (
          <EmptyState title="Media offline">Relink the missing file to preview and export this project.</EmptyState>
        )}
        {info.sources.map((s) => (
          <SourceRow key={`${s.role}:${s.path}`} source={s} onRelink={onRelink} onReveal={onReveal} />
        ))}
      </Section>

      <Section title="Recording info">
        <InfoRow label="Resolution" mono>
          {rec.width} × {rec.height}
        </InfoRow>
        <InfoRow label="Frame rate" mono>
          {Number.isInteger(rec.fps) ? rec.fps : rec.fps.toFixed(2)} fps
        </InfoRow>
        <InfoRow label="Duration" mono>
          {formatDurationMs(rec.durationMs)}
        </InfoRow>
        <InfoRow label="Codec" mono>
          {rec.codec}
        </InfoRow>
        <InfoRow label="Capture">{rec.captureBackend ?? "Unknown"}</InfoRow>
        <InfoRow label="Cursor data" mono>
          {rec.cursorPointCount === null ? "None" : `${rec.cursorPointCount.toLocaleString("en-US")} points`}
        </InfoRow>
        <InfoRow label="Audio tracks">
          {rec.audioTracks.length === 0 ? (
            "None"
          ) : (
            <span style={{ display: "flex", flexDirection: "column" }}>
              {rec.audioTracks.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </span>
          )}
        </InfoRow>
      </Section>

      <Section title="Storage">
        <Switch
          label="Save raw with project"
          hint="Keep the original recording inside the project"
          checked={saveRaw}
          onChange={onSaveRawChange}
        />
        {trimSavingsBytes !== null && (
          <Button onClick={onTrim} disabled={trimSavingsBytes <= 0 || anyMissing}>
            {trimSavingsBytes > 0
              ? `Trim source to used range (saves ${formatBytes(trimSavingsBytes)})`
              : "Trim source to used range"}
          </Button>
        )}
      </Section>

      <Section title="Danger zone">
        <div>
          <Button
            onClick={() => setConfirmOpen(true)}
            style={{ color: "var(--color-accent)", borderColor: "var(--color-accent)" }}
          >
            Delete project
          </Button>
        </div>
      </Section>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        title="Delete project?"
        actions={
          <>
            <Button variant="ghost" onClick={closeConfirm}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onDelete({ alsoDeleteRecordings });
                closeConfirm();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          “{info.name}” will be removed. This can’t be undone.
        </p>
        <label
          htmlFor={checkboxId}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-3)" }}
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={alsoDeleteRecordings}
            onChange={(e) => setAlsoDeleteRecordings(e.target.checked)}
          />
          Also delete recording files
        </label>
      </Dialog>
    </div>
  );
}
