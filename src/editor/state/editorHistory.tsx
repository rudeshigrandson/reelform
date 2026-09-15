import { type ReactElement, type ReactNode, createContext, useCallback, useContext } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { type EditorData, type EditorState, useEditorStore } from "../store";
import { patchCommand } from "./command";
import { type History, createHistory } from "./history";

/**
 * The editor window's document history (ENGINEERING_SPEC §6.2 / §7) bound to the
 * editor store, plus the React plumbing every editing surface uses to route
 * mutations through it.
 */

type EditorStore = UseBoundStore<StoreApi<EditorState>>;

export interface EditorHistoryOptions {
  /** Settings `undoHistorySize`; defaults to the history default (100). */
  cap?: number | undefined;
  now?: (() => number) | undefined;
  store?: EditorStore | undefined;
}

export function createEditorHistory(options: EditorHistoryOptions = {}): History<EditorState> {
  const store = options.store ?? useEditorStore;
  return createHistory<EditorState>({
    getState: store.getState,
    setState: (next) => store.setState(next, true),
    now: options.now ?? (() => performance.now()),
    cap: options.cap,
  });
}

/** `(label, patch, coalesceKey?)`: one undoable document edit ("Move zoom"). */
export type DocumentUpdate = (
  label: string,
  patch: Partial<EditorData>,
  coalesceKey?: string | undefined,
) => void;

/**
 * Non-React form of {@link useDocumentUpdate}. Patches that change nothing are
 * dropped (no empty undo entries). Without a history (e.g. a standalone
 * inspector story) the patch is applied directly.
 */
export function createDocumentUpdate(
  history: Pick<History<EditorState>, "push"> | null,
  store: EditorStore = useEditorStore,
): DocumentUpdate {
  return (label, patch, coalesceKey) => {
    const state = store.getState();
    const keys = Object.keys(patch) as (keyof EditorData)[];
    if (keys.every((k) => Object.is(state[k], patch[k]))) return;
    if (!history) {
      state.update(patch);
      return;
    }
    history.push(patchCommand<EditorState>(label, patch, coalesceKey));
  };
}

const EditorHistoryContext = createContext<History<EditorState> | null>(null);

export function EditorHistoryProvider({
  history,
  children,
}: {
  history: History<EditorState> | null;
  children?: ReactNode;
}): ReactElement {
  return <EditorHistoryContext.Provider value={history}>{children}</EditorHistoryContext.Provider>;
}

export function useEditorHistory(): History<EditorState> | null {
  return useContext(EditorHistoryContext);
}

/**
 * The helper inspector tabs adopt: `update("Change padding", { frame }, "frame.padding")`.
 * Sliders pass a stable coalesce key so a drag is one undo entry.
 */
export function useDocumentUpdate(): DocumentUpdate {
  const history = useEditorHistory();
  return useCallback<DocumentUpdate>(
    (label, patch, coalesceKey) => createDocumentUpdate(history)(label, patch, coalesceKey),
    [history],
  );
}
