import { Button, Dialog, Tag } from "@design/components";
import type { TagProps } from "@design/components";
import { useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { PillSegmented, formatTimecode, mono } from "../export/ui/controls";
import { type ProjectsKey, type ProjectsTranslate, useProjectsT } from "./i18n";
import type {
  CardAction,
  ProjectBrowserProps,
  ProjectLayout,
  ProjectState,
  ProjectSummary,
  SortKey,
} from "./types";

/**
 * Project browser (guide S23) and the launcher's project shelf (S04): header
 * with search, Grid / List and sort; shelf cards or a dense list; footer with
 * the library count and the New / Import / Cancel / Open actions.
 */

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; labelKey: ProjectsKey }> = [
  { value: "recent", labelKey: "projects.sort.recent" },
  { value: "name", labelKey: "projects.sort.name" },
];

const STATE_TAG: Record<ProjectState, { labelKey: ProjectsKey; variant: TagProps["variant"] }> = {
  ready: { labelKey: "projects.state.ready", variant: "neutral" },
  recording: { labelKey: "projects.state.recording", variant: "accent" },
  interrupted: { labelKey: "projects.state.interrupted", variant: "outline" },
  missing: { labelKey: "projects.state.missing", variant: "outline" },
  corrupt: { labelKey: "projects.state.corrupt", variant: "outline" },
};

/** Warm placeholder ramps (brand tokens only), picked per project id. */
const THUMB_RAMPS: ReadonlyArray<string> = [
  "linear-gradient(140deg, var(--color-accent-2-500), var(--color-accent-2-700))",
  "linear-gradient(140deg, var(--color-accent-500), var(--color-accent-800))",
  "linear-gradient(140deg, var(--color-neutral-500), var(--color-neutral-800))",
  "linear-gradient(140deg, var(--color-accent-2-400), var(--color-accent-500))",
  "linear-gradient(140deg, var(--color-accent-2-300), var(--color-accent-2-800))",
];

export function thumbRamp(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return THUMB_RAMPS[Math.abs(hash) % THUMB_RAMPS.length] as string;
}

/** `00:42.18` — list column precision. */
function formatListDuration(ms: number): string {
  return formatTimecode(ms).slice(0, -1);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function formatRelative(iso: string, now: number, t: ProjectsTranslate): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return t("projects.relative.justNow");
  if (diffMin < 60) return t("projects.relative.minutes", { count: diffMin });
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return t("projects.relative.hours", { count: diffHr });
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return t("projects.relative.days", { count: diffDay });
  const diffWk = Math.round(diffDay / 7);
  return t("projects.relative.weeks", { count: diffWk });
}

const onActivate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

const ellipsis: CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const badge: CSSProperties = {
  ...mono,
  position: "absolute",
  padding: "3px 8px",
  borderRadius: "999px",
  background: "color-mix(in srgb, var(--bg-sunken) 72%, transparent)",
  color: "var(--text-1)",
  fontSize: "10px",
};

// ── Overflow menu ──────────────────────────────────────────────────────────

function CardMenu(props: {
  project: ProjectSummary;
  onCardAction: (id: string, action: CardAction) => void;
  onRequestDelete: (project: ProjectSummary) => void;
}): ReactElement {
  const t = useProjectsT();
  const [open, setOpen] = useState(false);
  const { project } = props;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const item = (label: string, run: () => void) => (
    <Button
      variant="ghost"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run();
      }}
      style={{ justifyContent: "flex-start", color: "var(--text-1)" }}
    >
      {label}
    </Button>
  );
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        aria-label={t("projects.card.actions", { name: project.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        onDoubleClick={stop}
        onKeyDown={stop}
        style={{
          width: "28px",
          height: "28px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: "999px",
          background: open ? "var(--bg-hover)" : "transparent",
          color: "var(--text-3)",
          font: "inherit",
          fontSize: "14px",
          cursor: "pointer",
        }}
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={stop}
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 2,
            minWidth: "150px",
            display: "flex",
            flexDirection: "column",
            padding: "4px",
            borderRadius: "12px",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {item(t("projects.card.rename"), () => props.onCardAction(project.id, "rename"))}
          {item(t("projects.card.duplicate"), () => props.onCardAction(project.id, "duplicate"))}
          {item(t("projects.card.delete"), () => props.onRequestDelete(project))}
        </div>
      ) : null}
    </div>
  );
}

