// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off - Playwright callbacks run outside the Effect runtime.
// Screencasts ignore emulated device scale; real 2x keeps captures sharp.
// --disable-gpu uses cheaper software compositing while preserving SwiftShader WebGL.
import {
  FILL_PREVIEW_VIEWPORT,
  INCOGNITO_BROWSER_PROFILE_ID,
  PREVIEW_AUTOMATION_SERVER_OPERATIONS,
  PreviewViewportSetting as PreviewViewportSettingSchema,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type PreviewAutomationActionEvent,
  type PreviewAutomationClickInput,
  type PreviewAutomationDialogInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationOpenInput,
  type PreviewAutomationPressInput,
  type PreviewAutomationRequest,
  type PreviewAutomationResizeInput,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationWaitForInput,
  PreviewClearProfileError,
  type PreviewEvent,
  type PreviewNavStatus,
  type PreviewSessionSnapshot,
  type PreviewViewportSetting,
  ThreadId,
} from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CDPSession, Dialog, Page } from "playwright-core";

import { PENDING_ATTACHMENT_THREAD_SEGMENT } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import * as PreviewManager from "./Manager.ts";
import * as ServerBrowserPage from "./ServerBrowserPage.ts";
import * as ServerBrowserToolchain from "./ServerBrowserToolchain.ts";
import { ServerBrowserContexts } from "./ServerBrowserContexts.ts";
import { BrowserControlInterrupted, SessionControl } from "./SessionControl.ts";
import { isServerBrowserEnabled } from "./serverBrowserEnabled.ts";

const SERVER_HOST_CLIENT_ID = "server-browser";
const RENDER_SCALE = 2;
// Chromium allows three unacked frames, so 100 ms pacing caps viewers near 30 fps.
const SCREENCAST_ACK_PACE_MS = 100;
const SCREENCAST_SETTLE_MS = 200;
// Only scrolling triggers reduced-quality motion frames; animations stay sharp.
const SCREENCAST_MOTION_FRAMES = 4;
const SCREENCAST_MOTION_WINDOW_MS = 300;
const SCREENCAST_MOTION_QUALITY = 50;
const HOST_RECONNECT_DELAY = "1 second";
const VIEWER_OUTPUT_LIMIT = 64;
const RECORDING_SCREENCAST = { format: "jpeg", quality: 90, everyNthFrame: 1 } as const;
const decodeViewportSetting = Schema.decodeUnknownSync(PreviewViewportSettingSchema);

const sleepUntil = (deadline: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));

// Touch viewers raise the keyboard for editable targets, including opaque frames.
const EDITABLE_AT_POINT_SCRIPT = `(x, y) => {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  if (element && element.tagName === "LABEL" && element.control) element = element.control;
  if (!element) return false;
  if (element.tagName === "IFRAME" || element.tagName === "FRAME") return true;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return !element.disabled && !element.readOnly;
  if (element.tagName !== "INPUT") return false;
  const nonText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
  return !nonText.includes(element.type) && !element.disabled && !element.readOnly;
}`;
const UNATTACHED_FILL_VIEWPORT = { width: 1280, height: 800 } as const;
const NAVIGATION_TIMEOUT_MS = 15_000;
const VIEWER_NAVIGATION_OPTIONS = { waitUntil: "commit", timeout: NAVIGATION_TIMEOUT_MS } as const;
const ACTION_TIMELINE_LIMIT = 50;

export class ServerBrowserTabNotFoundError extends Schema.TaggedError<ServerBrowserTabNotFoundError>()(
  "ServerBrowserTabNotFoundError",
  { threadId: Schema.String, tabId: Schema.String },
) {
  override get message(): string {
    return "The server preview tab does not exist.";
  }
}

const isTabNotFound = Schema.is(ServerBrowserTabNotFoundError);

export class ServerBrowserLaunchError extends Schema.TaggedError<ServerBrowserLaunchError>()(
  "ServerBrowserLaunchError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The server preview browser could not start.";
  }
}

export type ServerBrowserViewerOutput =
  | {
      readonly _tag: "frame";
      readonly data: Uint8Array;
      readonly ack: Effect.Effect<void>;
    }
  | { readonly _tag: "viewport"; readonly width: number; readonly height: number }
  | {
      readonly _tag: "control";
      readonly canOperate: boolean;
      readonly controller: "agent" | "you" | "another-viewer" | "unclaimed";
      readonly generation: number;
      readonly dialog: {
        readonly type: string;
        readonly message: string;
        readonly defaultValue: string;
      } | null;
    }
  | {
      readonly _tag: "probe";
      readonly x: number;
      readonly y: number;
      readonly editable: boolean;
    }
  | { readonly _tag: "gone" };

export interface ServerBrowserViewer {
  readonly output: Queue.Dequeue<ServerBrowserViewerOutput>;
  readonly input: (message: unknown) => Effect.Effect<void>;
}

export class ServerBrowser extends Context.Service<
  ServerBrowser,
  {
    readonly enabled: boolean;
    readonly attachViewer: (input: {
      readonly threadId: string;
      readonly tabId: string;
      readonly maxWidth: number;
      readonly maxHeight: number;
      readonly quality: number;
      readonly canOperate: boolean;
    }) => Effect.Effect<
      ServerBrowserViewer,
      ServerBrowserTabNotFoundError | ServerBrowserLaunchError,
      Scope.Scope
    >;
    /** Deletes a human profile's server-side storage, closing its open tabs first. */
    readonly clearProfile: (profileId: string) => Effect.Effect<void, PreviewClearProfileError>;
  }
>()("t3/preview/ServerBrowser") {}

interface ViewerState {
  readonly id: string;
  readonly canOperate: boolean;
  readonly pressedKeys: Map<string, { key: string; code: string }>;
  readonly pressedButtons: Map<"left" | "middle" | "right", { x: number; y: number }>;
  readonly push: (output: ServerBrowserViewerOutput) => void;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  scrolledAt: number;
  /** Panel bounds, retained in fixed mode; passive viewers never request a size. */
  requestedSize: { width: number; height: number; order: number } | null;
}

interface EncoderWindow {
  __t3Recorder: {
    cursor(x: number, y: number, click: boolean): void;
    frame(data: string, width: number): Promise<boolean>;
    stop(): Promise<{ mimeType: string | null; count: number; bytes: number }>;
    chunk(index: number): Promise<string>;
  };
}

interface Recording {
  readonly encoder: Page;
  readonly session: CDPSession;
  readonly startedAt: string;
  /** Frames still being handed to the encoder; stopping waits for them. */
  readonly framesInFlight: Set<Promise<void>>;
}

