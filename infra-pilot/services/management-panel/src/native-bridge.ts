// Tauri API wrappers for the Infra Pilot desktop app
// Provides native capabilities: window management, tray, notifications, file system, auto-updater

let isTauri: boolean | null = null;

async function checkTauri(): Promise<boolean> {
  if (isTauri !== null) return isTauri;
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      isTauri = true;
      return true;
    }
  } catch {}
  isTauri = false;
  return false;
}

// ============================================================================
// Window Management
// ============================================================================

async function getTauriWindow() {
  if (!(await checkTauri())) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function minimizeWindow(): Promise<void> {
  const win = await getTauriWindow();
  if (win) await win.minimize();
}

export async function maximizeWindow(): Promise<void> {
  const win = await getTauriWindow();
  if (win) await win.toggleMaximize();
}

export async function closeWindow(): Promise<void> {
  const win = await getTauriWindow();
  if (win) await win.close();
}

export async function setWindowTitle(title: string): Promise<void> {
  const win = await getTauriWindow();
  if (win) await win.setTitle(title);
}

export async function isWindowFocused(): Promise<boolean> {
  const win = await getTauriWindow();
  if (!win) return true;
  return await win.isFocused();
}

// ============================================================================
// System Tray
// ============================================================================

export async function showTrayNotification(title: string, body: string): Promise<void> {
  if (!(await checkTauri())) return;
  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    let permitted = await isPermissionGranted();
    if (!permitted) {
      const permission = await requestPermission();
      permitted = permission === 'granted';
    }
    if (permitted) {
      sendNotification({ title, body });
    }
  } catch {}
}

// ============================================================================
// Native Notifications (fallback to browser Notification)
// ============================================================================

export async function sendNativeNotification(title: string, options?: NotificationOptions): Promise<void> {
  if (await checkTauri()) {
    await showTrayNotification(title, options?.body || '');
    return;
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, options);
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      new Notification(title, options);
    }
  }
}

// ============================================================================
// File System
// ============================================================================

export async function readTextFile(path: string): Promise<string | null> {
  if (!(await checkTauri())) return null;
  try {
    const { readTextFile: tauriRead } = await import('@tauri-apps/plugin-fs');
    return await tauriRead(path);
  } catch {
    return null;
  }
}

export async function writeTextFile(path: string, contents: string): Promise<boolean> {
  if (!(await checkTauri())) return false;
  try {
    const { writeTextFile: tauriWrite } = await import('@tauri-apps/plugin-fs');
    await tauriWrite(path, contents);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Auto-Updater
// ============================================================================

export interface UpdateInfo {
  version?: string;
  date?: string;
  body?: string;
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!(await checkTauri())) return null;
  try {
    const { checkUpdate, installUpdate } = await import('@tauri-apps/plugin-updater');
    const update = await checkUpdate();
    if (update?.shouldUpdate && update?.manifest) {
      return {
        version: update.manifest.version,
        date: update.manifest.date,
        body: update.manifest.body,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function installUpdate(): Promise<boolean> {
  if (!(await checkTauri())) return false;
  try {
    const { checkUpdate, installUpdate } = await import('@tauri-apps/plugin-updater');
    const update = await checkUpdate();
    if (update?.shouldUpdate) {
      await installUpdate();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// Offline State Sync (localStorage-based)
// ============================================================================

const OFFLINE_KEY = 'infra_pilot_offline_state';

export interface OfflineState {
  pendingActions: Array<{
    id: string;
    type: string;
    payload: any;
    timestamp: string;
  }>;
  lastSyncAt: string | null;
  lastOnlineAt: string | null;
}

export function getOfflineState(): OfflineState {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    return raw ? JSON.parse(raw) : { pendingActions: [], lastSyncAt: null, lastOnlineAt: null };
  } catch {
    return { pendingActions: [], lastSyncAt: null, lastOnlineAt: null };
  }
}

export function saveOfflineState(state: OfflineState): void {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(state));
}

export function addPendingAction(type: string, payload: any): void {
  const state = getOfflineState();
  state.pendingActions.push({
    id: crypto.randomUUID(),
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
  saveOfflineState(state);
}

export function clearPendingActions(): void {
  const state = getOfflineState();
  state.pendingActions = [];
  state.lastSyncAt = new Date().toISOString();
  saveOfflineState(state);
}

export function setOnlineStatus(): void {
  const state = getOfflineState();
  state.lastOnlineAt = new Date().toISOString();
  saveOfflineState(state);
}
