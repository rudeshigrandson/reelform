import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isBridged } from "./app/ipc";
import { WindowApp } from "./app/windows/WindowApp";
import "./design/tokens.css";
import "./design/components.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Inside Electron every window routes by `?window=`; a plain browser tab keeps
// the single-window dev shell for UI work without the main process.
createRoot(root).render(<StrictMode>{isBridged() ? <WindowApp /> : <App />}</StrictMode>);