interface ServerTab {
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly createdAt: number;
  readonly viewers: Set<ViewerState>;
  readonly consoleEntries: Array<PreviewAutomationConsoleEntry>;
  readonly networkEntries: Array<PreviewAutomationNetworkEntry>;
  readonly actionTimeline: Array<PreviewAutomationActionEvent>;
  readonly control: SessionControl;
  /** The tab's own storage context, closed with it. Popups share their opener's. */
  readonly isolatedContext: boolean;
  readonly profileId: string | undefined;
  /** Set when a page in another tab opened this one with `window.open` or a link. */
  readonly openerTabId: string | undefined;
  dialog: Dialog | null;
  setting: PreviewViewportSetting;
  loading: boolean;
  closing: boolean;
  recording: Recording | null;
  initialNavigation: Promise<void> | null;
  /** The latest queued start, so a stop can find a recording still starting. */
  recordingStart: Promise<Recording> | null;
  /** Serializes captures and recording start/stop. */
  captureLock: Promise<void>;
  /** Scaled captures rendering now; screencasts stay stopped meanwhile. */
  capturing: number;
}

const tabKey = (threadId: string, tabId: string) => `${threadId}\u0000${tabId}`;

const pushBounded = <A>(
  buffer: Array<A>,
  entry: A,
  limit = ServerBrowserPage.DIAGNOSTIC_BUFFER_LIMIT,
) => {
  buffer.push(entry);
  if (buffer.length > limit) buffer.splice(0, buffer.length - limit);
};

const fixedViewportSize = (setting: PreviewViewportSetting) =>
  setting._tag === "fill" ? null : { width: setting.width, height: setting.height };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const modifiersOf = (message: Record<string, unknown>) => {
  const value = num(message.modifiers);
  return Number.isInteger(value) && value >= 0 && value < 16 ? value : 0;
};

