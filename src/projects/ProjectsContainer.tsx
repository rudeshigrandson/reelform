import type { ResponseOf } from "@contracts";
import { Button, Dialog, Input, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
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

/**
 * Launcher right pane (guide S04) and project browser body (S23), bound to the
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

type NameDialog = { kind: "rename" | "duplicate"; entry: ListEntry; value: string };

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  minHeight: "100%",
  background: "var(--bg-app)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
};

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  margin: "0 var(--space-6)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--danger)",
  color: "var(--text-1)",
  background: "var(--bg-panel)",
  fontSize: "13px",
};

const centerStyle: CSSProperties = {
  display: "block",
  padding: "var(--space-8) var(--space-4)",
  textAlign: "center",
  color: "var(--text-2)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  borderBottom: "1px solid var(--border)",
};

function toSummary(entry: ListEntry): ProjectSummary {
  const summary: ProjectSummary = {
    id: entry.path,
    name: entry.name,
    modifiedAt: entry.modifiedAt ?? "",
    durationMs: entry.durationMs ?? 0,
  };
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
  const viewOptions = useMemo<ReadonlyArray<SegmentedOption<ProjectsView>>>(
    () => VIEW_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const [ownView, setOwnView] = useState<ProjectsView>("recent");
  const view = controlledView ?? ownView;
  const setView = (next: ProjectsView) => {
    setOwnView(next);
    onViewChange?.(next);
  };

  const [projects, setProjects] = useState<Load<ListEntry>>({ kind: "loading" });
  const [trash, setTrash] = useState<Load<TrashEntry>>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [purge, setPurge] = useState<TrashEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

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

  /** Run an action; failures land in the banner, success reloads the list. */
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res === null) throw { code: "IPC_UNAVAILABLE", message: unavailable };
      reload();
      return true;
    } catch (err) {
      setActionError(toIpcErrorShape(err).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

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
    if (action === "delete") {
      void act(() => invoke("project:moveToTrash", { path }));
      return;
    }
    setNameDialog({
      kind: action,
      entry,
      value:
        action === "rename" ? entry.name : t("projects.nameDialog.copyName", { name: entry.name }),
    });
  };

  const submitName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (name === "") return;
    const { entry, kind } = nameDialog;
    const ok = await act(async () => {
      if (kind === "rename") return invoke("project:rename", { path: entry.path, name });
      const opened = await invoke("project:open", { path: entry.path });
      if (!opened) return null;
      return invoke("project:saveAs", { path: entry.path, document: opened.document, name });
    });
    if (ok) setNameDialog(null);
  };

  const header =
    controlledView === undefined ? (
      <div style={{ padding: "var(--space-4) var(--space-6) 0" }}>
        <Segmented name="projects-view" value={view} options={viewOptions} onChange={setView} />
      </div>
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
      <p style={{ margin: "0 0 var(--space-3)" }}>{t("projects.loadError", { message })}</p>
      <Button variant="secondary" onClick={reload}>
        {t("projects.retry")}
      </Button>
    </div>
  );

  let body: ReactElement;
  if (view === "trash") {
    if (trash.kind === "loading") {
      body = <output style={centerStyle}>{t("projects.trash.loading")}</output>;
    } else if (trash.kind === "error") {
      body = loadError(trash.message);
    } else if (trash.items.length === 0) {
      body = (
        <div style={centerStyle}>
          <h2
            style={{ fontFamily: "var(--font-heading)", fontWeight: 400, color: "var(--text-1)" }}
          >
            {t("projects.trash.emptyTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("projects.trash.emptyBody")}</p>
        </div>
      );
    } else {
      body = (
        <ul
          aria-label={t("projects.trash.listLabel")}
          style={{ listStyle: "none", margin: 0, padding: "0 var(--space-6)" }}
        >
          {trash.items.map((item) => (
            <li key={item.path} style={rowStyle}>
              <span style={{ flex: "1 1 auto" }}>{item.name}</span>
              <span style={{ color: "var(--text-3)", fontSize: "12px" }}>
                {formatDate(item.trashedAt)}
              </span>
              <Button
                variant="secondary"
                disabled={busy}
                aria-label={t("projects.trash.restoreLabel", { name: item.name })}
                onClick={() =>
                  void act(() => invoke("project:restoreFromTrash", { path: item.path }))
                }
              >
                {t("projects.trash.restore")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={t("projects.trash.deleteForeverLabel", { name: item.name })}
                onClick={() => setPurge(item)}
              >
                {t("projects.trash.deleteForever")}
              </Button>
            </li>
          ))}
        </ul>
      );
    }
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
      {header}
      {banner}
      {body}

      <Dialog
        open={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        title={t(
          nameDialog?.kind === "duplicate"
            ? "projects.nameDialog.duplicateTitle"
            : "projects.nameDialog.renameTitle",
        )}
        actions={
          <>
            <Button variant="ghost" onClick={() => setNameDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || (nameDialog?.value.trim() ?? "") === ""}
              onClick={() => void submitName()}
            >
              {t(
                nameDialog?.kind === "duplicate"
                  ? "projects.nameDialog.duplicate"
                  : "projects.nameDialog.rename",
              )}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitName();
          }}
        >
          <Input
            aria-label={t("projects.nameDialog.inputLabel")}
            autoFocus
            value={nameDialog?.value ?? ""}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setNameDialog((d) => (d ? { ...d, value } : d));
            }}
          />
        </form>
      </Dialog>

      <Dialog
        open={purge !== null}
        onClose={() => setPurge(null)}
        title={t("projects.purge.title")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPurge(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                const target = purge;
                setPurge(null);
                if (target) void act(() => invoke("project:trash", { path: target.path }));
              }}
            >
              {t("projects.trash.deleteForever")}
            </Button>
          </>
        }
      >
        {purge && <p style={{ margin: 0 }}>{t("projects.purge.body", { name: purge.name })}</p>}
      </Dialog>
    </div>
  );
}
