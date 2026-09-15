/**
 * Renderer port over the `system:*` shell channels (electron/system). Injected
 * into the export flow so it compiles and tests before the orchestrator spreads
 * `systemFileContracts` into the merged contracts.
 */

export interface FileFilterSpec {
  name: string;
  extensions: string[];
}

export type ClipboardFileMethod = "file-url" | "cf-hdrop" | "uri-list";

export interface SystemPort {
  reveal(path: string): Promise<void>;
  pickFile(opts: { filters?: FileFilterSpec[]; title?: string }): Promise<string | null>;
  pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>;
  saveDialog(opts: {
    defaultName: string;
    filters?: FileFilterSpec[];
    defaultDir?: string;
  }): Promise<string | null>;
  /** Put the file itself on the clipboard (paste into Finder/Slack/…). */
  clipboardWriteFile(path: string): Promise<{ method: ClipboardFileMethod }>;
  /** Plain text (diagnostics, paths). */
  copyText(text: string): Promise<void>;
}

/** Structural invoke (the typed `invoke` from app/ipc once system channels are merged). */
export type SystemInvoke = (channel: string, payload: unknown) => Promise<unknown>;

const pathOf = (res: unknown): string | null => {
  if (res && typeof res === "object" && "path" in res) {
    const p = (res as { path: unknown }).path;
    return typeof p === "string" ? p : null;
  }
  return null;
};

export function createIpcSystemPort(
  call: SystemInvoke,
  writeText: (text: string) => Promise<void> = (text) =>
    navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("clipboard unavailable")),
): SystemPort {
  return {
    reveal: async (path) => {
      await call("system:reveal", { path });
    },
    pickFile: async (opts) => pathOf(await call("system:pickFile", opts)),
    pickFolder: async (opts) => pathOf(await call("system:pickFolder", opts ?? {})),
    saveDialog: async (opts) => pathOf(await call("system:saveDialog", opts)),
    clipboardWriteFile: async (path) => {
      const res = await call("system:clipboardWriteFile", { path });
      const method =
        res && typeof res === "object" && "method" in res
          ? ((res as { method: ClipboardFileMethod }).method ?? "file-url")
          : "file-url";
      return { method };
    },
    copyText: writeText,
  };
}