// Cmd shortcuts from Apple viewers are no editing shortcut for Linux or headless
// Chromium, so they carry the command. Ctrl already works natively on Linux.
const metaEditingCommand = (key: string, modifiers: number) => {
  if ((modifiers & 0b0111) !== 4) return null;
  const lower = key.toLowerCase();
  const command =
    lower === "a" ? "selectAll" : lower === "z" ? (modifiers & 8 ? "redo" : "undo") : null;
  return command ? { commands: [command] } : null;
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const enabled = isServerBrowserEnabled(config.mode);
  const manager = yield* PreviewManager.PreviewManager;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const toolchain = yield* ServerBrowserToolchain.ServerBrowserToolchain;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  const tabs = new Map<string, ServerTab>();
  const pendingTabs = new Map<string, Promise<ServerTab>>();
  /** Sessions closed while their tab was still opening; the open discards its page. */
  const closedPendingTabs = new Set<string>();
  /** Popup pages waiting for the tab their `opened` event creates. */
  const adoptedPages = new Map<string, { readonly page: Page; readonly openerTabId: string }>();
  let hostConnectionId: string | null = null;
  let viewerResizeOrder = 0;

  const contexts = new ServerBrowserContexts({
    profilesDir: NodePath.join(config.stateDir, "server-browser", "profiles"),
    resolve: () => Effect.runPromise(toolchain.resolve),
    onContextClose: (context) => {
      for (const tab of tabs.values()) {
        if (tab.page.context() === context) dropTab(tab, true);
      }
    },
  });

  const dialogStatus = (tab: ServerTab) =>
    tab.dialog
      ? {
          type: tab.dialog.type(),
          message: tab.dialog.message().slice(0, 4000),
          defaultValue: tab.dialog.defaultValue().slice(0, 4000),
        }
      : null;

  const broadcastControl = (tab: ServerTab) => {
    for (const viewer of tab.viewers)
      viewer.push({
        _tag: "control",
        canOperate: viewer.canOperate,
        controller:
          tab.control.controller === viewer.id
            ? "you"
            : tab.control.controller !== null
              ? "another-viewer"
              : tab.control.agentId !== null
                ? "agent"
                : "unclaimed",
        generation: tab.control.generation,
        dialog: dialogStatus(tab),
      });
  };

  const resolveDialog = async (tab: ServerTab, input: PreviewAutomationDialogInput) => {
    const dialog = tab.dialog;
    if (!dialog) throw new Error("No dialog is pending.");
    if (input.accept) await dialog.accept(input.promptText);
    else await dialog.dismiss();
    if (tab.dialog === dialog) tab.dialog = null;
    ServerBrowserPage.invalidateRefs(tab.page);
    broadcastControl(tab);
  };

  const report = (tab: ServerTab, navStatus: PreviewNavStatus) => {
    void tab.cdp
      .send("Page.getNavigationHistory")
      .catch(() => null)
      .then((history) => {
        const index = history?.currentIndex ?? 0;
        const count = history?.entries.length ?? 0;
        runFork(
          manager
            .reportStatus({
              threadId: tab.threadId,
              tabId: tab.tabId,
              serverControlled: true,
              navStatus,
              canGoBack: index > 0,
              canGoForward: index < count - 1,
            })
            .pipe(Effect.ignore),
        );
      });
  };

  const reportLoaded = async (tab: ServerTab) => {
    const url = tab.page.url();
    // Chromium's error page loads after `requestfailed` and must not clear LoadFailed.
    if (url === "about:blank" || url.startsWith("chrome-error://")) return;
    const title = (await tab.page.title().catch(() => "")).slice(0, 512);
    // A navigation that started while reading the title owns the status now.
    if (tab.loading || tab.page.url() !== url) return;
    report(tab, { _tag: "Success", url: url.slice(0, 2048), title });
  };

  const reportLiveTabs = () => {
    const connectionId = hostConnectionId;
    if (connectionId === null) return;
    runFork(
      environment.getEnvironmentId.pipe(
        Effect.flatMap((environmentId) =>
          broker.focusHost({
            clientId: SERVER_HOST_CLIENT_ID,
            environmentId,
            connectionId,
            focused: true,
            liveTabs: [...tabs.values()].map((tab) => ({
              threadId: tab.threadId,
              tabId: tab.tabId,
              visible: tab.viewers.size > 0,
            })),
          }),
        ),
      ),
    );
  };

  const broadcastViewport = (tab: ServerTab) => {
    const size = tab.page.viewportSize();
    if (!size) return;
    for (const viewer of tab.viewers) viewer.push({ _tag: "viewport", ...size });
  };

  const applySetting = async (tab: ServerTab, setting: PreviewViewportSetting) => {
    tab.setting = setting;
    const size =
      fixedViewportSize(setting) ??
      [...tab.viewers]
        .map((viewer) => viewer.requestedSize)
        .filter((requested) => requested !== null)
        .sort((left, right) => right.order - left.order)[0] ??
      UNATTACHED_FILL_VIEWPORT;
    await tab.page.setViewportSize({ width: size.width, height: size.height });
    broadcastViewport(tab);
  };

  const dropTab = (tab: ServerTab, closeSession: boolean) => {
    const key = tabKey(tab.threadId, tab.tabId);
    if (tabs.get(key) !== tab) return;
    tabs.delete(key);
    tab.closing = true;
    for (const viewer of tab.viewers) viewer.push({ _tag: "gone" });
    void tab.control.close().catch(constVoid);
    void tab.page.close().catch(constVoid);
    if (tab.isolatedContext) void tab.page.context().close().catch(constVoid);
    void tab.recording?.encoder.close().catch(constVoid);
    reportLiveTabs();
    if (closeSession) {
      runFork(manager.close({ threadId: tab.threadId, tabId: tab.tabId }).pipe(Effect.ignore));
    }
  };

  const createTab = async (snapshot: PreviewSessionSnapshot): Promise<ServerTab> => {
    const adopted = adoptedPages.get(tabKey(snapshot.threadId, snapshot.tabId));
    adoptedPages.delete(tabKey(snapshot.threadId, snapshot.tabId));
    const isolatedContext =
      adopted === undefined &&
      (snapshot.automationOwner !== undefined ||
        snapshot.profileId === INCOGNITO_BROWSER_PROFILE_ID);
    const context =
      adopted?.page.context() ??
      (await contexts.contextFor(
        snapshot.profileId ?? "default",
        isolatedContext ? tabKey(snapshot.threadId, snapshot.tabId) : undefined,
      ));
    if (adopted?.page.isClosed()) throw new Error("The popup closed before it opened.");
    const page = adopted?.page ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const control = new SessionControl(snapshot.automationOwner ?? null, () =>
      ServerBrowserPage.invalidateRefs(page),
    );
    const tab: ServerTab = {
      threadId: ThreadId.make(snapshot.threadId),
      tabId: snapshot.tabId,
      page,
      cdp,
      createdAt: Date.now(),
      viewers: new Set(),
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
      control,
      isolatedContext,
      profileId: snapshot.profileId,
      openerTabId: adopted?.openerTabId,
      dialog: null,
      setting: snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
      loading: false,
      closing: false,
      recording: null,
      recordingStart: null,
      initialNavigation: null,
      captureLock: Promise.resolve(),
      capturing: 0,
    };
    await page.setViewportSize(fixedViewportSize(tab.setting) ?? UNATTACHED_FILL_VIEWPORT);
    const isMainNavigation = (request: { isNavigationRequest(): boolean; frame(): unknown }) =>
      request.isNavigationRequest() && request.frame() === page.mainFrame();
    page.on("request", (request) => {
      if (!isMainNavigation(request)) return;
      tab.loading = true;
      report(tab, { _tag: "Loading", url: request.url().slice(0, 2048), title: "" });
    });
    page.on("load", () => {
      tab.loading = false;
      void reportLoaded(tab);
    });
    page.on("framenavigated", (frame) => {
      // Same-document navigations (SPA routes) fire no load event.
      if (frame === page.mainFrame() && !tab.loading) void reportLoaded(tab);
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText ?? "";
      pushBounded(tab.networkEntries, {
        url: request.url(),
        method: request.method(),
        status: null,
        failed: true,
        errorText,
        timestamp: new Date().toISOString(),
      });
      if (!isMainNavigation(request) || errorText.includes("ERR_ABORTED")) return;
      tab.loading = false;
      const { code, description } = ServerBrowserPage.parseNetError(errorText);
      report(tab, {
        _tag: "LoadFailed",
        url: request.url().slice(0, 2048),
        title: "",
        code,
        description,
      });
    });
    page.on("response", (response) => {
      pushBounded(tab.networkEntries, {
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        failed: false,
        timestamp: new Date().toISOString(),
      });
    });
    page.on("console", (message) => {
      pushBounded(tab.consoleEntries, {
        level: message.type(),
        text: message.text().slice(0, 2_000),
        timestamp: new Date().toISOString(),
      });
    });
    page.on("dialog", (dialog) => {
      tab.dialog = dialog;
      broadcastControl(tab);
    });
    // Popups become tabs and keep `window.opener`, so sign-in popups can report back.
    page.on("popup", (popup) => void adoptPopup(tab, popup));
    // Playwright cannot reload a crashed page, so it must leave the tab list.
    const key = tabKey(tab.threadId, tab.tabId);
    if (closedPendingTabs.delete(key)) {
      await control.close().catch(constVoid);
      await page.close().catch(constVoid);
      if (isolatedContext) await context.close().catch(constVoid);
      throw new ServerBrowserTabNotFoundError({ threadId: tab.threadId, tabId: tab.tabId });
    }
    page.on("close", () => dropTab(tab, true));
    page.on("crash", () => dropTab(tab, true));
    tabs.set(key, tab);
    reportLiveTabs();
    // A popup is already loading its own URL.
    if (!adopted && snapshot.navStatus._tag === "Loading") {
      tab.initialNavigation = page
        .goto(snapshot.navStatus.url, { waitUntil: "commit", timeout: NAVIGATION_TIMEOUT_MS })
        .then(constVoid);
      // Background creation keeps the failed tab; automation awaits the original error.
      void tab.initialNavigation.catch(constVoid);
    }
    return tab;
  };

  const adoptPopup = async (opener: ServerTab, popup: Page) => {
    if (opener.closing) {
      await popup.close().catch(constVoid);
      return;
    }
    const url = popup.url();
    await Effect.runPromise(
      manager.open({
        threadId: opener.threadId,
        ...(/^https?:/i.test(url) ? { url } : {}),
        runtime: "server",
        ...(opener.profileId === undefined ? {} : { profileId: opener.profileId }),
        // Agent popups stay with the agent and only float when it asks, like its own opens.
        ...(opener.control.agentId === null
          ? {}
          : { automationOwner: opener.control.agentId, reveal: false }),
        beforePublish: (snapshot) =>
          adoptedPages.set(tabKey(snapshot.threadId, snapshot.tabId), {
            page: popup,
            openerTabId: opener.tabId,
          }),
      }),
    ).catch(async () => {
      await popup.close().catch(constVoid);
    });
  };

  const ensureTab = (snapshot: PreviewSessionSnapshot): Promise<ServerTab> => {
    const key = tabKey(snapshot.threadId, snapshot.tabId);
    const pending = pendingTabs.get(key);
    if (pending) return pending;
    const existing = tabs.get(key);
    if (existing) return Promise.resolve(existing);
    const opening = createTab(snapshot)
      .catch((cause: unknown) => {
        runFork(Effect.logWarning("server preview tab failed to start", { cause }));
        throw cause;
      })
      .finally(() => {
        pendingTabs.delete(key);
        closedPendingTabs.delete(key);
      });
    pendingTabs.set(key, opening);
    return opening;
  };

  const findTab = (threadId: string, tabId: string) =>
    Effect.gen(function* () {
      const existing = tabs.get(tabKey(threadId, tabId));
      if (existing) return existing;
      const { sessions } = yield* manager.list({ threadId: ThreadId.make(threadId) });
      const snapshot = sessions.find(
        (session) => session.tabId === tabId && session.runtime === "server",
      );
      if (!snapshot) return yield* new ServerBrowserTabNotFoundError({ threadId, tabId });
      return yield* Effect.tryPromise({
        try: () => ensureTab(snapshot),
        catch: (cause) => (isTabNotFound(cause) ? cause : new ServerBrowserLaunchError({ cause })),
      });
    });

  const latestThreadTab = (threadId: string, agentSessionId?: string) =>
    [...tabs.values()]
      .filter((tab) => tab.threadId === threadId && tab.control.agentId === agentSessionId)
      .sort((left, right) => right.createdAt - left.createdAt)[0];

  const statusWithTitle = async (
    tab: ServerTab | undefined,
    agentSessionId?: string,
  ): Promise<PreviewAutomationStatus> => {
    if (!tab) {
      return {
        available: false,
        visible: false,
        tabId: null,
        url: null,
        title: null,
        loading: false,
      };
    }
    const url = tab.page.url();
    const viewport = tab.page.viewportSize();
    const status = {
      available: true,
      visible: tab.viewers.size > 0,
      tabId: tab.tabId,
      url: url === "about:blank" ? null : url,
      title: null,
      loading: tab.loading,
      control: {
        owner:
          tab.control.controller !== null
            ? ("human" as const)
            : tab.control.agentId !== null
              ? ("agent" as const)
              : ("unclaimed" as const),
        ownedByCaller: tab.control.agentId === agentSessionId,
        generation: tab.control.generation,
      },
      dialog: dialogStatus(tab),
      viewportSetting: tab.setting,
      ...(viewport ? { viewport } : {}),
      tabs: [...tabs.values()]
        .filter(
          (candidate) =>
            candidate.threadId === tab.threadId && candidate.control.agentId === agentSessionId,
        )
        .map((candidate) => ({
          tabId: candidate.tabId,
          url: candidate.page.url() === "about:blank" ? null : candidate.page.url(),
          ...(candidate.openerTabId === undefined ? {} : { openerTabId: candidate.openerTabId }),
        })),
    };
    if (status.url === null || tab.dialog) return status;
    return { ...status, title: (await tab.page.title().catch(() => "")) || null };
  };

  const resolveNavigationUrl = (input: PreviewAutomationNavigateInput) => {
    if (input.url !== undefined) return normalizePreviewUrl(input.url);
    const target = input.target!;
    if (target.kind === "url") return normalizePreviewUrl(target.url);
    // The browser runs inside the environment, so its ports are loopback.
    const path = target.path ?? "";
    return `${target.protocol ?? "http"}://localhost:${target.port}${path.startsWith("/") || path === "" ? path : `/${path}`}`;
  };

  const navigate = async (
    tab: ServerTab,
    url: string,
    readiness: "load" | "domContentLoaded" | "none",
    timeout: number,
  ) => {
    const navigation = tab.page.goto(url, {
      timeout,
      waitUntil:
        readiness === "domContentLoaded"
          ? "domcontentloaded"
          : readiness === "none"
            ? "commit"
            : "load",
    });
    if (readiness === "none") {
      tab.control.track(navigation);
      return;
    }
    await navigation.catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/ERR_[A-Z_]+/.test(message)) {
        throw new ServerBrowserPage.ServerBrowserOperationError(
          "PreviewAutomationExecutionError",
          `Navigation to ${url} failed: ${ServerBrowserPage.parseNetError(message).description}`,
        );
      }
      throw cause;
    });
  };

  const withCaptureLock = <A>(tab: ServerTab, operation: () => Promise<A>): Promise<A> => {
    const run = tab.captureLock.then(() => {
      if (tab.closing) throw new Error("The preview tab closed.");
      return operation();
    });
    tab.captureLock = run.then(constVoid, constVoid);
    return run;
  };

  const startRecording = (tab: ServerTab): Promise<Recording> => {
    const started = withCaptureLock(tab, async () => {
      if (tab.recording) return tab.recording;
      const encoder = await tab.page.context().newPage();
      let session: CDPSession | null = null;
      try {
        await encoder.evaluate(ServerBrowserPage.RECORDING_ENCODER_SCRIPT);
        // Seed idle pages before returning so an immediate stop has a frame to encode.
        const firstFrame = await ServerBrowserPage.captureViewport(tab.page, tab.cdp, {
          format: "jpeg",
          quality: RECORDING_SCREENCAST.quality,
          scale: 1,
        });
        await encoder.evaluate(
          ([data, width]) =>
            (globalThis as unknown as EncoderWindow).__t3Recorder.frame(data, width),
          [firstFrame, tab.page.viewportSize()?.width ?? UNATTACHED_FILL_VIEWPORT.width] as const,
        );
        const opened = await tab.page.context().newCDPSession(tab.page);
        session = opened;
        const framesInFlight = new Set<Promise<void>>();
        opened.on("Page.screencastFrame", (frame) => {
          const cssWidth = tab.page.viewportSize()?.width ?? frame.metadata.deviceWidth;
          const delivered: Promise<void> = encoder
            .evaluate(
              ([data, width]) =>
                (globalThis as unknown as EncoderWindow).__t3Recorder.frame(data, width),
              [frame.data, cssWidth] as const,
            )
            .then(async (accepted) => {
              if (!accepted) await opened.send("Page.stopScreencast");
            })
            .catch(constVoid)
            .finally(() => {
              framesInFlight.delete(delivered);
              void opened
                .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
                .catch(constVoid);
            });
          framesInFlight.add(delivered);
        });
        await opened.send("Page.startScreencast", RECORDING_SCREENCAST);
        if (tab.closing) throw new Error("The tab closed while the recording started.");
        const recording: Recording = {
          encoder,
          session: opened,
          startedAt: new Date().toISOString(),
          framesInFlight,
        };
        tab.recording = recording;
        return recording;
      } catch (cause) {
        // A start that fails partway must not leave its encoder page behind.
        await encoder.close().catch(constVoid);
        await session?.detach().catch(constVoid);
        throw cause;
      }
    }).finally(() => {
      if (tab.recordingStart === started) tab.recordingStart = null;
    });
    tab.recordingStart = started;
    return started;
  };

  // Scaled captures repaint every screencast; pause them to avoid leaking that frame.
  const withScreencastsPaused = <A>(tab: ServerTab, capture: () => Promise<A>): Promise<A> =>
    withCaptureLock(tab, async () => {
      tab.capturing += 1;
      const recording = tab.recording;
      try {
        await Promise.all([
          ...[...tab.viewers].map((viewer) => viewer.pause()),
          recording?.session.send("Page.stopScreencast").catch(constVoid),
        ]);
        return await capture();
      } finally {
        tab.capturing -= 1;
        // Viewers that attached during the capture start here too.
        await Promise.all([
          ...[...tab.viewers].map((viewer) => viewer.resume()),
          recording && tab.recording === recording
            ? recording.session.send("Page.startScreencast", RECORDING_SCREENCAST).catch(constVoid)
            : undefined,
        ]);
      }
    });

  const stopRecording = (tab: ServerTab) =>
    withCaptureLock(tab, async () => {
      const recording = tab.recording;
      if (!recording) {
        throw new ServerBrowserPage.ServerBrowserOperationError(
          "PreviewAutomationRecordingNotActiveError",
          "No recording is active for this tab.",
        );
      }
      let mimeType: string | null;
      const chunks: Array<Buffer> = [];
      try {
        await recording.session.send("Page.stopScreencast").catch(constVoid);
        // The last frames may still be on their way into the encoder.
        await Promise.all(recording.framesInFlight);
        await recording.session.detach().catch(constVoid);
        const stopped = await recording.encoder.evaluate(() =>
          (globalThis as unknown as EncoderWindow).__t3Recorder.stop(),
        );
        mimeType = stopped.mimeType;
        // Checked before the transfer so an oversized video never lands in this process.
        if (stopped.bytes > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
          throw new ServerBrowserPage.ServerBrowserOperationError(
            "PreviewAutomationRecordingTooLargeError",
            "The recording is larger than the attachment limit.",
          );
        }
        for (let index = 0; index < stopped.count; index += 1) {
          const chunk = await recording.encoder.evaluate(
            (chunkIndex) => (globalThis as unknown as EncoderWindow).__t3Recorder.chunk(chunkIndex),
            index,
          );
          chunks.push(Buffer.from(chunk, "base64"));
        }
      } finally {
        await recording.encoder.close().catch(constVoid);
        tab.recording = null;
      }
      const data = Buffer.concat(chunks);
      if (!mimeType || data.byteLength === 0) {
        throw new ServerBrowserPage.ServerBrowserOperationError(
          "PreviewAutomationExecutionError",
          "The recording captured no frames.",
        );
      }
      // Use the desktop upload location so the MCP handler can claim the recording.
      const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const pendingId = `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${NodeCrypto.randomUUID()}-${extension}`;
      const path = NodePath.join(config.attachmentsDir, `${pendingId}.${extension}`);
      await NodeFSP.mkdir(config.attachmentsDir, { recursive: true });
      await NodeFSP.writeFile(path, data);
      return {
        id: pendingId,
        tabId: tab.tabId,
        path,
        mimeType: mimeType.split(";")[0]!,
        sizeBytes: data.byteLength,
        createdAt: new Date().toISOString(),
        uploadedAttachmentId: pendingId,
      };
    });

  const recordAction = <A>(tab: ServerTab, action: string, run: () => Promise<A>): Promise<A> => {
    const event: {
      -readonly [K in keyof PreviewAutomationActionEvent]: PreviewAutomationActionEvent[K];
    } = {
      id: NodeCrypto.randomUUID(),
      action,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    pushBounded(tab.actionTimeline, event, ACTION_TIMELINE_LIMIT);
    return run().then(
      (result) => {
        event.status = "succeeded";
        event.completedAt = new Date().toISOString();
        return result;
      },
      (cause: unknown) => {
        event.status = "failed";
        event.completedAt = new Date().toISOString();
        event.error = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
        throw cause;
      },
    );
  };

  const requireTab = async (request: PreviewAutomationRequest) => {
    if (!request.agentSessionId)
      throw new BrowserControlInterrupted("The agent session is missing. Reconnect the provider.");
    const owned = [...tabs.values()].filter(
      (tab) => tab.threadId === request.threadId && tab.control.agentId === request.agentSessionId,
    );
    if (!request.tabIdExplicit && owned.length > 1)
      throw new BrowserControlInterrupted(
        "Multiple tabs belong to this agent session. Pass a tabId from preview_open or preview_status tabs.",
        "tabRequired",
      );
    const tab =
      request.tabId === undefined
        ? latestThreadTab(request.threadId, request.agentSessionId)
        : await Effect.runPromise(
            findTab(request.threadId, request.tabId).pipe(Effect.orElseSucceed(constVoid)),
          );
    if (!tab) {
      throw new ServerBrowserPage.ServerBrowserOperationError(
        "PreviewAutomationTabNotFoundError",
        "No server preview tab is open for this thread. Call preview_open first.",
      );
    }
    if (tab.control.agentId !== request.agentSessionId)
      throw new BrowserControlInterrupted(
        "This tab belongs to another agent session or a human. Open your own tab.",
        "agentMismatch",
      );
    return tab;
  };

  const runOperation = async (request: PreviewAutomationRequest): Promise<unknown> => {
    const input = request.input;
    switch (request.operation) {
      case "status":
        return statusWithTitle(
          request.tabId === undefined
            ? latestThreadTab(request.threadId, request.agentSessionId)
            : tabs.get(tabKey(request.threadId, request.tabId)),
          request.agentSessionId,
        );
      case "open": {
        if (!request.agentSessionId)
          throw new BrowserControlInterrupted(
            "The agent session is missing. Reconnect the provider.",
          );
        const open = input as PreviewAutomationOpenInput;
        const url = open.url === undefined ? undefined : normalizePreviewUrl(open.url);
        const reuse = open.reuseExistingTab ?? true;
        if (
          reuse &&
          !request.tabIdExplicit &&
          [...tabs.values()].filter(
            (tab) =>
              tab.threadId === request.threadId && tab.control.agentId === request.agentSessionId,
          ).length > 1
        )
          throw new BrowserControlInterrupted(
            "Multiple tabs are open. Pass tabId or reuseExistingTab=false.",
            "tabRequired",
          );
        // A tab still launching exists only as a session, so resolve it like a viewer would.
        const existing =
          reuse && request.tabId !== undefined
            ? await Effect.runPromise(
                findTab(request.threadId, request.tabId).pipe(
                  Effect.catchTag("ServerBrowserTabNotFoundError", () => Effect.succeed(undefined)),
                ),
              )
            : undefined;
        const navigationTimeout = Math.min(request.timeoutMs, NAVIGATION_TIMEOUT_MS);
        const tab =
          existing ??
          (await ensureTab(
            await Effect.runPromise(
              manager.open({
                threadId: request.threadId,
                ...(url ? { url } : {}),
                runtime: "server",
                reveal: false,
                automationOwner: request.agentSessionId,
              }),
            ),
          ));
        if (existing?.dialog)
          throw new BrowserControlInterrupted(
            "A browser dialog is pending. Read preview_status and use preview_dialog first.",
            "dialogPending",
          );
        return tab.control.agent(request.agentSessionId, async () => {
          if (tab.dialog)
            throw new BrowserControlInterrupted(
              "A browser dialog is pending. Read preview_status and use preview_dialog first.",
              "dialogPending",
            );
          if (existing) {
            if (url) await navigate(tab, url, "load", navigationTimeout);
          } else {
            // Await the original navigation failure even though background creation keeps the tab.
            await tab.initialNavigation;
          }
          const reveal = open.open ?? open.show;
          if (reveal !== false) {
            await Effect.runPromise(
              manager.requestReveal({
                threadId: tab.threadId,
                tabId: tab.tabId,
                force: reveal === true,
              }),
            );
          }
          if (!existing && url) {
            await tab.page
              .waitForLoadState("load", { timeout: navigationTimeout })
              .catch(constVoid);
          }
          return statusWithTitle(tab, request.agentSessionId);
        });
      }
      case "recordingStop": {
        if (
          !request.tabIdExplicit &&
          [...tabs.values()].filter(
            (candidate) =>
              candidate.threadId === request.threadId &&
              candidate.control.agentId === request.agentSessionId,
          ).length > 1
        )
          throw new BrowserControlInterrupted(
            "Multiple tabs belong to this agent session. Pass a tabId from preview_open or preview_status tabs.",
            "tabRequired",
          );
        const recordings = [...tabs.values()].filter(
          (candidate) =>
            candidate.threadId === request.threadId &&
            candidate.control.agentId === request.agentSessionId &&
            (candidate.recording || candidate.recordingStart),
        );
        const targetTabId =
          request.tabId ?? latestThreadTab(request.threadId, request.agentSessionId)?.tabId;
        const tab =
          recordings.find((candidate) => candidate.tabId === targetTabId) ??
          (!request.tabIdExplicit && recordings.length === 1 ? recordings[0] : undefined);
        if (!tab) {
          throw new ServerBrowserPage.ServerBrowserOperationError(
            "PreviewAutomationRecordingNotActiveError",
            "No recording is active for this thread.",
          );
        }
        return tab.control.agent(request.agentSessionId ?? "", () => stopRecording(tab));
      }
    }
    const tab = await requireTab(request);
    // Closing must unblock an action waiting on a dialog, without queueing behind it.
    if (request.operation === "close") {
      if (tab.control.controller !== null)
        throw new BrowserControlInterrupted("A human controls this tab.", "humanControl");
      void tab.control.close().catch(constVoid);
      await Effect.runPromise(manager.close({ threadId: tab.threadId, tabId: tab.tabId }));
      dropTab(tab, false);
      return {};
    }
    // A click can be waiting for its dialog. Resolve it outside the serial queue,
    // with the same owner check, so the operation can finish and control can drain.
    if (request.operation === "dialog") {
      if (tab.control.controller !== null)
        throw new BrowserControlInterrupted("A human controls this tab.", "humanControl");
      await resolveDialog(tab, input as PreviewAutomationDialogInput);
      return statusWithTitle(tab, request.agentSessionId);
    }
    return tab.control.agent(request.agentSessionId!, async () => {
      if (tab.dialog)
        throw new BrowserControlInterrupted(
          "A browser dialog is pending. Read preview_status and use preview_dialog first.",
          "dialogPending",
        );
      const generation = tab.control.generation;
      try {
        return await executeTabOperation(tab, request);
      } finally {
        if (generation !== tab.control.generation) ServerBrowserPage.invalidateRefs(tab.page);
      }
    });
  };

  const executeTabOperation = async (tab: ServerTab, request: PreviewAutomationRequest) => {
    const input = request.input;
    switch (request.operation) {
      case "navigate": {
        const navigateInput = input as PreviewAutomationNavigateInput;
        await recordAction(tab, "navigate", () =>
          navigate(
            tab,
            resolveNavigationUrl(navigateInput),
            navigateInput.readiness ?? "load",
            navigateInput.timeoutMs ?? request.timeoutMs,
          ),
        );
        return statusWithTitle(tab, request.agentSessionId);
      }
      case "resize": {
        const setting = resolvePreviewViewport(input as PreviewAutomationResizeInput);
        await Effect.runPromise(
          manager.resize({
            threadId: tab.threadId,
            tabId: tab.tabId,
            viewport: setting,
            serverControlled: true,
          }),
        );
        await applySetting(tab, setting);
        return {
          tabId: tab.tabId,
          setting,
          viewport: tab.page.viewportSize() ?? UNATTACHED_FILL_VIEWPORT,
        };
      }
      case "setColorScheme": {
        const { colorScheme } = input as PreviewAutomationSetColorSchemeInput;
        await tab.page.emulateMedia({ colorScheme: colorScheme === "system" ? null : colorScheme });
        return { tabId: tab.tabId, colorScheme };
      }
      case "snapshot": {
        return withScreencastsPaused(tab, () =>
          ServerBrowserPage.snapshot({ ...tab, renderScale: RENDER_SCALE }),
        );
      }
      case "click": {
        const clickInput = input as PreviewAutomationClickInput;
        const point = await recordAction(tab, "click", () =>
          ServerBrowserPage.click(tab.page, clickInput),
        );
        void tab.recording?.encoder
          .evaluate(
            ([x, y]) => (globalThis as unknown as EncoderWindow).__t3Recorder?.cursor(x, y, true),
            [point.x, point.y] as const,
          )
          .catch(constVoid);
        return undefined;
      }
      case "type":
        return recordAction(tab, "type", () =>
          ServerBrowserPage.type(tab.page, input as PreviewAutomationTypeInput),
        );
      case "press":
        return recordAction(tab, "press", () =>
          ServerBrowserPage.press(tab.page, input as PreviewAutomationPressInput),
        );
      case "scroll":
        return recordAction(tab, "scroll", () =>
          ServerBrowserPage.scroll(tab.page, input as PreviewAutomationScrollInput),
        );
      case "evaluate":
        return ServerBrowserPage.evaluate(tab.cdp, input as PreviewAutomationEvaluateInput);
      case "waitFor":
        return ServerBrowserPage.waitFor(tab.page, input as PreviewAutomationWaitForInput);
      case "recordingStart": {
        const recording = await startRecording(tab);
        return { tabId: tab.tabId, recording: true, startedAt: recording.startedAt };
      }
    }
  };

  const handleRequest = (connectionId: string, request: PreviewAutomationRequest) =>
    Effect.tryPromise({
      try: () => runOperation(request),
      catch: ServerBrowserPage.toOperationError,
    }).pipe(
      Effect.match({
        onSuccess: (result) => ({ ok: true as const, result }),
        onFailure: (error) => ({
          ok: false as const,
          error: {
            _tag: error.tag,
            message: error.message,
            ...(error.detail === undefined ? {} : { detail: error.detail }),
          },
        }),
      }),
      Effect.flatMap((outcome) =>
        broker.respond({
          clientId: SERVER_HOST_CLIENT_ID,
          connectionId,
          requestId: request.requestId,
          ...outcome,
        }),
      ),
      Effect.ignore,
    );

  const mirrorManagerEvent = (event: PreviewEvent) =>
    Effect.promise(async () => {
      if (event.type === "opened" && event.snapshot.runtime === "server") {
        await ensureTab(event.snapshot).catch(constVoid);
        return;
      }
      const key = tabKey(event.threadId, event.tabId);
      const tab = tabs.get(key);
      if (event.type === "closed" && !tab && pendingTabs.has(key)) closedPendingTabs.add(key);
      if (!tab) return;
      if (event.type === "closed") {
        dropTab(tab, false);
      }
    });

  const releaseViewerInput = async (viewer: ViewerState, session: CDPSession) => {
    for (const { key, code } of viewer.pressedKeys.values()) {
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, code }).catch(constVoid);
    }
    viewer.pressedKeys.clear();
    for (const [button, point] of viewer.pressedButtons) {
      await session
        .send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          button,
          ...point,
          buttons: 0,
          clickCount: 1,
        })
        .catch(constVoid);
    }
    viewer.pressedButtons.clear();
    viewer.requestedSize = null;
  };

  const dispatchViewerInput = async (
    tab: ServerTab,
    session: CDPSession,
    viewer: ViewerState,
    raw: unknown,
  ) => {
    const message = asRecord(raw);
    if (!message) return;
    const modifiers = modifiersOf(message);
    switch (message.type) {
      case "mouse": {
        const action = message.action;
        const type =
          action === "down" ? "mousePressed" : action === "up" ? "mouseReleased" : "mouseMoved";
        const button = ["none", "left", "middle", "right"].includes(String(message.button))
          ? (message.button as "none" | "left" | "middle" | "right")
          : "none";
        await session.send("Input.dispatchMouseEvent", {
          type,
          x: num(message.x),
          y: num(message.y),
          button,
          buttons: num(message.buttons),
          clickCount: num(message.clickCount, type === "mouseMoved" ? 0 : 1),
          modifiers,
        });
        if (button !== "none") {
          if (action === "down")
            viewer.pressedButtons.set(button, { x: num(message.x), y: num(message.y) });
          else if (action === "up") viewer.pressedButtons.delete(button);
        }
        return;
      }
      case "wheel":
        viewer.scrolledAt = Date.now();
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: num(message.x),
          y: num(message.y),
          deltaX: num(message.deltaX),
          deltaY: num(message.deltaY),
          modifiers,
        });
        return;
      case "key": {
        const key = typeof message.key === "string" ? message.key : "";
        const code = typeof message.code === "string" ? message.code : "";
        const text = typeof message.text === "string" ? message.text : undefined;
        if (message.action === "up") {
          await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
          viewer.pressedKeys.delete(code || key);
          return;
        }
        await session.send("Input.dispatchKeyEvent", {
          type: text ? "keyDown" : "rawKeyDown",
          key,
          code,
          modifiers,
          ...(text ? { text, unmodifiedText: text } : {}),
          ...metaEditingCommand(key, modifiers),
          windowsVirtualKeyCode: num(
            message.keyCode,
            key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
          ),
        });
        viewer.pressedKeys.set(code || key, { key, code });
        return;
      }
      case "text":
        if (typeof message.text === "string" && message.text.length > 0) {
          await session.send("Input.insertText", { text: message.text.slice(0, 10_000) });
        }
        return;
      case "resize": {
        const width = Math.min(Math.round(num(message.width)), 3840);
        const height = Math.min(Math.round(num(message.height)), 2160);
        if (width < 100 || height < 100) return;
        viewer.requestedSize = { width, height, order: ++viewerResizeOrder };
        if (tab.setting._tag !== "fill") return;
        const current = tab.page.viewportSize();
        if (current?.width === width && current.height === height) return;
        await tab.page.setViewportSize({ width, height });
        broadcastViewport(tab);
        return;
      }
      case "viewport": {
        const setting = decodeViewportSetting(message.setting);
        await Effect.runPromise(
          manager.resize({
            threadId: tab.threadId,
            tabId: tab.tabId,
            viewport: setting,
            serverControlled: true,
          }),
        );
        await applySetting(tab, setting);
        return;
      }
      case "navigate":
        if (typeof message.url === "string") {
          const url = normalizePreviewUrl(message.url);
          await tab.page.goto(url, VIEWER_NAVIGATION_OPTIONS);
        }
        return;
      case "history":
        await (num(message.delta) < 0
          ? tab.page.goBack(VIEWER_NAVIGATION_OPTIONS)
          : tab.page.goForward(VIEWER_NAVIGATION_OPTIONS));
        return;
      case "reload":
        await tab.page.reload(VIEWER_NAVIGATION_OPTIONS);
        return;
      case "probe": {
        const x = num(message.x);
        const y = num(message.y);
        const result = await session.send("Runtime.evaluate", {
          expression: `(${EDITABLE_AT_POINT_SCRIPT})(${x}, ${y})`,
          returnByValue: true,
        });
        viewer.push({ _tag: "probe", x, y, editable: result.result.value === true });
        return;
      }
    }
  };

  const attachViewer: ServerBrowser["Service"]["attachViewer"] = (input) =>
    Effect.gen(function* () {
      const tab = yield* findTab(input.threadId, input.tabId);
      const output = yield* Queue.make<ServerBrowserViewerOutput>({
        capacity: VIEWER_OUTPUT_LIMIT,
        strategy: "dropping",
      });
      const session = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => tab.page.context().newCDPSession(tab.page),
          catch: (cause) => new ServerBrowserLaunchError({ cause }),
        }),
        (session) =>
          Effect.promise(() =>
            session
              .send("Page.stopScreencast")
              .catch(constVoid)
              .then(() => session.detach())
              .catch(constVoid),
          ),
      );
      const quality = Math.min(100, Math.max(1, Math.round(input.quality)));
      // Chromium may drop the final frame during a burst; send a still when it settles.
      let framesInFlight = 0;
      let mayHaveDropped = false;
      let motion = false;
      const recentFrames: Array<number> = [];
      let screencastParams = Promise.resolve();
      let screencastScale = 1;
      const startScreencast = (scale: number) => {
        screencastScale = scale;
        screencastParams = screencastParams.then(async () => {
          // A scaled capture is rendering; its resume starts the stream.
          if (tab.capturing > 0) return;
          await session.send("Page.stopScreencast").catch(constVoid);
          await session
            .send("Page.startScreencast", {
              format: "jpeg",
              quality: screencastScale < 1 ? Math.min(quality, SCREENCAST_MOTION_QUALITY) : quality,
              maxWidth: Math.max(1, Math.round(input.maxWidth * screencastScale)),
              maxHeight: Math.max(1, Math.round(input.maxHeight * screencastScale)),
            })
            .catch(constVoid);
        });
        return screencastParams;
      };
      const viewer: ViewerState = {
        id: NodeCrypto.randomUUID(),
        canOperate: input.canOperate,
        pressedKeys: new Map(),
        pressedButtons: new Map(),
        push: (next) => {
          // Dropped frames must still release Chromium.
          if (Queue.offerUnsafe(output, next)) return;
          if (next._tag === "frame") runFork(next.ack);
          // The stream only ends on `gone`, so it replaces a stalled backlog.
          else if (next._tag === "gone" || next._tag === "control") {
            runFork(
              Queue.clear(output).pipe(
                Effect.flatMap((dropped) =>
                  Effect.forEach(dropped, (item) =>
                    item._tag === "frame" ? item.ack : Effect.void,
                  ),
                ),
                Effect.andThen(Queue.offer(output, next)),
              ),
            );
          }
        },
        pause: () => {
          screencastParams = screencastParams.then(() =>
            session.send("Page.stopScreencast").then(constVoid, constVoid),
          );
          return screencastParams;
        },
        resume: () => startScreencast(screencastScale),
        scrolledAt: 0,
        requestedSize: null,
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          tab.viewers.add(viewer);
          reportLiveTabs();
        }),
        () =>
          Effect.promise(async () => {
            await tab.control.disconnect(viewer.id, () => releaseViewerInput(viewer, session));
            tab.viewers.delete(viewer);
            broadcastControl(tab);
            reportLiveTabs();
          }),
      );
      if (input.canOperate && tab.control.agentId === null && tab.control.controller === null) {
        yield* Effect.promise(() => tab.control.take(viewer.id));
      }
      broadcastControl(tab);
      // Full scale: a scaled capture would flash in every other viewer.
      const pushStill = async () => {
        const data = await withCaptureLock(tab, () =>
          ServerBrowserPage.captureViewport(tab.page, session, {
            format: "jpeg",
            quality,
            scale: 1,
          }),
        ).catch(() => null);
        if (data)
          viewer.push({ _tag: "frame", data: Buffer.from(data, "base64"), ack: Effect.void });
      };
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (settleTimer !== null) clearTimeout(settleTimer);
        }),
      );
      let screencastStarted = false;
      session.on("Page.screencastFrame", (frame) => {
        screencastStarted = true;
        if (framesInFlight > 0) mayHaveDropped = true;
        framesInFlight += 1;
        const arrivedAt = Date.now();
        recentFrames.push(arrivedAt);
        while (recentFrames[0]! < arrivedAt - SCREENCAST_MOTION_WINDOW_MS) recentFrames.shift();
        if (
          !motion &&
          recentFrames.length >= SCREENCAST_MOTION_FRAMES &&
          arrivedAt - viewer.scrolledAt < SCREENCAST_MOTION_WINDOW_MS
        ) {
          motion = true;
          void startScreencast(0.5);
        } else if (motion && arrivedAt - viewer.scrolledAt > SCREENCAST_SETTLE_MS) {
          // The page keeps animating after the scroll; its own frames are sharp again.
          motion = false;
          recentFrames.length = 0;
          void startScreencast(1);
        }
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!motion && !mayHaveDropped) return;
          mayHaveDropped = false;
          if (motion) {
            motion = false;
            recentFrames.length = 0;
            void startScreencast(1);
          }
          void pushStill();
        }, SCREENCAST_SETTLE_MS);
        viewer.push({
          _tag: "frame",
          data: Buffer.from(frame.data, "base64"),
          ack: Effect.promise(() =>
            sleepUntil(arrivedAt + SCREENCAST_ACK_PACE_MS).then(() => {
              framesInFlight -= 1;
              return session
                .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
                .catch(constVoid);
            }),
          ),
        });
      });
      broadcastViewport(tab);
      yield* Effect.promise(() => startScreencast(1));
      // An idle page does not repaint for a new screencast, so the viewer
      // starts from a still unless a live frame beat it.
      if (!screencastStarted) yield* Effect.promise(pushStill);
      return {
        output,
        input: (raw: unknown) =>
          Effect.promise(async () => {
            if (!viewer.canOperate) return;
            const message = asRecord(raw);
            if (!message) return;
            try {
              if (message.type === "takeControl") {
                const taking = tab.control.take(viewer.id);
                broadcastControl(tab);
                await taking;
              } else if (message.type === "releaseControl") {
                const releasing = tab.control.release(viewer.id, () =>
                  releaseViewerInput(viewer, session),
                );
                broadcastControl(tab);
                await releasing;
              } else if (
                message.type === "dialog" &&
                tab.control.controller === viewer.id &&
                typeof message.accept === "boolean"
              ) {
                await resolveDialog(tab, {
                  accept: message.accept,
                  ...(typeof message.promptText === "string"
                    ? { promptText: message.promptText }
                    : {}),
                });
              } else {
                await tab.control.human(viewer.id, () =>
                  dispatchViewerInput(tab, session, viewer, message),
                );
              }
            } catch {
              // Rejected ownership cannot mutate the page; refresh the viewer's controls.
              broadcastControl(tab);
            }
          }),
      } satisfies ServerBrowserViewer;
    });

  if (enabled) {
    yield* manager.events.pipe(Stream.runForEach(mirrorManagerEvent), Effect.forkScoped);
    const environmentId = yield* environment.getEnvironmentId;
    const hostSession = broker
      .connect(
        {
          clientId: SERVER_HOST_CLIENT_ID,
          environmentId,
          supportedOperations: [...PREVIEW_AUTOMATION_SERVER_OPERATIONS],
        },
        { preferred: true },
      )
      .pipe(
        Effect.flatMap((events) =>
          events.pipe(
            Stream.runForEach((event) => {
              if (event.type === "connected") {
                hostConnectionId = event.connectionId;
                return Effect.sync(reportLiveTabs);
              }
              return handleRequest(event.connectionId, event.request).pipe(
                Effect.forkScoped,
                Effect.asVoid,
              );
            }),
          ),
        ),
      );
    // The broker disconnects timed-out hosts, including slow first installs. Reconnect.
    yield* hostSession.pipe(
      Effect.exit,
      Effect.andThen(Effect.sleep(HOST_RECONNECT_DELAY)),
      Effect.forever,
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await contexts.close();
      }),
    );
  }

  const clearProfile = (profileId: string) =>
    Effect.tryPromise({
      try: () => contexts.clearProfile(profileId),
      catch: (cause) => new PreviewClearProfileError({ profileId, cause }),
    });

  return ServerBrowser.of({ enabled, attachViewer, clearProfile });
});

export const layer = Layer.effect(ServerBrowser, make);
