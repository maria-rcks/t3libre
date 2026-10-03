// @effect-diagnostics globalDate:off - Playwright callbacks run outside the Effect runtime.
/**
 * Page-level automation for server-hosted preview tabs.
 *
 * Plain async helpers over one Playwright page, called by `ServerBrowser`.
 * Results mirror what desktop hosts return for the same operations, so the
 * MCP preview tools cannot tell the two runtimes apart. Failures carry the
 * broker's error tags (see `PreviewAutomationBroker.classifyResponseError`).
 */
import type {
  PreviewAutomationClickInput,
  PreviewAutomationConsoleEntry,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNetworkEntry,
  PreviewAutomationPressInput,
  PreviewAutomationScrollInput,
  PreviewAutomationSnapshot,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "@t3tools/contracts";
import type { CDPSession, Locator, Page } from "playwright-core";

const MAX_EVALUATION_BYTES = 64_000;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 200;
const MAX_SCREENSHOT_WIDTH = 1280;
export const DIAGNOSTIC_BUFFER_LIMIT = 200;

export class ServerBrowserOperationError extends Error {
  readonly tag: string;
  readonly detail: unknown;

  constructor(tag: string, message: string, detail?: unknown) {
    super(message);
    this.tag = tag;
    this.detail = detail;
  }
}

/** Maps a Playwright failure onto the tag the broker classifies. */
export const toOperationError = (cause: unknown): ServerBrowserOperationError => {
  if (cause instanceof ServerBrowserOperationError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const firstLine = message.split("\n")[0] ?? message;
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return new ServerBrowserOperationError("PreviewAutomationTimeoutError", firstLine);
  }
  if (/while parsing selector|Unknown engine|Unexpected token/i.test(message)) {
    return new ServerBrowserOperationError("PreviewAutomationInvalidSelectorError", firstLine);
  }
  if (/not an <input>|not editable|not an editable/i.test(message)) {
    return new ServerBrowserOperationError("PreviewAutomationTargetNotEditableError", firstLine);
  }
  return new ServerBrowserOperationError("PreviewAutomationExecutionError", firstLine);
};

const DEFAULT_TIMEOUT_MS = 15_000;

const targetLocator = (
  page: Page,
  input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
): Locator | null => {
  const selector = input.locator ?? input.selector;
  return selector === undefined ? null : page.locator(selector).first();
};

const SNAPSHOT_SCRIPT = `(() => {
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    for (const attribute of ["data-testid", "name"]) {
      const value = element.getAttribute(attribute);
      if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
    }
    const parts = [];
    for (let current = element; current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8; current = current.parentElement) {
      const parent = current.parentElement;
      const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
      const base = current.tagName.toLowerCase();
      parts.unshift(siblings.length > 1 ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : base);
    }
    return parts.join(" > ");
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const elements = Array.from(document.querySelectorAll("a[href],button,input,textarea,select,[role],[tabindex]"))
    .filter(visible)
    .slice(0, ${MAX_INTERACTIVE_ELEMENTS})
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "").slice(0, ${MAX_INTERACTIVE_ELEMENT_NAME_LENGTH}),
        selector: selectorFor(element),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${MAX_VISIBLE_TEXT_LENGTH}),
    interactiveElements: elements,
  };
})()`;

/**
 * The visible viewport as an image, `scale` relative to the rendered pixels.
 *
 * A scaled capture briefly re-renders the page at that scale, and every live
 * screencast on the page streams that frame; callers pause them around it.
 * At full scale there is no clip and nothing re-renders. The clip is
 * document-relative, so it starts at the scroll offset.
 */
export const captureViewport = async (
  page: Page,
  cdp: CDPSession,
  options: { readonly format: "png" | "jpeg"; readonly quality?: number; readonly scale: number },
) => {
  const quality = options.quality === undefined ? {} : { quality: options.quality };
  if (options.scale >= 1) {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: options.format,
      ...quality,
    });
    return data;
  }
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const { cssVisualViewport } = await cdp.send("Page.getLayoutMetrics");
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: options.format,
    ...quality,
    clip: {
      x: cssVisualViewport.pageX,
      y: cssVisualViewport.pageY,
      width: viewport.width,
      height: viewport.height,
      scale: options.scale,
    },
  });
  return data;
};

/**
 * Screenshot of the current viewport at device resolution, scaled down to at
 * most `MAX_SCREENSHOT_WIDTH` like desktop snapshots. `clip.scale` multiplies
 * the render scale, so this needs no image library on the server.
 */