// ── Shelf card ─────────────────────────────────────────────────────────────

export interface ProjectCardProps {
  project: ProjectSummary;
  now: number;
  onOpen: (id: string) => void;
  onCardAction: (id: string, action: CardAction) => void;
  onRequestDelete: (project: ProjectSummary) => void;
}

/** Launcher shelf card: 96px gradient thumbnail with duration badge, name, edited time, ⋯. */
export function ProjectCard({
  project,
  now,
  onOpen,
  onCardAction,
  onRequestDelete,
}: ProjectCardProps): ReactElement {
  const t = useProjectsT();
  const stateTag = project.state ? STATE_TAG[project.state] : null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the card nests its own ⋯ menu button, which a <button> cannot contain
    <div
      role="button"
      tabIndex={0}
      aria-label={t("projects.card.open", { name: project.name })}
      onClick={() => onOpen(project.id)}
      onKeyDown={onActivate(() => onOpen(project.id))}
      style={{
        position: "relative",
        borderRadius: "16px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        minWidth: 0,
      }}
    >
      <div
        style={{
          position: "relative",
          height: "96px",
          borderRadius: "15px 15px 0 0",
          overflow: "hidden",
          background: thumbRamp(project.id),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "76%",
              height: "66%",
              borderRadius: "8px",
              background: "var(--color-neutral-100)",
              boxShadow: "var(--shadow-md)",
            }}
          />
        )}
        {stateTag ? (
          <div style={{ position: "absolute", top: "8px", left: "8px" }}>
            <Tag variant={stateTag.variant}>{t(stateTag.labelKey)}</Tag>
          </div>
        ) : null}
        {project.durationMs > 0 ? (
          <span style={{ ...badge, right: "8px", bottom: "8px" }}>
            {formatTimecode(project.durationMs)}
          </span>
        ) : null}
      </div>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ ...ellipsis, fontSize: "13px", fontWeight: 600, color: "var(--text-1)" }}>
            {project.name}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-3)" }}>
            {t("projects.card.edited", { when: formatRelative(project.modifiedAt, now, t) })}
          </div>
        </div>
        <CardMenu project={project} onCardAction={onCardAction} onRequestDelete={onRequestDelete} />
      </div>
    </div>
  );
}

// ── List row ───────────────────────────────────────────────────────────────

const COL = { duration: "78px", modified: "110px", size: "70px", menu: "28px" } as const;

