import { type Draft, current, isDraft } from "immer";

/**
 * Undoable document mutation (ENGINEERING_SPEC §7). `do` and `undo` mutate an
 * immer draft of the whole document state.
 *
 * Coalescing keeps the FIRST command's `undo` and the LATEST command's `do`, so
 * commands sharing a `coalesceKey` must be absolute ("set x to v"), not relative
 * ("add 1 to x") — slider drags and region drags naturally are.
 */
export interface Command<S> {
  id: string;
  /** Human label for tooltips: "Move zoom" → "Undo: Move zoom". */
  label: string;
  do(draft: Draft<S>): void;
  undo(draft: Draft<S>): void;
  coalesceKey?: string | undefined;
}

let patchSeq = 0;

/**
 * Wraps an existing `update(patch)` call site as a command. The inverse is
 * captured from the draft each time `do` runs, so it always restores exactly the
 * values (and key presence) the patch overwrote.
 */
export function patchCommand<S extends object>(
  label: string,
  patch: Partial<S>,
  coalesceKey?: string | undefined,
): Command<S> {
  const keys = Object.keys(patch) as (keyof S & string)[];
  let inverse: { key: string; had: boolean; value: unknown }[] = [];

  return {
    id: `patch-${++patchSeq}`,
    label,
    coalesceKey,
    do(draft) {
      const target = draft as unknown as Record<string, unknown>;
      inverse = keys.map((key) => {
        const had = Object.hasOwn(target, key);
        const value = target[key];
        return { key, had, value: isDraft(value) ? current(value) : value };
      });
      for (const key of keys) target[key] = (patch as Record<string, unknown>)[key];
    },
    undo(draft) {
      const target = draft as unknown as Record<string, unknown>;
      for (const { key, had, value } of inverse) {
        if (had) target[key] = value;
        else delete target[key];
      }
    },
  };
}
