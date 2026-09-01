import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/components/preview/previewBridge", () => ({ previewBridge: null }));
vi.mock("~/components/preview/usePreviewBridge", () => ({ usePreviewBridge: vi.fn() }));
vi.mock("~/lib/utils", () => ({ cn: vi.fn() }));
vi.mock("./browserRecording", () => ({
  useActiveBrowserRecordingTabIds: () => new Set(),
}));
vi.mock("./browserSurfaceStore", () => ({
  resolveBrowserSurfacePanelRect: vi.fn(),
  useBrowserSurfaceStore: vi.fn(),
}));
vi.mock("./browserViewportLayout", () => ({
  browserViewportSettingKey: vi.fn(),
  resolveBrowserViewportLayout: vi.fn(),
  resolveFittedBrowserViewport: vi.fn(),
}));
vi.mock("./BrowserDeviceToolbar", () => ({ BrowserDeviceToolbar: () => null }));
vi.mock("./BrowserViewportResizeHandles", () => ({
  BrowserViewportResizeHandles: () => null,
}));
vi.mock("./desktopTabLifetime", () => ({ acquireDesktopTab: vi.fn() }));
vi.mock("./hostedBrowserWebviewStyle", () => ({
  resolveHostedBrowserWebviewWrapperStyle: vi.fn(),
}));
vi.mock("./previewWebviewConfigState", () => ({ usePreviewWebviewConfig: () => null }));
vi.mock("./useBrowserViewportResize", () => ({ useBrowserViewportResize: vi.fn() }));
vi.mock("./webviewCrashRecovery", () => ({
  INITIAL_WEBVIEW_CRASH_RECOVERY_STATE: {},
  planWebviewCrashRecovery: vi.fn(),
}));

import { hostedBrowserCompositingLayoutKey } from "./HostedBrowserWebview";

describe("hostedBrowserCompositingLayoutKey", () => {
  const layout = {
    viewportWidth: 1280,
    viewportHeight: 800,
    viewportScale: 1,
  };

  it.each([
    ["width", { viewportWidth: 1024 }],
    ["height", { viewportHeight: 768 }],
    ["scale", { viewportScale: 0.75 }],
  ])("changes when inner layout %s changes", (_field, change) => {
    expect(hostedBrowserCompositingLayoutKey({ ...layout, ...change })).not.toBe(
      hostedBrowserCompositingLayoutKey(layout),
    );
  });
});
