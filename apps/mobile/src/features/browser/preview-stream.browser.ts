import {
  createPreviewFramePainter,
  createPreviewStreamClient,
  previewStreamModifiers,
  type PreviewStreamClient,
  type PreviewStreamInput,
  type PreviewStreamViewport,
} from "@t3tools/client-runtime/preview/server-browser-stream";

import type { PreviewStreamConfiguration, PreviewStreamMessage } from "./preview-stream-document";

declare global {
  interface Window {
    ReactNativeWebView: { postMessage: (message: string) => void };
  }
}

/** WebKit's presentation API, the only picture in picture entry on older iOS. */
interface PresentationVideo extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: "inline" | "picture-in-picture") => void;
  webkitPresentationMode?: string;
}

type WheelInput = Extract<PreviewStreamInput, { type: "wheel" }>;

const RESIZE_DEBOUNCE_MS = 150;
const TAP_SLOP_PX = 8;
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_SLOP_PX = 4;
const WHEEL_LINE_PX = 16;
// JPEG frames past 2x cost bandwidth without a visible gain on a phone.
const MAX_PIXEL_RATIO = 2;

interface Viewer {
  readonly stop: () => void;
  readonly command: (input: PreviewStreamInput) => void;
  readonly togglePictureInPicture: () => Promise<void>;
}

let activeViewer: Viewer | null = null;

export function stop() {
  activeViewer?.stop();
  activeViewer = null;
}

/** Navigation and history from the native chrome. Waits for the socket if it is not open yet. */
export function command(input: PreviewStreamInput) {
  activeViewer?.command(input);
}

export function pictureInPicture() {
  void activeViewer?.togglePictureInPicture();
}

/**
 * Bundled into a native WebView without React or Expo's web runtime. Draws a
 * server tab's JPEG frames into a letterboxed canvas. Interactive viewers turn
 * taps into clicks, drags into wheel scrolls, and soft keyboard input into key
 * and text messages, and resize fill-mode tabs to the view.
 */
