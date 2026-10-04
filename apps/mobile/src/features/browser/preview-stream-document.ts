import type { DeviceHubAccess } from "@t3tools/client-runtime/device/hub-access";
import type { PreviewStreamControl } from "@t3tools/client-runtime/preview/server-browser-stream";

export interface PreviewStreamConfiguration {
  readonly access: DeviceHubAccess;
  readonly threadId: string;
  readonly tabId: string;
  /** Taps, scrolls, keys, and `resize` to the view size. The floating player only watches. */
  readonly interactive: boolean;
  readonly background: string;
}

/** Messages the WebView document posts to the native view. */
export type PreviewStreamMessage =
  | ({ readonly type: "control" } & PreviewStreamControl)
  | {
      readonly type: "status";
      readonly status: "connecting" | "streaming" | "error";
      readonly detail?: string;
    }
  | { readonly type: "unauthorized" }
  | { readonly type: "gone" }
  | { readonly type: "viewport"; readonly width: number; readonly height: number }
  | {
      readonly type: "pictureInPicture";
      readonly supported: boolean;
      readonly active: boolean;
      readonly detail?: string;
    };

export function previewStreamDocument(configuration: string, script: string) {
  // Tickets and URLs are data, including any HTML delimiter characters.
  const safeConfiguration = configuration.replace(/</g, "\\u003c");
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const failure = `window.ReactNativeWebView.postMessage(JSON.stringify({type:"status",status:"error",detail:"Browser viewer stopped unexpectedly."}));`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html, body { height: 100%; overflow: hidden; }
  body { margin: 0; }
  body > div { position: fixed; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; }
  canvas, video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  canvas { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  video { pointer-events: none; }
  /* Pinned so focus never scrolls; 16px keeps iOS from zooming on focus. */
  textarea {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    padding: 0; margin: -1px; border: 0; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; font-size: 16px;
  }
</style></head><body><script>window.addEventListener("error",function(){${failure}});window.addEventListener("unhandledrejection",function(){${failure}});\n${safeScript}\ntry{T3PreviewStream.start(${safeConfiguration});}catch{${failure}}</script></body></html>`;
}

export function previewStreamMessage(data: string): PreviewStreamMessage | null {
  try {
    // Only our bundled viewer runs in this WebView; the remote page never does.
    return JSON.parse(data) as PreviewStreamMessage;
  } catch {
    return null;
  }
}
