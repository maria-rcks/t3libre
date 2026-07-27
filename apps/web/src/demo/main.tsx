import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory } from "@tanstack/react-router";

import "@fontsource-variable/dm-sans/index.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@xterm/xterm/css/xterm.css";
import "../index.css";

import { getRouter } from "../router";
import { AppRoot } from "../AppRoot";
import { startDemoServer } from "./server";
import { readBrowserClientSettings, writeBrowserClientSettings } from "../clientPersistenceStorage";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

// The demo showcases the Sidebar v2 beta by default; visitors can still
// toggle it in Settings, and their choice persists.
if (readBrowserClientSettings() === null) {
  writeBrowserClientSettings({ ...DEFAULT_CLIENT_SETTINGS, sidebarV2Enabled: true });
}

startDemoServer();

// Hash history keeps the demo self-contained on a single static page.
const router = getRouter(createHashHistory());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppRoot router={router} />
  </React.StrictMode>,
);
