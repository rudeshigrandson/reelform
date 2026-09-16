import { Button, Dialog, Input } from "@design/components";
import { type ReactElement, useCallback, useRef, useState } from "react";
import { type ProjectInvoke, toIpcErrorShape } from "../app/project/openProject";
import { useProjectsT } from "./i18n";

/**
 * Project library actions shared by the S23 browser (ProjectsContainer) and the
 * S04 launcher shelf: rename / duplicate (name dialog), move to trash, restore,
 * delete forever (confirm dialog), reveal in the file manager, and "Open
 * project…" from disk. Failures surface in `error`; every successful change
 * calls `onChanged` so the caller reloads its list.
 */

/** What an action needs to know about a project (list or trash entry). */
export interface ProjectActionTarget {
  path: string;
  name: string;
}

type NameDialog = { kind: "rename" | "duplicate"; target: ProjectActionTarget; value: string };

export interface ProjectActions {
  busy: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  rename: (target: ProjectActionTarget) => void;
  duplicate: (target: ProjectActionTarget) => void;
  moveToTrash: (target: ProjectActionTarget) => Promise<boolean>;
  restore: (target: ProjectActionTarget) => Promise<boolean>;
  /** Asks for confirmation, then moves the folder to the OS trash. */
  deleteForever: (target: ProjectActionTarget) => void;
  reveal: (target: ProjectActionTarget) => Promise<boolean>;
  /**
   * File dialog → `project:open` → editor window. Resolves true when an editor
   * was opened, false on cancel or failure.
   */
  openFromDisk: () => Promise<boolean>;
  /** Name + delete-forever dialogs; render once next to the list. */
  dialogs: ReactElement;
}

const PROJECT_FILE = "project.json";

/** A picked `.reelform` package, or the `project.json` inside a project folder. */
export function projectDirFromPick(picked: string): string {
  const sep = Math.max(picked.lastIndexOf("/"), picked.lastIndexOf("\\"));
  const base = picked.slice(sep + 1);
  if (base.toLowerCase() === PROJECT_FILE && sep > 0) return picked.slice(0, sep);
  return picked.replace(/[\\/]+$/, "");
}

function documentId(doc: unknown): string | null {
  const id = typeof doc === "object" && doc !== null ? (doc as { id?: unknown }).id : undefined;
  return typeof id === "string" && id !== "" ? id : null;
}

export function useProjectActions({
  invoke,
  onChanged,
}: {
  invoke: ProjectInvoke;
  onChanged: () => void;
}): ProjectActions {
  const t = useProjectsT();
  const unavailable = t("projects.unavailable");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [purge, setPurge] = useState<ProjectActionTarget | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  /** Run an action; failures land in `error`, success reloads the list. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, reload = true): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (res === null) throw { code: "IPC_UNAVAILABLE", message: unavailable };
        if (reload) onChangedRef.current();
        return true;
      } catch (err) {
        setError(toIpcErrorShape(err).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [unavailable],
  );

  const submitName = async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    if (name === "") return;
    const { target, kind } = nameDialog;
    const ok = await act(async () => {
      if (kind === "rename") return invoke("project:rename", { path: target.path, name });
      const opened = await invoke("project:open", { path: target.path });
      if (!opened) return null;
      return invoke("project:saveAs", { path: target.path, document: opened.document, name });
    });
    if (ok) setNameDialog(null);
  };

  const openFromDisk = async (): Promise<boolean> => {
    setError(null);
    let picked: string | null;
    try {
      const res = await invoke("system:pickFile", {
        title: t("projects.openFile.title"),
        filters: [{ name: t("projects.openFile.filter"), extensions: ["reelform", "json"] }],
      });
      if (res === null) throw { code: "IPC_UNAVAILABLE", message: unavailable };
      picked = res.path;
    } catch (err) {
      setError(toIpcErrorShape(err).message);
      return false;
    }
    if (picked === null) return false;
    const path = projectDirFromPick(picked);
    let projectId: string | null = null;
    const ok = await act(async () => {
      const opened = await invoke("project:open", { path });
      if (!opened) return null;
      projectId = documentId(opened.document);
      if (projectId === null) {
        throw { code: "PROJECT_CORRUPT", message: t("projects.error.notProject") };
      }
      return invoke("windows:openEditor", { projectId });
    });
    return ok && projectId !== null;
  };

  const dialogs = (
    <>
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
        tone="danger"
        title={t("projects.purge.title")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPurge(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger-solid"
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
    </>
  );

  return {
    busy,
    error,
    setError,
    rename: (target) => setNameDialog({ kind: "rename", target, value: target.name }),
    duplicate: (target) =>
      setNameDialog({
        kind: "duplicate",
        target,
        value: t("projects.nameDialog.copyName", { name: target.name }),
      }),
    moveToTrash: (target) => act(() => invoke("project:moveToTrash", { path: target.path })),
    restore: (target) => act(() => invoke("project:restoreFromTrash", { path: target.path })),
    deleteForever: (target) => setPurge(target),
    reveal: (target) => act(() => invoke("system:reveal", { path: target.path }), false),
    openFromDisk,
    dialogs,
  };
}
