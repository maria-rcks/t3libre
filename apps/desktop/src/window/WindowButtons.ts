import type * as Electron from "electron";

/**
 * macOS window button visibility is shell state that outlives the renderer that
 * asked for it: a reload, a crash recovery, or a navigation to a surface that
 * never mounts the sidebar would otherwise strand a window with no traffic
 * lights. The shell tracks which windows a renderer hid so it can restore only
 * those, and so a window nobody hid is never redrawn out from under its
 * configured `trafficLightPosition`.
 */
const hiddenWindows = new WeakSet<Electron.BrowserWindow>();

export function setWindowButtonsVisible(window: Electron.BrowserWindow, visible: boolean): void {
  if (visible !== hiddenWindows.has(window)) return;
  if (visible) {
    hiddenWindows.delete(window);
  } else {
    hiddenWindows.add(window);
  }
  window.setWindowButtonVisibility(visible);
}
