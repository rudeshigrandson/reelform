import type { MetaUpdateEffects } from "../../editor/inspector/host/types";
import type { ProjectMeta } from "../../editor/persistence";
import { type Command, type History, patchCommand } from "../../editor/state";
import type { EditorData, EditorState } from "../../editor/store";
import { useProjectSession } from "../project/session";

/**
 * History adapter for inspector edits that touch project meta (sources, clips,
 * name) and, optionally, editor document state in the same undo entry. Meta
 * lives in the project session, not the editor store, so the command applies it
 * as a side effect of `do`/`undo` while the editor patch goes through the draft.
 */

export type MetaUpdate = (
  label: string,
  update: (meta: ProjectMeta) => ProjectMeta,
  patch?: Partial<EditorData> | undefined,
  effects?: MetaUpdateEffects | undefined,
) => void;

interface SessionLike {
  getState(): { meta: ProjectMeta | null; setSession(patch: { meta: ProjectMeta | null }): void };
}

let metaSeq = 0;

export function createMetaUpdate(
  history: Pick<History<EditorState>, "push">,
  session: SessionLike = useProjectSession,
): MetaUpdate {
  return (label, update, patch, effects) => {
    const before = session.getState().meta;
    if (!before) return;
    const after = update(structuredClone(before));
    const editor = patch ? patchCommand<EditorState>(label, patch) : null;
    metaSeq += 1;
    // Side effects (e.g. restoring a trimmed file) run on undo and redo, not on the first apply.
    let applied = false;
    const command: Command<EditorState> = {
      id: `meta-${metaSeq}`,
      label,
      do(draft) {
        session.getState().setSession({ meta: after });
        editor?.do(draft);
        if (applied) effects?.onRedo?.();
        applied = true;
      },
      undo(draft) {
        editor?.undo(draft);
        session.getState().setSession({ meta: before });
        effects?.onUndo?.();
      },
    };
    history.push(command);
  };
}
