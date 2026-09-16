import type { ResponseOf } from "@contracts";
import { Button } from "@design/components";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type ProjectInvoke, toIpcErrorShape } from "../app/project/openProject";
import { ProjectBrowser } from "./ProjectBrowser";
import { type ProjectsKey, useProjectsT } from "./i18n";
import type { CardAction, ProjectSummary } from "./types";
import { useProjectActions } from "./useProjectActions";

/**
 * Launcher right pane (guide S04) and project browser (S23), bound to the
 * `project:*` channels: Recent / All / Trash, open in an editor window, rename,
 * duplicate (save as), move to trash, restore and delete forever.
 */

export type ProjectsView = "recent" | "all" | "trash";

type ListEntry = ResponseOf<"project:list">["projects"][number];
type TrashEntry = ResponseOf<"project:listTrash">["projects"][number];

export interface ProjectsContainerProps {
  invoke: ProjectInvoke;
  onNewRecording: () => void;
  onImport?: (() => void) | undefined;
  /** Controlled view (e.g. the launcher's left column); internal tabs when omitted. */
  view?: ProjectsView | undefined;
  onViewChange?: ((view: ProjectsView) => void) | undefined;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: ProjectsView; labelKey: ProjectsKey }> = [
  { value: "recent", labelKey: "projects.view.recent" },
  { value: "all", labelKey: "projects.view.all" },
  { value: "trash", labelKey: "projects.view.trash" },
];

type Load<T> =
  | { kind: "loading" }
  | { kind: "ready"; items: T[] }
  | { kind: "error"; message: string };

const paneStyle: CSSProperties = {
  display: "flex",
  minHeight: "100%",
  background: "var(--bg-app)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
};

const mainStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  margin: "12px 20px 0",
  padding: "8px 8px 8px 14px",
  borderRadius: "12px",
  border: "1px solid color-mix(in srgb, var(--record) 50%, transparent)",
  color: "color-mix(in srgb, var(--record) 35%, var(--text-1))",
  background: "var(--bg-panel)",
  fontSize: "12px",
};

const centerStyle: CSSProperties = {
  display: "block",
  padding: "48px 20px",
  textAlign: "center",
  fontSize: "13px",
  color: "var(--text-3)",
};

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)",
  fontSize: "19px",
  lineHeight: 1.2,
  margin: 0,
  color: "var(--text-1)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "10px 20px",
  fontSize: "12px",
  borderBottom: "1px solid color-mix(in srgb, var(--text-1) 5%, transparent)",
};

const trashThumb: CSSProperties = {
  width: "56px",
  height: "32px",
  flex: "none",
  borderRadius: "6px",
  background:
    "repeating-linear-gradient(45deg, var(--bg-panel-raised) 0 6px, var(--bg-panel) 6px 12px)",
};

export function toSummary(entry: ListEntry): ProjectSummary {
  const summary: ProjectSummary = {
    id: entry.path,
    name: entry.name,
    modifiedAt: entry.modifiedAt ?? "",
    durationMs: entry.durationMs ?? 0,
  };
  if (entry.thumbnailUrl) summary.thumbnailUrl = entry.thumbnailUrl;
  if (typeof entry.sizeBytes === "number") summary.sizeBytes = entry.sizeBytes;
  if (entry.missing) summary.state = "missing";
  else if (entry.corrupt) summary.state = "corrupt";
  return summary;
}