export function start(configuration: PreviewStreamConfiguration) {
  stop();
  const post = (message: PreviewStreamMessage) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- The native WebView bridge takes one string.
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  const { interactive } = configuration;
  Object.assign(document.documentElement.style, { height: "100%", overflow: "hidden" });
  Object.assign(document.body.style, {
    margin: "0",
    height: "100%",
    overflow: "hidden",
    background: configuration.background,
  });
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "100%",
    height: "100%",
    overflow: "hidden",
  });
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Browser page");
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    touchAction: "none",
    userSelect: "none",
    webkitUserSelect: "none",
    webkitTouchCallout: "none",
  });
  container.append(canvas);
  // Focus target for page keyboard input, visually hidden like `sr-only`. Pinned
  // top-left so focusing it never scrolls; 16px keeps iOS from zooming on focus.
  const input = document.createElement("textarea");
  input.setAttribute("aria-label", "Browser page input");
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
  Object.assign(input.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    border: "0",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    fontSize: "16px",
  });
  document.body.replaceChildren(container, ...(interactive ? [input] : []));

  let stopped = false;
  let streaming = false;
  let viewport: PreviewStreamViewport | null = null;
  let size: { width: number; height: number } | null = null;
  // Frame cap in device px, fixed per socket. It only grows, so only outgrowing it reconnects.
  let cap: { width: number; height: number } | null = null;
  let client: PreviewStreamClient | null = null;
  let pendingCommand: PreviewStreamInput | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let wheelFrame: number | null = null;
  let pendingWheel: WheelInput | null = null;
  // Whether the page point under a touch takes text; null until the server answers.
  let probe: { x: number; y: number; editable: boolean | null; tapped: boolean } | null = null;
  let touch: {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    panning: boolean;
  } | null = null;
  let lastTap: { time: number; x: number; y: number; count: number } | null = null;

  const reportStatus = (status: "connecting" | "streaming") => {
    streaming = status === "streaming";
    post({ type: "status", status });
  };
  const painter = createPreviewFramePainter(canvas, () => {
    if (!streaming && !stopped) reportStatus("streaming");
  });
  const send = (message: PreviewStreamInput) => client?.send(message) ?? false;

  const connect = () => {
    client?.stop();
    if (!cap || stopped) return;
    const next = createPreviewStreamClient(
      {
        access: configuration.access,
        threadId: configuration.threadId,
        tabId: configuration.tabId,
        maxWidth: cap.width,
        maxHeight: cap.height,
      },
      {
        onFrame: (jpeg) => painter.paint(jpeg),
        onViewport: (page) => {
          if (viewport?.width === page.width && viewport.height === page.height) return;
          viewport = page;
          post({ type: "viewport", width: page.width, height: page.height });
        },
        onProbe: (result) => {
          const current = probe;
          if (!current || current.x !== result.x || current.y !== result.y) return;
          current.editable = result.editable;
          if (!current.tapped) return;
          // Late answer: Android still raises the keyboard; iOS waits for the next tap.
          probe = null;
          if (result.editable) input.focus({ preventScroll: true });
          else input.blur();
        },
        onConnectedChange: (connected) => {
          if (!connected) {
            if (streaming) reportStatus("connecting");
            return;
          }
          if (interactive && size) next.send({ type: "resize", ...size });
          const queued = pendingCommand;
          pendingCommand = null;
          if (queued) next.send(queued);
        },
        onUnauthorized: () => post({ type: "unauthorized" }),
        onGone: () => post({ type: "gone" }),
      },
    );
    client = next;
  };

  const measure = () => {
    resizeTimer = null;
    const rect = container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
    if (size?.width === next.width && size.height === next.height) return;
    size = next;
    if (interactive) send({ type: "resize", ...next });
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // The floating player scales a page of any shape into its box, so its cap is square.
    const side = Math.max(next.width, next.height);
    const width = Math.round((interactive ? next.width : side) * ratio);
    const height = Math.round((interactive ? next.height : side) * ratio);
    if (cap && cap.width >= width && cap.height >= height) return;
    cap = { width: Math.max(width, cap?.width ?? 0), height: Math.max(height, cap?.height ?? 0) };
    connect();
  };
  const observer = new ResizeObserver(() => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    // The first size connects right away; later ones settle before resizing the page.
    resizeTimer = setTimeout(measure, size === null ? 0 : RESIZE_DEBOUNCE_MS);
  });
  observer.observe(container);

  // iOS keeps the layout viewport under the soft keyboard; follow the visible area
  // so the page resizes above it.
  const visualViewport = window.visualViewport;
  const followVisualViewport = () => {
    if (!visualViewport) return;
    container.style.top = `${visualViewport.offsetTop}px`;
    container.style.height = `${visualViewport.height}px`;
  };
  if (interactive) {
    visualViewport?.addEventListener("resize", followVisualViewport);
    visualViewport?.addEventListener("scroll", followVisualViewport);
  }

  const pagePoint = (clientX: number, clientY: number, clamp: boolean) => {
    if (!viewport || canvas.width === 0 || canvas.height === 0) return null;
    const rect = canvas.getBoundingClientRect();
    // `object-fit: contain` letterboxes the frame inside the canvas box.
    const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const width = canvas.width * fit;
    const height = canvas.height * fit;
    if (!(width > 0 && height > 0)) return null;
    const scale = viewport.width / width;
    const x = (clientX - rect.left - (rect.width - width) / 2) * scale;
    const y = (clientY - rect.top - (rect.height - height) / 2) * (viewport.height / height);
    const inside = x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height;
    if (!inside && !clamp) return null;
    return {
      x: Math.min(Math.max(x, 0), viewport.width),
      y: Math.min(Math.max(y, 0), viewport.height),
      scale,
    };
  };

  // Wheel deltas coalesce to one message per animation frame.
  const flushWheel = () => {
    if (wheelFrame !== null) cancelAnimationFrame(wheelFrame);
    wheelFrame = null;
    const wheel = pendingWheel;
    pendingWheel = null;
    if (wheel) send(wheel);
  };
  const queueWheel = (point: { x: number; y: number }, deltaX: number, deltaY: number) => {
    pendingWheel = {
      type: "wheel",
      x: point.x,
      y: point.y,
      deltaX: (pendingWheel?.deltaX ?? 0) + deltaX,
      deltaY: (pendingWheel?.deltaY ?? 0) + deltaY,
      modifiers: 0,
    };
    wheelFrame ??= requestAnimationFrame(flushWheel);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    touch = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      panning: false,
    };
    const point = pagePoint(event.clientX, event.clientY, false);
    probe = point ? { x: point.x, y: point.y, editable: null, tapped: false } : null;
    if (point) send({ type: "probe", x: point.x, y: point.y });
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!touch || touch.pointerId !== event.pointerId) return;
    if (
      !touch.panning &&
      Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) < TAP_SLOP_PX
    ) {
      return;
    }
    touch.panning = true;
    const point = pagePoint(event.clientX, event.clientY, true);
    // Dragging the page up scrolls it down, following the finger.
    if (point) {
      queueWheel(
        point,
        (touch.lastX - event.clientX) * point.scale,
        (touch.lastY - event.clientY) * point.scale,
      );
    }
    touch.lastX = event.clientX;
    touch.lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    const ended = touch;
    if (!ended || ended.pointerId !== event.pointerId) return;
    touch = null;
    const answered = probe;
    if (ended.panning) {
      probe = null;
      return;
    }
    const point = pagePoint(event.clientX, event.clientY, false);
    if (!point) return;
    // Focusing inside the tap's user activation is what lets iOS raise the keyboard.
    if (answered?.editable === true) input.focus({ preventScroll: true });
    else if (answered?.editable === false) input.blur();
    if (answered?.editable === null) answered.tapped = true;
    else probe = null;
    flushWheel();
    const last = lastTap;
    const clickCount =
      last &&
      event.timeStamp - last.time < MULTI_CLICK_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < MULTI_CLICK_SLOP_PX
        ? last.count + 1
        : 1;
    lastTap = { time: event.timeStamp, x: event.clientX, y: event.clientY, count: clickCount };
    const at = { x: point.x, y: point.y, modifiers: 0 };
    send({ type: "mouse", action: "move", ...at, button: "none", buttons: 0, clickCount: 0 });
    send({ type: "mouse", action: "down", ...at, button: "left", buttons: 1, clickCount });
    send({ type: "mouse", action: "up", ...at, button: "left", buttons: 0, clickCount });
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (touch?.pointerId === event.pointerId) touch = null;
  };
  // Trackpads and mice on tablets scroll with wheel events.
  const onWheel = (event: WheelEvent) => {
    const point = pagePoint(event.clientX, event.clientY, false);
    if (!point) return;
    event.preventDefault();
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? (viewport?.height ?? 0)
          : 1;
    queueWheel(point, event.deltaX * unit, event.deltaY * unit);
  };
  // Keeps focus in the page input and stops native selection and callouts.
  const preventDefault = (event: Event) => event.preventDefault();

  const onKey = (action: "down" | "up", event: KeyboardEvent) => {
    // IME and soft keyboards deliver text through composition and input events.
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.key === "Process" ||
      event.key === "Unidentified"
    ) {
      return;
    }
    const shortcut = event.ctrlKey || event.metaKey;
    // Enter carries "\r" like Puppeteer's key table, so forms submit and textareas break lines.
    const text = shortcut
      ? undefined
      : [...event.key].length === 1
        ? event.key
        : event.key === "Enter"
          ? "\r"
          : undefined;
    send({
      type: "key",
      action,
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      ...(action === "down" && text !== undefined ? { text } : {}),
      modifiers: previewStreamModifiers(event),
    });
    if (!shortcut) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => onKey("down", event);
  const onKeyUp = (event: KeyboardEvent) => onKey("up", event);
  const onInput = (event: Event) => {
    if (event instanceof InputEvent && event.isComposing) return;
    if (input.value) send({ type: "text", text: input.value });
    input.value = "";
  };
  const onCompositionEnd = (event: CompositionEvent) => {
    if (event.data) send({ type: "text", text: event.data });
    input.value = "";
  };

  if (interactive) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", preventDefault);
    canvas.addEventListener("contextmenu", preventDefault);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("keyup", onKeyUp);
    input.addEventListener("input", onInput);
    input.addEventListener("compositionend", onCompositionEnd);
  }

  // Picture in picture plays the canvas as a muted video. It is created on first
  // use so a viewer that never pops out pays nothing for it.
  const supportsPresentationMode = (element: PresentationVideo) =>
    element.webkitSupportsPresentationMode?.("picture-in-picture") === true;
  const pictureInPictureSupported =
    interactive &&
    typeof canvas.captureStream === "function" &&
    (document.pictureInPictureEnabled === true ||
      supportsPresentationMode(document.createElement("video")));
  let video: PresentationVideo | null = null;
  const pictureInPictureActive = () =>
    video !== null &&
    (document.pictureInPictureElement === video ||
      video.webkitPresentationMode === "picture-in-picture");
  const reportPictureInPicture = (detail?: string) =>
    post({
      type: "pictureInPicture",
      supported: pictureInPictureSupported,
      active: pictureInPictureActive(),
      ...(detail ? { detail } : {}),
    });
  const ensureVideo = () => {
    if (video) return video;
    const element: PresentationVideo = document.createElement("video");
    element.muted = true;
    element.playsInline = true;
    element.autoplay = true;
    element.setAttribute("playsinline", "");
    // Under the canvas at full size: WebKit pauses muted video it considers off screen.
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      objectFit: "contain",
      pointerEvents: "none",
    });
    element.srcObject = canvas.captureStream();
    // A static page sends no new frames; repaint once so the stream has one.
    if (canvas.width > 0 && canvas.height > 0) canvas.getContext("2d")?.drawImage(canvas, 0, 0);
    for (const name of [
      "enterpictureinpicture",
      "leavepictureinpicture",
      "webkitpresentationmodechanged",
    ]) {
      element.addEventListener(name, () => {
        // The hidden inline copy stops decoding once the window closes.
        if (!pictureInPictureActive()) element.pause();
        reportPictureInPicture();
      });
    }
    container.prepend(element);
    video = element;
    return element;
  };
  const togglePictureInPicture = async () => {
    if (!pictureInPictureSupported) return;
    try {
      if (pictureInPictureActive()) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else video?.webkitSetPresentationMode?.("inline");
        return;
      }
      const element = ensureVideo();
      await element.play();
      if (document.pictureInPictureEnabled) await element.requestPictureInPicture();
      else element.webkitSetPresentationMode?.("picture-in-picture");
    } catch (error) {
      reportPictureInPicture(
        error instanceof Error ? error.message : "Picture in picture is unavailable.",
      );
    }
  };

  const viewer: Viewer = {
    stop: () => {
      stopped = true;
      observer.disconnect();
      visualViewport?.removeEventListener("resize", followVisualViewport);
      visualViewport?.removeEventListener("scroll", followVisualViewport);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      if (wheelFrame !== null) cancelAnimationFrame(wheelFrame);
      painter.stop();
      client?.stop();
      client = null;
      if (video) {
        for (const track of video.srcObject instanceof MediaStream
          ? video.srcObject.getTracks()
          : []) {
          track.stop();
        }
        video.srcObject = null;
      }
    },
    command: (message) => {
      if (!send(message)) pendingCommand = message;
    },
    togglePictureInPicture,
  };
  activeViewer = viewer;
  window.addEventListener("pagehide", stop, { once: true });
  reportStatus("connecting");
  if (interactive) reportPictureInPicture();
}
