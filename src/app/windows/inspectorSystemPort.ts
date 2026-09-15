import type { ChannelName, RequestOf, ResponseOf } from "@contracts";
import type { FileFilter as HostFileFilter } from "../../editor/inspector/host/types";
import type { SystemPort } from "../inspector/createInspectorHost";

/**
 * The inspector host's file-system port over the `system:*` IPC channels
 * (dialogs, caption sidecar text, importing media into the project folder,
 * source sizes). Outside Electron `invoke` resolves null; the port then reports
 * cancelled dialogs / unknown sizes, and throws only where a result is required.
 */

export type SystemInvoke = <K extends ChannelName>(
  channel: K,
  payload: RequestOf<K>,
) => Promise<ResponseOf<K> | null>;

export class NotBridgedError extends Error {
  readonly code = "NOT_BRIDGED";
  constructor(action: string) {
    super(`${action} needs the desktop app`);
    this.name = "NotBridgedError";
  }
}

function toFilters(filters: readonly HostFileFilter[]) {
  return filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }));
}

export function createInspectorSystemPort(
  invoke: SystemInvoke,
  closeWindow: () => void = () => window.close(),
): SystemPort {
  return {
    async pickFile(opts) {
      const res = await invoke("system:pickFile", {
        title: opts.title,
        filters: toFilters(opts.filters),
      });
      return res?.path ?? null;
    },

    async saveFile(opts) {
      const res = await invoke("system:saveDialog", {
        defaultName: opts.defaultName,
        filters: toFilters(opts.filters),
      });
      const path = res?.path ?? null;
      if (!path) return null;
      await invoke("system:writeTextFile", { path, contents: opts.contents });
      return path;
    },

    async readTextFile(path) {
      const res = await invoke("system:readTextFile", { path });
      if (!res) throw new NotBridgedError("Reading files");
      return res.text;
    },

    async reveal(path) {
      await invoke("system:reveal", { path });
    },

    async copyIntoProject(projectPath, kind, sourcePath) {
      const res = await invoke("system:copyIntoProject", { projectPath, kind, sourcePath });
      if (!res) throw new NotBridgedError("Importing media");
      return res.relPath;
    },

    async statFiles(projectPath, relPaths) {
      const res = await invoke("system:statFiles", { projectPath, relPaths: [...relPaths] });
      return res?.stats ?? {};
    },

    closeWindow,
  };
}
