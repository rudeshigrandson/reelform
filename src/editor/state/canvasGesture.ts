import type { StoreApi, UseBoundStore } from "zustand";
import { type EditorData, type EditorState, useEditorStore } from "../store";
import type { DocumentUpdate } from "./editorHistory";

/**
 * Canvas edits (zoom focus, annotation transform, crop, webcam position) as
 * undoable commands (ENGINEERING_SPEC §6.2 / §7). Live pointer moves write the
 * store directly so the preview follows the pointer; the release restores the
 * pre-gesture values and records ONE history entry for the whole gesture, so a
 * pause mid-drag never splits it and cancelled moves never reach history.
 */

export interface CanvasEdit {
  /** Undo tooltip: "Move zoom focus". */
  label: string;
  /** Identifies the gesture ("canvas:zoomFocus:z1"). */
  coalesceKey: string;
  /** Pointer released: record the edit. */
  commit: boolean;
}

export type CanvasUpdate = (patch: Partial<EditorData>, edit: CanvasEdit) => void;

type EditorStore = UseBoundStore<StoreApi<EditorState>>;

export function createCanvasUpdate(
  documentUpdate: DocumentUpdate,
  store: EditorStore = useEditorStore,
): CanvasUpdate {
  /** Store values each in-progress gesture overwrote, by gesture key. */
  const before = new Map<string, Partial<EditorData>>();
  return (patch, edit) => {
    const state = store.getState();
    if (!edit.commit) {
      const saved = before.get(edit.coalesceKey) ?? {};
      for (const key of Object.keys(patch) as (keyof EditorData)[]) {
        if (!Object.hasOwn(saved, key)) (saved as Record<string, unknown>)[key] = state[key];
      }
      before.set(edit.coalesceKey, saved);
      state.update(patch);
      return;
    }
    const saved = before.get(edit.coalesceKey);
    before.delete(edit.coalesceKey);
    // Back to the pre-gesture document so the command's inverse restores it.
    if (saved) state.update(saved);
    documentUpdate(edit.label, patch, edit.coalesceKey);
  };
}