export const captureViewportPng = async (page: Page, cdp: CDPSession, renderScale: number) => {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const scale = Math.min(1, MAX_SCREENSHOT_WIDTH / (viewport.width * renderScale));
  const data = await captureViewport(page, cdp, { format: "png", scale });
  return {
    mimeType: "image/png" as const,
    data,
    width: Math.round(viewport.width * renderScale * scale),
    height: Math.round(viewport.height * renderScale * scale),
  };
};

export const snapshot = async (input: {
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly renderScale: number;
  readonly consoleEntries: ReadonlyArray<PreviewAutomationConsoleEntry>;
  readonly networkEntries: ReadonlyArray<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: PreviewAutomationSnapshot["actionTimeline"];
}): Promise<PreviewAutomationSnapshot> => {
  const [page, screenshot] = await Promise.all([
    input.page.evaluate(SNAPSHOT_SCRIPT) as Promise<
      Pick<
        PreviewAutomationSnapshot,
        "url" | "title" | "loading" | "visibleText" | "interactiveElements"
      >
    >,
    captureViewportPng(input.page, input.cdp, input.renderScale),
  ]);
  return {
    ...page,
    // The MCP layer drops the AX tree before it reaches the agent.
    accessibilityTree: null,
    consoleEntries: [...input.consoleEntries],
    networkEntries: [...input.networkEntries],
    actionTimeline: [...input.actionTimeline],
    screenshot,
  };
};

/** Resolves the viewport point an action targets, for the agent cursor. */
export const click = async (
  page: Page,
  input: PreviewAutomationClickInput,
): Promise<{ readonly x: number; readonly y: number }> => {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  if (locator === null) {
    await page.mouse.click(input.x!, input.y!);
    return { x: input.x!, y: input.y! };
  }
  await locator.scrollIntoViewIfNeeded({ timeout });
  const box = await locator.boundingBox({ timeout });
  await locator.click({ timeout });
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: 0, y: 0 };
};

export const type = async (page: Page, input: PreviewAutomationTypeInput) => {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const locator = targetLocator(page, input);
  if (locator !== null) {
    if (input.clear) {
      await locator.fill(input.text, { timeout });
      return;
    }
    await locator.focus({ timeout });
  } else if (input.clear) {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
  }
  await page.keyboard.insertText(input.text);
};

export const press = async (page: Page, input: PreviewAutomationPressInput) => {
  await page.keyboard.press([...(input.modifiers ?? []), input.key].join("+"));
};

export const scroll = async (page: Page, input: PreviewAutomationScrollInput) => {
  const delta = [input.deltaX ?? 0, input.deltaY ?? 0] as const;
  const locator = targetLocator(page, input);
  if (locator === null) {
    // Page-side code is passed as source: the server compiles without DOM types.
    await page.evaluate(`scrollBy(${delta[0]}, ${delta[1]})`);
    return;
  }
  await locator.evaluate((element, [x, y]) => element.scrollBy(x, y), delta);
};

export const evaluate = async (cdp: CDPSession, input: PreviewAutomationEvaluateInput) => {
  const result = await cdp.send("Runtime.evaluate", {
    expression: input.expression,
    awaitPromise: input.awaitPromise ?? true,
    returnByValue: input.returnByValue ?? true,
  });
  if (result.exceptionDetails) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationExecutionError",
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
    );
  }
  const value =
    "value" in result.result ? result.result.value : (result.result.description ?? null);
  const actualBytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (actualBytes > MAX_EVALUATION_BYTES) {
    throw new ServerBrowserOperationError(
      "PreviewAutomationResultTooLargeError",
      `Evaluation result is ${actualBytes} bytes; the limit is ${MAX_EVALUATION_BYTES}.`,
      { maximumBytes: MAX_EVALUATION_BYTES },
    );
  }
  return value;
};

export const waitFor = async (page: Page, input: PreviewAutomationWaitForInput) => {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const remaining = () => Math.max(1, deadline - Date.now());
  const locator = targetLocator(page, input);
  if (locator !== null) await locator.waitFor({ state: "visible", timeout: remaining() });
  if (input.text !== undefined) {
    await page.waitForFunction(
      `(document.body?.innerText ?? "").includes(${JSON.stringify(input.text)})`,
      undefined,
      { timeout: remaining() },
    );
  }
  if (input.urlIncludes !== undefined) {
    await page.waitForFunction(
      `location.href.includes(${JSON.stringify(input.urlIncludes)})`,
      undefined,
      {
        timeout: remaining(),
      },
    );
  }
};

