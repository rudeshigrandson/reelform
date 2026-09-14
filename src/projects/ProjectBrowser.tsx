import {
  Button,
  Card,
  CardMeta,
  CardTitle,
  Dialog,
  Input,
  Segmented,
  Tag,
} from "@design/components";
import type { SegmentedOption, TagProps } from "@design/components";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CardAction,
  ProjectBrowserProps,
  ProjectState,
  ProjectSummary,
  SortKey,
} from "./types";

const SORT_OPTIONS: ReadonlyArray<SegmentedOption<SortKey>> = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
];

const STATE_TAG: Record<ProjectState, { label: string; variant: TagProps["variant"] }> = {
  ready: { label: "Ready", variant: "neutral" },
  recording: { label: "Recording", variant: "accent" },
  interrupted: { label: "Interrupted", variant: "outline" },
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatRelative(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.round(diffDay / 7);
  return `${diffWk}w ago`;
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "var(--space-4)",
};

const thumbStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "16 / 9",
  borderRadius: "var(--radius-md)",
  background: "linear-gradient(135deg, var(--bg-panel-raised), var(--bg-sunken))",
  marginBottom: "var(--space-3)",
  overflow: "hidden",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  flexWrap: "wrap",
  marginBottom: "var(--space-6)",
};

interface ProjectCardProps {
  project: ProjectSummary;
  now: number;
  onOpen: (id: string) => void;
  onCardAction: (id: string, action: CardAction) => void;
  onRequestDelete: (project: ProjectSummary) => void;
}

function ProjectCard({ project, now, onOpen, onCardAction, onRequestDelete }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const stateTag = project.state ? STATE_TAG[project.state] : null;

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <Card
      elevation="sm"
      role="button"
      tabIndex={0}
      aria-label={`Open ${project.name}`}
      onClick={() => onOpen(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(project.id);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      <div style={thumbStyle}>
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
        {stateTag ? (
          <div style={{ position: "absolute", top: "var(--space-2)", left: "var(--space-2)" }}>
            <Tag variant={stateTag.variant}>{stateTag.label}</Tag>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <CardTitle>{project.name}</CardTitle>
        <div style={{ position: "relative" }}>
          <Button
            icon
            variant="ghost"
            aria-label={`Actions for ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              stop(e);
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              onClick={stop}
              onKeyDown={stop}
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + var(--space-1))",
                zIndex: 1,
                background: "var(--bg-panel-raised)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                boxShadow: "var(--shadow-md)",
                padding: "var(--space-1)",
                display: "flex",
                flexDirection: "column",
                minWidth: "140px",
              }}
            >
              <Button
                variant="ghost"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onCardAction(project.id, "rename");
                }}
              >
                Rename
              </Button>
              <Button
                variant="ghost"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onCardAction(project.id, "duplicate");
                }}
              >
                Duplicate
              </Button>
              <Button
                variant="ghost"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onRequestDelete(project);
                }}
              >
                Delete
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <CardMeta>
        {formatRelative(project.modifiedAt, now)} · {formatDuration(project.durationMs)}
      </CardMeta>
    </Card>
  );
}

export function ProjectBrowser({
  projects,
  onOpen,
  onNew,
  onImport,
  onCardAction,
}: ProjectBrowserProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

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

  const confirmDelete = () => {
    if (pendingDelete) onCardAction(pendingDelete.id, "delete");
    setPendingDelete(null);
  };

  return (
    <div
      style={{
        padding: "var(--space-6)",
        background: "var(--bg-app)",
        minHeight: "100%",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={topBarStyle}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 400,
            margin: 0,
            marginRight: "auto",
            fontSize: "1.75rem",
          }}
        >
          Projects
        </h1>
        <Input
          type="search"
          aria-label="Search projects"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Segmented name="project-sort" value={sort} options={SORT_OPTIONS} onChange={setSort} />
        <Button variant="primary" onClick={onNew}>
          New recording
        </Button>
        {onImport ? (
          <Button variant="secondary" onClick={onImport}>
            Import…
          </Button>
        ) : null}
      </div>

      {isEmpty ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "var(--space-4)",
            padding: "var(--space-8) var(--space-4)",
            color: "var(--text-2)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "var(--radius-lg)",
              background:
                "linear-gradient(135deg, var(--accent-soft), color-mix(in srgb, var(--accent) 28%, transparent))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "3rem",
            }}
          >
            🎬
          </div>
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 400,
              margin: 0,
              color: "var(--text-1)",
            }}
          >
            Nothing recorded yet
          </h2>
          <p style={{ margin: 0, maxWidth: "36ch" }}>
            Capture your screen to create your first project.
          </p>
          <Button variant="primary" onClick={onNew}>
            Record something
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p style={{ color: "var(--text-2)" }}>No projects match “{query}”.</p>
      ) : (
        <div style={gridStyle}>
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
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete project?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <p style={{ margin: 0 }}>
            “{pendingDelete.name}” will be permanently removed. This can’t be undone.
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