function ProjectRow(props: {
  project: ProjectSummary;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onCardAction: (id: string, action: CardAction) => void;
  onRequestDelete: (project: ProjectSummary) => void;
}): ReactElement {
  const t = useProjectsT();
  const { project, selected } = props;
  const stateTag = project.state ? STATE_TAG[project.state] : null;
  const cell: CSSProperties = { flex: "none", color: "var(--text-2)" };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a rich row (thumbnail, columns, ⋯ menu) cannot be a native <option>
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={project.name}
      onClick={() => props.onSelect(project.id)}
      onDoubleClick={() => props.onOpen(project.id)}
      onFocus={() => props.onSelect(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          props.onOpen(project.id);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: selected ? "10px 20px 10px 17px" : "10px 20px",
        fontSize: "12px",
        cursor: "default",
        outline: "none",
        background: selected ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
        borderLeft: selected ? "3px solid var(--accent)" : undefined,
        borderBottom: selected
          ? undefined
          : "1px solid color-mix(in srgb, var(--text-1) 5%, transparent)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "56px",
          height: "32px",
          flex: "none",
          borderRadius: "6px",
          background: project.thumbnailUrl
            ? `center / cover no-repeat url("${project.thumbnailUrl}")`
            : thumbRamp(project.id),
        }}
      />
      <span
        style={{
          ...ellipsis,
          flex: "1 1 auto",
          minWidth: 0,
          fontWeight: selected ? 600 : 400,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={ellipsis}>{project.name}</span>
        {stateTag && project.state !== "ready" ? (
          <Tag variant={stateTag.variant}>{t(stateTag.labelKey)}</Tag>
        ) : null}
      </span>
      <span style={{ ...cell, ...mono, width: COL.duration }}>
        {formatListDuration(project.durationMs)}
      </span>
      <span style={{ ...cell, width: COL.modified }}>
        {formatRelative(project.modifiedAt, props.now, t)}
      </span>
      <span style={{ ...cell, ...mono, width: COL.size }}>
        {project.sizeBytes !== undefined ? formatBytes(project.sizeBytes) : "—"}
      </span>
      <CardMenu
        project={project}
        onCardAction={props.onCardAction}
        onRequestDelete={props.onRequestDelete}
      />
    </div>
  );
}

// ── Browser ────────────────────────────────────────────────────────────────

export function ProjectBrowser({
  projects,
  onOpen,
  onNew,
  onImport,
  onCardAction,
  title,
  layout: controlledLayout,
  onLayoutChange,
  onCancel,
}: ProjectBrowserProps) {
  const t = useProjectsT();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [ownLayout, setOwnLayout] = useState<ProjectLayout>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const layout = controlledLayout ?? ownLayout;
  const setLayout = (next: ProjectLayout) => {
    setOwnLayout(next);
    onLayoutChange?.(next);
  };

  // Stable "now" for relative dates within a render session.
  const now = useMemo(() => Date.now(), []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? projects.filter((p) => p.name.toLowerCase().includes(needle))
      : projects.slice();
    const sorted = [...filtered];
    if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    }
    return sorted;
  }, [projects, query, sort]);

  const isEmpty = projects.length === 0;
  const selected = visible.find((p) => p.id === selectedId) ?? null;
  const knownSizes = projects.filter((p) => p.sizeBytes !== undefined);
  const totalBytes = knownSizes.reduce((sum, p) => sum + (p.sizeBytes ?? 0), 0);

  const confirmDelete = () => {
    if (pendingDelete) onCardAction(pendingDelete.id, "delete");
    setPendingDelete(null);
  };

  const header = (
    <div
      style={{
        minHeight: "56px",
        flex: "none",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
        padding: "10px 20px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: "var(--font-heading-weight)",
          fontSize: "19px",
          lineHeight: 1.2,
          margin: 0,
          marginRight: "auto",
        }}
      >
        {title ?? t("projects.title")}
      </h1>
      {isEmpty ? null : (
        <>
          <label
            style={{
              width: "220px",
              maxWidth: "100%",
              height: "32px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 12px",
              borderRadius: "999px",
              background: "var(--bg-sunken)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-3)",
              fontSize: "12px",
            }}
          >
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label={t("projects.search.label")}
              placeholder={t("projects.search.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: "none",
                background: "transparent",
                color: "var(--text-1)",
                font: "inherit",
              }}
            />
          </label>
          <PillSegmented
            name="project-layout"
            ariaLabel={t("projects.layout.label")}
            value={layout}
            fill={false}
            padding="5px 12px"
            fontSize="12px"
            options={[
              { value: "grid", label: t("projects.layout.grid") },
              { value: "list", label: t("projects.layout.list") },
            ]}
            onChange={setLayout}
          />
          <div style={{ position: "relative", display: "flex" }}>
            <select
              aria-label={t("projects.sort.label")}
              value={sort}
              onChange={(e) => setSort(e.currentTarget.value as SortKey)}
              style={{
                appearance: "none",
                WebkitAppearance: "none",
                padding: "6px 28px 6px 12px",
                borderRadius: "999px",
                border: 0,
                background: "var(--bg-panel-raised)",
                color: "var(--text-1)",
                font: "inherit",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "12px",
                color: "var(--text-2)",
                pointerEvents: "none",
              }}
            >
              ⌄
            </span>
          </div>
        </>
      )}
    </div>
  );

  let body: ReactElement;
  if (isEmpty) {
    body = (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: "14px",
          padding: "48px",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "96px",
            height: "96px",
            borderRadius: "999px",
            background: "var(--bg-panel)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "999px",
              border: "3px solid var(--text-3)",
              opacity: 0.7,
            }}
          />
        </div>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: "var(--font-heading-weight)",
            fontSize: "20px",
            margin: 0,
            color: "var(--text-1)",
          }}
        >
          {t("projects.empty.title")}
        </h2>
        <p style={{ margin: 0, maxWidth: "300px", fontSize: "13px", color: "var(--text-3)" }}>
          {t("projects.empty.body")}
        </p>
        <Button variant="primary" onClick={onNew} style={{ marginTop: "4px" }}>
          {t("projects.empty.action")}
        </Button>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <p style={{ margin: 0, padding: "48px 20px", textAlign: "center", color: "var(--text-3)" }}>
        {t("projects.noMatch", { query })}
      </p>
    );
  } else if (layout === "list") {
    body = (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          aria-hidden="true"
          style={{
            height: "30px",
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "0 20px",
            fontSize: "11px",
            color: "var(--text-3)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ width: "56px", flex: "none" }} />
          <span style={{ flex: 1 }}>{t("projects.list.name")}</span>
          <span style={{ width: COL.duration }}>{t("projects.list.duration")}</span>
          <span style={{ width: COL.modified }}>{t("projects.list.modified")}</span>
          <span style={{ width: COL.size }}>{t("projects.list.size")}</span>
          <span style={{ width: COL.menu }} />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: rows are rich options, not a native <select> */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: each option row is focusable itself */}
        <div
          role="listbox"
          aria-label={title ?? t("projects.title")}
          style={{ flex: 1, overflowY: "auto" }}
        >
          {visible.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              now={now}
              selected={project.id === selected?.id}
              onSelect={setSelectedId}
              onOpen={onOpen}
              onCardAction={onCardAction}
              onRequestDelete={setPendingDelete}
            />
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div
        style={{
          flex: 1,
          padding: "18px 20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          alignContent: "start",
          gap: "14px",
        }}
      >
        {visible.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            now={now}
            onOpen={onOpen}
            onCardAction={onCardAction}
            onRequestDelete={setPendingDelete}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: "var(--bg-app)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      {header}
      {body}

      <div
        style={{
          minHeight: "60px",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          padding: "10px 20px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <span data-testid="projects-summary" style={{ fontSize: "11px", color: "var(--text-3)" }}>
          {isEmpty ? null : t("projects.footer.count", { count: projects.length })}
          {!isEmpty && knownSizes.length > 0
            ? ` · ${t("projects.footer.onDisk", { size: formatBytes(totalBytes) })}`
            : null}
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
          {onImport ? (
            <Button variant="ghost" onClick={onImport}>
              {t("projects.import")}
            </Button>
          ) : null}
          {isEmpty ? null : (
            <Button variant="secondary" onClick={onNew}>
              {t("projects.newRecording")}
            </Button>
          )}
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel} style={{ color: "var(--text-2)" }}>
              {t("common.cancel")}
            </Button>
          ) : null}
          {layout === "list" && !isEmpty ? (
            <Button
              variant="primary"
              disabled={selected === null}
              onClick={() => {
                if (selected) onOpen(selected.id);
              }}
            >
              {t("projects.open")}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        tone="danger"
        title={t("projects.delete.title")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger-solid" onClick={confirmDelete}>
              {t("projects.delete.confirm")}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <p style={{ margin: 0 }}>{t("projects.delete.body", { name: pendingDelete.name })}</p>
        ) : null}
      </Dialog>
    </div>
  );
}
