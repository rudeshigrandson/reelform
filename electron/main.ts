import { fileURLToPath } from "node:url";
import { BrowserWindow, app, shell } from "electron";
import { handle } from "./ipc/registerIpc";

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function registerIpc(): void {
  handle("system:ping", () => ({ pong: true as const, version: app.getVersion() }));
  handle("system:openExternal", async ({ url }) => {
    await shell.openExternal(url);
    return { ok: true };
  });
}

function createLauncher(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#0a0a0b",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (DEV_URL) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(fileURLToPath(new URL("../dist/index.html", import.meta.url)));
  }
  return win;
}

// Single-instance lock: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createLauncher();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createLauncher();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
