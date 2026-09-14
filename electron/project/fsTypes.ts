import type * as fsp from "node:fs/promises";

/**
 * The subset of `node:fs/promises` the project/export layer uses. Injected so
 * tests can wrap a tmpdir-backed real fs with fault injection; production
 * passes `node:fs/promises` itself.
 */
export type FsLike = Pick<
  typeof fsp,
  | "access"
  | "copyFile"
  | "cp"
  | "mkdir"
  | "open"
  | "readdir"
  | "readFile"
  | "realpath"
  | "rename"
  | "rm"
  | "stat"
>;
