import { contextBridge, ipcRenderer } from "electron";
import type { ReelformApi } from "./ipc/contracts";

/**
 * Exposes a single typed object on `window.reelform`. No raw `ipcRenderer` is
 * ever handed to the renderer — only `invoke` and `on`.
 */
const api: ReelformApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, cb) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("reelform", api);
