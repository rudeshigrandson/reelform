import type { ProjectV1 } from "../../editor/model/v1";
import {
  type AutosaveController,
  type AutosaveStatus,
  type IntervalTimer,
  type SaveReason,
  bindDirtyTracking,
  createAutosaveController,
  toProjectDocument,
} from "../../editor/persistence";
import type { History } from "../../editor/state";
import type { EditorData, EditorState } from "../../editor/store";
import {
  PROJECT_OPEN_ERRORS,
  type ProjectInvoke,
  type ProjectStores,
  defaultProjectStores,
} from "./openProject";

/**
 * Save semantics (ENGINEERING_SPEC §4): autosave every 30s while dirty and on
 * window blur into rotated backups (`project:save { autosave: true }`); manual
 * save (⌘S, "Save changes?") writes `project.json` and moves the history save
 * point, which is what the top bar's "•" follows.
 */

export interface ProjectSaverDeps {
  invoke: ProjectInvoke;
  history: Pick<History<EditorState>, "revision" | "markSaved">;
  stores?: ProjectStores | undefined;
  /** ISO clock for `modifiedAt`. */
  now?: (() => string) | undefined;
  timer?: IntervalTimer | undefined;
  intervalMs?: number | undefined;
  onStatus?: ((status: AutosaveStatus) => void) | undefined;
}

export interface ProjectSaver {
  readonly autosave: AutosaveController;
  /** Manual save; resolves false (with `autosave.getStatus().lastError`) on failure. */
  save(): Promise<boolean>;
  /** Window blur → autosave when dirty. */
  handleBlur(): Promise<boolean>;
  currentDocument(): ProjectV1;
  dispose(): void;
}

export function editorDataOf(state: EditorState): EditorData {
  const { update: _update, reset: _reset, ...data } = state;
  return data;
}

export function createProjectSaver(deps: ProjectSaverDeps): ProjectSaver {
  const stores = deps.stores ?? defaultProjectStores();

  const currentDocument = (): ProjectV1 => {
    const { meta } = stores.session.getState();
    if (!meta) throw { code: "PROJECT_NOT_OPEN", message: "No project is open" };
    return toProjectDocument(editorDataOf(stores.editor.getState()), meta);
  };

  const write = async (doc: ProjectV1, reason: SaveReason): Promise<void> => {
    const { projectPath } = stores.session.getState();
    if (projectPath === null) throw { code: "PROJECT_NOT_OPEN", message: "No project is open" };
    const manual = reason === "manual";
    // Captured synchronously with the document snapshot: later edits stay dirty.
    const revision = deps.history.revision();
    const res = await deps.invoke(
      "project:save",
      manual
        ? { path: projectPath, document: doc }
        : { path: projectPath, document: doc, autosave: true },
    );
    if (res === null) {
      throw { code: PROJECT_OPEN_ERRORS.unavailable, message: "Saving needs the desktop app" };
    }
    if (!manual) return;
    deps.history.markSaved(revision);
    const { meta } = stores.session.getState();
    if (meta)
      stores.session.getState().setSession({ meta: { ...meta, modifiedAt: res.modifiedAt } });
  };

  const autosave = createAutosaveController({
    port: { save: write },
    getDocument: currentDocument,
    now: deps.now ?? (() => new Date().toISOString()),
    timer: deps.timer,
    intervalMs: deps.intervalMs,
    onStatus: deps.onStatus,
  });
  const unbindDirty = bindDirtyTracking(stores.editor.subscribe, autosave);

  return {
    autosave,
    save: () => autosave.save(),
    handleBlur: () => autosave.handleBlur(),
    currentDocument,
    dispose() {
      unbindDirty();
      autosave.dispose();
    },
  };
}