function formatDate(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function ProjectsContainer({
  invoke,
  onNewRecording,
  onImport,
  view: controlledView,
  onViewChange,
}: ProjectsContainerProps): ReactElement {
  const t = useProjectsT();
  const unavailable = t("projects.unavailable");
  const [ownView, setOwnView] = useState<ProjectsView>("recent");
  const view = controlledView ?? ownView;
  const setView = (next: ProjectsView) => {
    setOwnView(next);
    onViewChange?.(next);
  };

  const [projects, setProjects] = useState<Load<ListEntry>>({ kind: "loading" });
  const [trash, setTrash] = useState<Load<TrashEntry>>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const actions = useProjectActions({ invoke, onChanged: reload });
  const { busy, error: actionError, setError: setActionError } = actions;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is the Retry / post-action refresh trigger.
  useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        if (view === "trash") {
          setTrash((t) => (t.kind === "ready" ? t : { kind: "loading" }));
          const res = await invoke("project:listTrash", {});
          if (!live) return;
          setTrash(
            res ? { kind: "ready", items: res.projects } : { kind: "error", message: unavailable },
          );
        } else {
          setProjects((p) => (p.kind === "ready" ? p : { kind: "loading" }));
          const res = await invoke("project:list", {});
          if (!live) return;
          setProjects(
            res ? { kind: "ready", items: res.projects } : { kind: "error", message: unavailable },
          );
        }
      } catch (err) {
        if (!live) return;
        const message = toIpcErrorShape(err).message;
        if (view === "trash") setTrash({ kind: "error", message });
        else setProjects({ kind: "error", message });
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [invoke, view, reloadKey, unavailable]);

  const entries = projects.kind === "ready" ? projects.items : [];
  const visible = useMemo(
    () => (view === "recent" ? entries.filter((e) => e.recent) : entries),
    [entries, view],
  );
  const byPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries]);

  const onOpen = (path: string) => {
    const entry = byPath.get(path);
    if (!entry) return;
    if (entry.missing || entry.corrupt || entry.id === null) {
      setActionError(
        t(entry.missing ? "projects.error.missing" : "projects.error.corrupt", {
          name: entry.name,
        }),
      );
      return;
    }
    const projectId = entry.id;
    setActionError(null);
    void invoke("windows:openEditor", { projectId }).catch((err: unknown) =>
      setActionError(toIpcErrorShape(err).message),
    );
  };

  const onCardAction = (path: string, action: CardAction) => {
    const entry = byPath.get(path);
    if (!entry) return;
    if (action === "delete") void actions.moveToTrash(entry);
    else if (action === "rename") actions.rename(entry);
    else actions.duplicate(entry);
  };

  const trashCount = trash.kind === "ready" ? trash.items.length : null;
  const sidebar =
    controlledView === undefined ? (
      <nav
        aria-label={t("projects.nav.label")}
        style={{
          width: "190px",
          flex: "none",
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          padding: "14px 12px",
          borderRight: "1px solid var(--border)",
          fontSize: "13px",
        }}
      >
        {VIEW_OPTIONS.map((o) => {
          const active = o.value === view;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => setView(o.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 12px",
                border: 0,
                borderRadius: "999px",
                textAlign: "left",
                font: "inherit",
                cursor: "pointer",
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent-hover)" : "var(--text-2)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {t(o.labelKey)}
              {o.value === "trash" && trashCount ? (
                <span aria-hidden="true" style={{ fontSize: "11px", color: "var(--text-3)" }}>
                  {trashCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
    ) : null;

  const banner = actionError ? (
    <div role="alert" style={bannerStyle}>
      <span style={{ flex: "1 1 auto" }}>{actionError}</span>
      <Button variant="ghost" onClick={() => setActionError(null)}>
        {t("projects.dismiss")}
      </Button>
    </div>
  ) : null;

  const loadError = (message: string) => (
    <div role="alert" style={centerStyle}>
      <p style={{ margin: "0 0 12px" }}>{t("projects.loadError", { message })}</p>
      <Button variant="secondary" onClick={reload}>
        {t("projects.retry")}
      </Button>
    </div>
  );

  let body: ReactElement;
  if (view === "trash") {
    let trashBody: ReactElement;
    if (trash.kind === "loading") {
      trashBody = <output style={centerStyle}>{t("projects.trash.loading")}</output>;
    } else if (trash.kind === "error") {
      trashBody = loadError(trash.message);
    } else if (trash.items.length === 0) {
      trashBody = (
        <div style={centerStyle}>
          <h2 style={{ ...headingStyle, fontSize: "20px", marginBottom: "8px" }}>
            {t("projects.trash.emptyTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("projects.trash.emptyBody")}</p>
        </div>
      );
    } else {
      trashBody = (
        <ul
          aria-label={t("projects.trash.listLabel")}
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {trash.items.map((item) => {
            const date = formatDate(item.trashedAt);
            return (
              <li key={item.path} style={rowStyle}>
                <div
                  aria-hidden="true"
                  style={
                    item.thumbnailUrl
                      ? {
                          ...trashThumb,
                          background: `center / cover no-repeat url("${item.thumbnailUrl}")`,
                        }
                      : trashThumb
                  }
                />
                <span
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    color: "color-mix(in srgb, var(--text-1) 70%, transparent)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.name}
                </span>
                {date ? (
                  <span style={{ color: "var(--text-3)", fontSize: "11px", flex: "none" }}>
                    {t("projects.trash.trashed", { date })}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={t("projects.trash.restoreLabel", { name: item.name })}
                  onClick={() => void actions.restore(item)}
                  style={{ fontSize: "11px", fontWeight: 600 }}
                >
                  {t("projects.trash.restore")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={t("projects.trash.deleteForeverLabel", { name: item.name })}
                  onClick={() => actions.deleteForever(item)}
                  style={{ fontSize: "11px", color: "var(--text-3)" }}
                >
                  {t("projects.trash.deleteForever")}
                </Button>
              </li>
            );
          })}
        </ul>
      );
    }
    body = (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <div
          style={{
            height: "56px",
            flex: "none",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h1 style={headingStyle}>{t("projects.view.trash")}</h1>
        </div>
        {trashBody}
      </div>
    );
  } else if (projects.kind === "loading") {
    body = <output style={centerStyle}>{t("projects.loading")}</output>;
  } else if (projects.kind === "error") {
    body = loadError(projects.message);
  } else {
    body = (
      <ProjectBrowser
        projects={visible.map(toSummary)}
        onOpen={onOpen}
        onNew={onNewRecording}
        onImport={onImport}
        onCardAction={onCardAction}
      />
    );
  }

  return (
    <div style={paneStyle}>
      {sidebar}
      <div style={mainStyle}>
        {banner}
        <div style={{ flex: "1 1 auto", minHeight: 0 }}>{body}</div>
      </div>
      {actions.dialogs}
    </div>
  );
}