/** Chromium net error names reported for failed main-frame loads. */
const NET_ERROR_CODES: Readonly<Record<string, number>> = {
  ERR_FAILED: -2,
  ERR_TIMED_OUT: -7,
  ERR_CONNECTION_CLOSED: -100,
  ERR_CONNECTION_RESET: -101,
  ERR_CONNECTION_REFUSED: -102,
  ERR_NAME_NOT_RESOLVED: -105,
  ERR_INTERNET_DISCONNECTED: -106,
  ERR_ADDRESS_UNREACHABLE: -109,
  ERR_CERT_AUTHORITY_INVALID: -202,
  ERR_EMPTY_RESPONSE: -324,
};

export const parseNetError = (errorText: string) => {
  const description = /ERR_[A-Z_]+/.exec(errorText)?.[0] ?? errorText;
  return { description, code: NET_ERROR_CODES[description] ?? -2 };
};

/**
 * In-page video encoder for recordings. Screencast frames are drawn onto a
 * canvas and encoded by the browser's own MediaRecorder, so recording needs
 * no ffmpeg on the server and costs about the same CPU as piping to x264.
 * The agent cursor is drawn on the canvas, not injected into the page. The
 * video keeps its first frame's size; a page resized mid-recording is
 * letterboxed into it.
 */
export const RECORDING_ENCODER_SCRIPT = `(() => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const chunks = [];
  let recorder = null;
  let frame = null;
  let cursor = null;
  let ring = null;
  let ringTimer = null;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const paint = () => {
    if (!frame) return;
    const fit = Math.min(canvas.width / frame.width, canvas.height / frame.height);
    const width = frame.width * fit;
    const height = frame.height * fit;
    offsetX = (canvas.width - width) / 2;
    offsetY = (canvas.height - height) / 2;
    if (width < canvas.width || height < canvas.height) {
      context.fillStyle = "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(frame, offsetX, offsetY, width, height);
    scale = (width / frame.width) * frame.cssScale;
    if (ring) {
      const age = (performance.now() - ring.at) / 400;
      if (age < 1) {
        context.beginPath();
        context.arc(offsetX + ring.x * scale, offsetY + ring.y * scale, (8 + 18 * age) * scale, 0, Math.PI * 2);
        context.strokeStyle = "rgba(59,130,246," + (0.9 * (1 - age)) + ")";
        context.lineWidth = 3 * scale;
        context.stroke();
      }
    }
    if (cursor) {
      const x = offsetX + cursor.x * scale;
      const y = offsetY + cursor.y * scale;
      const s = scale;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y + 18 * s);
      context.lineTo(x + 4.5 * s, y + 14 * s);
      context.lineTo(x + 8 * s, y + 21 * s);
      context.lineTo(x + 11 * s, y + 19.5 * s);
      context.lineTo(x + 7.5 * s, y + 12.5 * s);
      context.lineTo(x + 13 * s, y + 12.5 * s);
      context.closePath();
      context.fillStyle = "#111";
      context.strokeStyle = "#fff";
      context.lineWidth = 1.5 * s;
      context.fill();
      context.stroke();
    }
  };
  window.__t3Recorder = {
    async frame(base64, cssWidth) {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      if (!recorder) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const mimeType = ["video/mp4;codecs=avc1.640033", "video/webm;codecs=vp9", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
        const bitsPerSecond = Math.min(50e6, Math.max(2.5e6, bitmap.width * bitmap.height * 30 * 0.05));
        recorder = new MediaRecorder(canvas.captureStream(30), { mimeType, videoBitsPerSecond: bitsPerSecond });
        recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
        recorder.start(1000);
      }
      // Frame px per page CSS px, before fitting into the canvas.
      bitmap.cssScale = bitmap.width / cssWidth;
      frame?.close();
      frame = bitmap;
      paint();
    },
    cursor(x, y, click) {
      cursor = { x, y };
      if (click) {
        ring = { x, y, at: performance.now() };
        clearInterval(ringTimer);
        ringTimer = setInterval(() => {
          paint();
          if (performance.now() - ring.at > 400) { ring = null; clearInterval(ringTimer); paint(); }
        }, 33);
      }
      paint();
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder) return resolve({ mimeType: null, count: 0 });
        recorder.onstop = () => resolve({ mimeType: recorder.mimeType, count: chunks.length });
        recorder.stop();
      });
    },
    async chunk(index) {
      const bytes = new Uint8Array(await chunks[index].arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    },
  };
})()`;
