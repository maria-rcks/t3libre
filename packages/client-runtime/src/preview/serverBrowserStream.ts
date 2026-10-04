// @effect-diagnostics globalTimers:off - This browser and WebView transport runs without an Effect runtime.
import { type DeviceHubAccess, withDeviceHubQuery } from "../device/hubAccess.ts";

export const PREVIEW_STREAM_BASE_PATH = "/api/preview-stream";

export interface PreviewStreamViewport {
  readonly width: number;
  readonly height: number;
}

export type PreviewStreamMouseButton = "none" | "left" | "middle" | "right";

/** Client-to-server messages. Coordinates are page CSS px. */
export type PreviewStreamInput =
  | {
      readonly type: "mouse";
      readonly action: "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button: PreviewStreamMouseButton;
      /** Pressed buttons: left 1, right 2, middle 4. */
      readonly buttons: number;
      readonly clickCount: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "key";
      readonly action: "down" | "up";
      readonly key: string;
      readonly code: string;
      /** Windows virtual key code (DOM `keyCode`); Enter, Backspace, and arrows need it. */
      readonly keyCode?: number;
      /** Only for printable keys without Ctrl or Meta. */
      readonly text?: string;
      readonly modifiers: number;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "history"; readonly delta: -1 | 1 }
  | { readonly type: "reload" }
  /** Asks whether the page point takes text. Touch viewers send it on touch start. */
  | { readonly type: "probe"; readonly x: number; readonly y: number };

/** Answer to a `probe`, echoing its point. */
export interface PreviewStreamProbe {
  readonly x: number;
  readonly y: number;
  readonly editable: boolean;
}

/** CDP modifier bitmask: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export const previewStreamModifiers = (event: {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): number =>
  (event.altKey ? 1 : 0) |
  (event.ctrlKey ? 2 : 0) |
  (event.metaKey ? 4 : 0) |
  (event.shiftKey ? 8 : 0);

export interface PreviewStreamTarget {
  readonly access: DeviceHubAccess;
  readonly threadId: string;
  readonly tabId: string;
  /** Viewer backing-store size in device px. The server never sends larger frames. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface PreviewStreamEvents {
  /** One complete JPEG frame. */
  readonly onFrame: (jpeg: ArrayBuffer) => void;
  readonly onViewport: (viewport: PreviewStreamViewport) => void;
  readonly onProbe?: (probe: PreviewStreamProbe) => void;
  /** Input sent while disconnected is dropped. */
  readonly onConnectedChange: (connected: boolean) => void;
  /** The upgrade was refused; refresh access and start a new client. */
  readonly onUnauthorized: () => void;
  /** The tab was closed on the server. The client has stopped. */
  readonly onGone?: () => void;
}

export interface PreviewStreamClient {
  /** False when the socket is not open and the message was dropped. */
  readonly send: (input: PreviewStreamInput) => boolean;
  readonly stop: () => void;
}

const ACK_MESSAGE = JSON.stringify({ type: "ack" });
export function createPreviewStreamClient(
  target: PreviewStreamTarget,
  events: PreviewStreamEvents,
): PreviewStreamClient {
  const query = new URLSearchParams({
    threadId: target.threadId,
    tabId: target.tabId,
    maxWidth: String(Math.max(1, Math.round(target.maxWidth))),
    maxHeight: String(Math.max(1, Math.round(target.maxHeight))),
  });
  const url = withDeviceHubQuery(`${target.access.wsBase}/ws?${query.toString()}`, target.access);
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    socket = ws;
    let opened = false;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      opened = true;
      events.onConnectedChange(true);
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws) return;
      if (event.data instanceof ArrayBuffer) {
        failures = 0;
        ws.send(ACK_MESSAGE);
        events.onFrame(event.data);
        return;
      }
      if (typeof event.data !== "string") return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null) return;
      const { type, x, y, width, height, editable } = message as Record<string, unknown>;
      if (type === "viewport" && typeof width === "number" && typeof height === "number") {
        failures = 0;
        events.onViewport({ width, height });
      } else if (
        type === "probe" &&
        typeof x === "number" &&
        typeof y === "number" &&
        typeof editable === "boolean"
      ) {
        events.onProbe?.({ x, y, editable });
      }
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = null;
      if (opened) events.onConnectedChange(false);
      if (stopped) return;
      if (event.code === 4404) {
        stopped = true;
        events.onGone?.();
        return;
      }
      // Rejected upgrades surface as 1006 before open for both cookies and tickets.
      if (event.code === 1008 || event.code === 4401 || (!opened && event.code === 1006)) {
        stopped = true;
        events.onUnauthorized();
        return;
      }
      retryTimer = setTimeout(connect, Math.min(500 * 2 ** failures++, 10_000));
    });
    ws.addEventListener("error", () => ws.close());
  };

  connect();

  return {
    send: (input) => {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(input));
      return true;
    },
    stop: () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}

export interface PreviewFramePainter {
  readonly paint: (jpeg: ArrayBuffer) => void;
  readonly stop: () => void;
}

/** One decode at a time, keeping only the latest waiting frame for slow viewers. */
export function createPreviewFramePainter(
  canvas: HTMLCanvasElement,
  onPainted?: () => void,
): PreviewFramePainter {
  const context = canvas.getContext("2d");
  let stopped = false;
  let decoding = false;
  let waiting: ArrayBuffer | null = null;
  const draw = (jpeg: ArrayBuffer) => {
    decoding = true;
    void createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (stopped || !context) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        onPainted?.();
      })
      // A frame that fails to decode is skipped; the next one repaints.
      .catch(() => undefined)
      .finally(() => {
        decoding = false;
        const next = waiting;
        waiting = null;
        if (next && !stopped) draw(next);
      });
  };
  return {
    paint: (jpeg) => {
      if (stopped) return;
      if (decoding) waiting = jpeg;
      else draw(jpeg);
    },
    stop: () => {
      stopped = true;
      waiting = null;
    },
  };
}
