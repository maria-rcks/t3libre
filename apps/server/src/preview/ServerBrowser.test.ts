import * as NodeEvents from "node:events";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Broker from "../mcp/PreviewAutomationBroker.ts";
import * as Manager from "./Manager.ts";
import * as ServerBrowser from "./ServerBrowser.ts";
import * as Toolchain from "./ServerBrowserToolchain.ts";

// Keep the manager, broker, ownership, refs, and viewer paths real; replace Chromium I/O only.
vi.mock("./ServerBrowserContexts.ts", () => ({
  ServerBrowserContexts: class {
    private readonly onClose: ((context: BrowserContext) => void) | undefined;
    constructor(options: { onContextClose?: (context: BrowserContext) => void }) {
      this.onClose = options.onContextClose;
    }
    async contextFor() {
      if (contextFailure) throw contextFailure;
      await contextGate?.promise;
      const context = makeContext(this.onClose);
      contexts.push(context);
      return context as unknown as BrowserContext;
    }
    async close() {
      for (const context of contexts) await context.close();
    }
  },
}));

function makeSession() {
  return {
    on: vi.fn(),
    detach: vi.fn(async () => {}),
    send: vi.fn(async (method: string, _input?: unknown): Promise<Record<string, unknown>> => {
      if (method === "Page.getNavigationHistory") return { currentIndex: 0, entries: [{}] };
      if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { pageX: 0, pageY: 0 } };
      if (method === "Page.captureScreenshot") return { data: "ZnJhbWU=" };
      return { result: { value: "evaluated" } };
    }),
  };
}

function makeContext(onClose?: (context: BrowserContext) => void) {
  const events = new NodeEvents.EventEmitter();
  const sessions: ReturnType<typeof makeSession>[] = [];
  let url = "about:blank";
  let viewport = { width: 1280, height: 800 };
  let closed = false;
  let contextClosed = false;
  const page = {
    on: (name: string, callback: (...args: unknown[]) => void) => events.on(name, callback),
    emit: (name: string, ...args: unknown[]) => events.emit(name, ...args),
    emitAsync: (name: string, ...args: unknown[]) =>
      Promise.all(events.listeners(name).map((listener) => listener(...args))),
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    context: () => context,
    mainFrame: () => page,
    url: () => url,
    title: vi.fn(async () => "test page"),
    viewportSize: () => viewport,
    setViewportSize: vi.fn(async (size: typeof viewport) => {
      viewport = size;
    }),
    goto: vi.fn(async (next: string) => {
      url = next;
      events.emit("load");
    }),
    goBack: vi.fn(async () => {}),
    goForward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}),
    evaluate: vi.fn(async () => ({
      url,
      title: "test page",
      loading: false,
      visibleText: "delete",
      interactiveElements: [],
    })),
    ariaSnapshot: vi.fn(async () => '- button "delete" [ref=e1]'),
    locator: vi.fn(() => {
      throw new Error("Unexpected locator action");
    }),
    isClosed: () => closed,
    close: vi.fn(async () => {
      if (!closed) {
        closed = true;
        events.emit("close");
      }
    }),
  };
  const context = {
    page,
    sessions,
    newPage: async () => page as unknown as Page,
    grantPermissions: vi.fn(async () => {}),
    exposeBinding: vi.fn(async (_name: string, binding: ClipboardBinding) => {
      clipboardBinding = binding;
    }),
    addInitScript: vi.fn(async () => {}),
    newCDPSession: async () => {
      const session = makeSession();
      sessions.push(session);
      return session;
    },
    close: vi.fn(async () => {
      if (contextClosed) return;
      contextClosed = true;
      await page.close();
      onClose?.(context as unknown as BrowserContext);
    }),
  };
  return context;
}

const contexts: ReturnType<typeof makeContext>[] = [];
let contextGate: PromiseWithResolvers<void> | null = null;
type ClipboardBinding = (source: { page: unknown }, text: unknown) => void;
let clipboardBinding: ClipboardBinding | null = null;
let contextFailure: Error | null = null;
const scope = {
  environmentId: EnvironmentId.make("browser-test-environment"),
  threadId: ThreadId.make("browser-test-thread"),
  providerSessionId: "agent-a",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};
const dependencies = Layer.mergeAll(
  Broker.layer,
  Manager.layer,
  Layer.succeed(ServerEnvironment.ServerEnvironment, {
    getEnvironmentId: Effect.succeed(scope.environmentId),
    getDescriptor: Effect.die("unused descriptor"),
  }),
  Layer.succeed(Toolchain.ServerBrowserToolchain, {
    resolve: Effect.die("mock Chromium does not need an executable"),
  }),
).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-server-browser-" })),
  Layer.provideMerge(NodeServices.layer),
);
const layer = ServerBrowser.layer.pipe(Layer.provideMerge(dependencies));
const ready = Effect.gen(function* () {
  const browser = yield* ServerBrowser.ServerBrowser;
  const broker = yield* Broker.PreviewAutomationBroker;
  yield* Effect.yieldNow;
  const opened = yield* broker.invoke<PreviewAutomationStatus>({
    scope,
    operation: "open",
    input: { reuseExistingTab: false, show: false },
  });
  const tabId = PreviewTabId.make(opened.tabId!);
  return { browser, broker, tabId };
});
const viewerInput = (tabId: string, canOperate: boolean) => ({
  threadId: scope.threadId,
  tabId,
  canOperate,
  maxWidth: 1280,
  maxHeight: 800,
  quality: 70,
});

beforeEach(() => {
  contexts.length = 0;
  contextGate = null;
  contextFailure = null;
  vi.stubEnv("T3CODE_SERVER_BROWSER", "1");
});
afterEach(() => vi.unstubAllEnvs());

it.live("readiness none responds immediately but takeover input waits for navigation commit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { browser, broker, tabId } = yield* ready;
      const viewer = yield* browser.attachViewer(viewerInput(tabId, true));
      const committed = Promise.withResolvers<void>();
      const events: string[] = [];
      contexts[0]!.page.goto.mockImplementationOnce(async () => {
        await committed.promise;
        events.push("navigation committed");
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => committed.resolve()));
      const response = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        tabId,
        operation: "navigate",
        input: { url: "http://localhost:5173/next", readiness: "none" },
      });
      expect(response.available).toBe(true);
      expect(events).toEqual([]);
      yield* Queue.clear(viewer.output);
      const takeover = yield* viewer.input({ type: "takeControl" }).pipe(Effect.forkScoped);
      let control = yield* Queue.take(viewer.output);
      while (control._tag !== "control" || control.controller !== "you") {
        control = yield* Queue.take(viewer.output);
      }
      const cdp = contexts[0]!.sessions.at(-1)!;
      const send = cdp.send.getMockImplementation()!;
      cdp.send.mockImplementation(async (operation, input) => {
        if (operation === "Input.insertText") events.push("human typed");
        return send(operation, input);
      });
      const typing = yield* viewer.input({ type: "text", text: "hello" }).pipe(Effect.forkScoped);
      yield* broker.invoke({ scope, tabId, operation: "status", input: {} });
      expect(events).toEqual([]);
      committed.resolve();
      yield* Fiber.join(takeover);
      yield* Fiber.join(typing);
      expect(events).toEqual(["navigation committed", "human typed"]);
    }),
  ).pipe(Effect.provide(layer)),
);

it.live.each([
  { method: "goto" as const, message: { type: "navigate", url: "http://localhost:5173/next" } },
  { method: "goBack" as const, message: { type: "history", delta: -1 } },
  { method: "goForward" as const, message: { type: "history", delta: 1 } },
  { method: "reload" as const, message: { type: "reload" } },
])("release waits for viewer $method to commit before agent actions", ({ method, message }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { browser, broker, tabId } = yield* ready;
      const viewer = yield* browser.attachViewer(viewerInput(tabId, true));
      yield* viewer.input({ type: "takeControl" });
      yield* Queue.clear(viewer.output);
      const started = Promise.withResolvers<void>();
      const committed = Promise.withResolvers<void>();
      const events: string[] = [];
      contexts[0]!.page[method].mockImplementationOnce(async () => {
        started.resolve();
        await committed.promise;
        events.push("navigation committed");
      });
      const navigate = yield* viewer.input(message).pipe(Effect.forkScoped);
      yield* Effect.addFinalizer(() => Effect.sync(() => committed.resolve()));
      yield* Effect.promise(() => started.promise);
      const releasing = yield* viewer.input({ type: "releaseControl" }).pipe(Effect.forkScoped);
      let control = yield* Queue.take(viewer.output);
      while (control._tag !== "control" || control.controller !== "agent") {
        control = yield* Queue.take(viewer.output);
      }
      const cdp = contexts[0]!.sessions[0]!;
      const send = cdp.send.getMockImplementation()!;
      cdp.send.mockImplementation(async (operation, input) => {
        if (operation === "Runtime.evaluate") events.push("agent acted");
        return send(operation, input);
      });
      const resumed = yield* broker
        .invoke({
          scope,
          tabId,
          operation: "evaluate",
          input: { expression: "resumed()" },
        })
        .pipe(Effect.forkScoped);
      yield* broker.invoke({ scope, tabId, operation: "status", input: {} });
      expect(events).toEqual([]);
      committed.resolve();
      yield* Fiber.join(navigate);
      yield* Fiber.join(releasing);
      yield* Fiber.join(resumed);
      expect(events).toEqual(["navigation committed", "agent acted"]);
      const calls = contexts[0]!.page[method].mock.calls;
      expect(calls[0]?.at(-1)).toMatchObject({ waitUntil: "commit", timeout: 15_000 });
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("enforces provider ownership and explicit targets when a session has multiple tabs", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { broker, tabId } = yield* ready;
      const foreign = yield* broker
        .invoke<void>({
          scope: { ...scope, providerSessionId: "agent-b" },
          tabId,
          operation: "evaluate",
          input: { expression: "foreign()" },
        })
        .pipe(Effect.flip);
      expect(foreign).toMatchObject({
        _tag: "PreviewAutomationControlInterruptedError",
        reason: "agentMismatch",
      });
      expect(contexts[0]!.sessions[0]!.send).not.toHaveBeenCalledWith(
        "Runtime.evaluate",
        expect.anything(),
      );
      yield* broker.invoke({
        scope,
        operation: "open",
        input: { reuseExistingTab: false, show: false },
      });
      const ambiguous = yield* broker
        .invoke<void>({ scope, operation: "evaluate", input: { expression: "ambiguous()" } })
        .pipe(Effect.flip);
      expect(ambiguous).toMatchObject({
        _tag: "PreviewAutomationControlInterruptedError",
        reason: "tabRequired",
      });
      const ambiguousStop = yield* broker
        .invoke<void>({ scope, operation: "recordingStop", input: {} })
        .pipe(Effect.flip);
      expect(ambiguousStop).toMatchObject({
        _tag: "PreviewAutomationControlInterruptedError",
        reason: "tabRequired",
      });
      const explicitStop = yield* broker
        .invoke<void>({ scope, tabId, operation: "recordingStop", input: {} })
        .pipe(Effect.flip);
      expect(explicitStop).toMatchObject({
        _tag: "PreviewAutomationExecutionError",
        cause: { _tag: "PreviewAutomationRecordingNotActiveError" },
      });
      const result = yield* broker.invoke({
        scope,
        tabId,
        operation: "evaluate",
        input: { expression: "owned()" },
      });
      expect(result).toBe("evaluated");
      expect(contexts).toHaveLength(2);
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("streams to a read-only viewer without allowing takeover, input, or viewport changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { browser, tabId } = yield* ready;
      const viewer = yield* browser.attachViewer(viewerInput(tabId, false));
      const page = contexts[0]!.page;
      page.setViewportSize.mockClear();
      const session = contexts[0]!.sessions.at(-1)!;
      session.send.mockClear();
      for (const message of [
        { type: "takeControl" },
        { type: "key", action: "down", key: "a", text: "a" },
        { type: "resize", width: 390, height: 844 },
        { type: "viewport", setting: { _tag: "freeform", width: 390, height: 844 } },
      ])
        yield* viewer.input(message);
      expect(page.setViewportSize).not.toHaveBeenCalled();
      expect(session.send.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
      const outputs = yield* Queue.takeAll(viewer.output);
      expect(outputs).toContainEqual(
        expect.objectContaining({ _tag: "frame", data: Buffer.from("frame") }),
      );
      expect(outputs).toContainEqual(expect.objectContaining({ _tag: "viewport" }));
      expect(outputs).toContainEqual(
        expect.objectContaining({ _tag: "control", canOperate: false, controller: "agent" }),
      );
      const operator = yield* browser.attachViewer(viewerInput(tabId, true));
      yield* operator.input({ type: "takeControl" });
      yield* operator.input({ type: "text", text: "typed" });
      yield* operator.input({ type: "resize", width: 390, height: 844 });
      expect(contexts[0]!.sessions.at(-1)!.send).toHaveBeenCalledWith("Input.insertText", {
        text: "typed",
      });
      expect(page.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 });
      yield* operator.input({ type: "releaseControl" });
    }),
  ).pipe(Effect.provide(layer)),
);

it.live(
  "takeover waits for the running agent and revokes snapshot refs before returning control",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { browser, broker, tabId } = yield* ready;
        const snapshot = yield* broker.invoke<PreviewAutomationSnapshot>({
          scope,
          tabId,
          operation: "snapshot",
          input: {},
        });
        const ref = /\[ref=([^\]]+)\]/.exec(String(snapshot.accessibilityTree))![1]!;
        const viewer = yield* browser.attachViewer(viewerInput(tabId, true));
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<Record<string, unknown>>();
        const session = contexts[0]!.sessions[0]!;
        session.send.mockImplementationOnce(async () => {
          started.resolve();
          return finish.promise;
        });
        const running = yield* broker
          .invoke({ scope, tabId, operation: "evaluate", input: { expression: "pending()" } })
          .pipe(Effect.forkScoped);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => finish.resolve({ result: { value: "finished" } })),
        );
        yield* Effect.promise(() => started.promise);
        const takeover = yield* viewer.input({ type: "takeControl" }).pipe(Effect.forkScoped);
        let control = yield* Queue.take(viewer.output);
        while (control._tag !== "control" || control.controller !== "you") {
          control = yield* Queue.take(viewer.output);
        }
        const rejected = yield* broker
          .invoke<void>({ scope, tabId, operation: "evaluate", input: { expression: "racing()" } })
          .pipe(Effect.flip);
        expect(rejected).toMatchObject({
          _tag: "PreviewAutomationControlInterruptedError",
          reason: "humanControl",
        });
        finish.resolve({ result: { value: "finished" } });
        expect(yield* Fiber.join(running)).toBe("finished");
        yield* Fiber.join(takeover);
        yield* viewer.input({ type: "releaseControl" });
        const stale = yield* broker
          .invoke<void>({ scope, tabId, operation: "click", input: { locator: `aria-ref=${ref}` } })
          .pipe(Effect.flip);
        expect(stale._tag).toBe("PreviewAutomationInvalidSelectorError");
        expect(contexts[0]!.page.locator).not.toHaveBeenCalled();
        expect(
          yield* broker.invoke({
            scope,
            tabId,
            operation: "evaluate",
            input: { expression: "resumed()" },
          }),
        ).toBe("evaluated");
      }),
    ).pipe(Effect.provide(layer)),
);

it.live("reports a pending dialog without evaluating the page and resolves it explicitly", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { broker, tabId } = yield* ready;
      const page = contexts[0]!.page;
      yield* broker.invoke({
        scope,
        tabId,
        operation: "navigate",
        input: { url: "http://localhost:5173" },
      });
      const started = Promise.withResolvers<void>();
      const resolvedEvaluation = Promise.withResolvers<Record<string, unknown>>();
      const session = contexts[0]!.sessions[0]!;
      const send = session.send.getMockImplementation()!;
      session.send.mockImplementation(async (method, input) => {
        if (method !== "Runtime.evaluate") return send(method, input);
        started.resolve();
        return resolvedEvaluation.promise;
      });
      const blockedAction = yield* broker
        .invoke({
          scope,
          tabId,
          operation: "evaluate",
          input: { expression: 'confirm("Delete row?")' },
        })
        .pipe(Effect.forkScoped);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => resolvedEvaluation.resolve({ result: { value: true } })),
      );
      yield* Effect.promise(() => started.promise);
      const dialog = {
        type: () => "confirm",
        message: () => "Delete row?",
        defaultValue: () => "",
        accept: vi.fn(async () => {
          resolvedEvaluation.resolve({ result: { value: true } });
        }),
        dismiss: vi.fn(async () => {}),
      };
      page.emit("dialog", dialog);
      page.title.mockClear();
      const status = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        tabId,
        operation: "status",
        input: {},
      });
      expect(status.dialog).toMatchObject({ type: "confirm", message: "Delete row?" });
      expect(page.title).not.toHaveBeenCalled();
      expect(dialog.dismiss).not.toHaveBeenCalled();
      const reuse = yield* broker
        .invoke<void>({
          scope,
          tabId,
          operation: "open",
          input: { url: "http://localhost:5173/other" },
        })
        .pipe(Effect.flip);
      expect(reuse).toMatchObject({
        _tag: "PreviewAutomationControlInterruptedError",
        reason: "dialogPending",
      });
      expect(page.goto).toHaveBeenCalledTimes(1);
      yield* broker.invoke({ scope, tabId, operation: "dialog", input: { accept: true } });
      expect(yield* Fiber.join(blockedAction)).toBe(true);
      expect(dialog.accept).toHaveBeenCalledTimes(1);
      const resolved = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        tabId,
        operation: "status",
        input: {},
      });
      expect(resolved.dialog).toBeNull();
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("the owner can close a tab while an agent action waits on its dialog", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { broker, tabId } = yield* ready;
      const page = contexts[0]!.page;
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<Record<string, unknown>>();
      contexts[0]!.sessions[0]!.send.mockImplementationOnce(async () => {
        started.resolve();
        return finish.promise;
      });
      page.on("close", () => finish.resolve({ result: { value: "closed" } }));
      const running = yield* broker
        .invoke({
          scope,
          tabId,
          operation: "evaluate",
          input: { expression: 'confirm("Delete?")' },
        })
        .pipe(Effect.forkScoped);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => finish.resolve({ result: { value: "cleanup" } })),
      );
      yield* Effect.promise(() => started.promise);
      page.emit("dialog", {
        type: () => "confirm",
        message: () => "Delete?",
        defaultValue: () => "",
        accept: vi.fn(),
        dismiss: vi.fn(),
      });
      const foreign = yield* broker
        .invoke<void>({
          scope: { ...scope, providerSessionId: "agent-b" },
          tabId,
          operation: "close",
          input: {},
        })
        .pipe(Effect.flip);
      expect(foreign).toMatchObject({
        _tag: "PreviewAutomationControlInterruptedError",
        reason: "agentMismatch",
      });
      expect(page.close).not.toHaveBeenCalled();
      yield* broker.invoke({ scope, tabId, operation: "close", input: {} });
      expect(yield* Fiber.join(running)).toBe("closed");
      expect(page.close).toHaveBeenCalled();
      const manager = yield* Manager.PreviewManager;
      expect((yield* manager.list({ threadId: scope.threadId })).sessions).toHaveLength(0);
      const afterClose = yield* broker
        .invoke<void>({ scope, tabId, operation: "evaluate", input: { expression: "late()" } })
        .pipe(Effect.flip);
      expect(afterClose._tag).toBe("PreviewAutomationTabNotFoundError");
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("a popup becomes the agent's own tab and keeps its opener page", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { broker, tabId } = yield* ready;
      const opener = contexts[0]!.page;
      const popup = makeContext();
      opener.emit("popup", popup.page);
      const manager = yield* Manager.PreviewManager;
      let sessions = (yield* manager.list({ threadId: scope.threadId })).sessions;
      while (sessions.length < 2) {
        yield* Effect.sleep("5 millis");
        sessions = (yield* manager.list({ threadId: scope.threadId })).sessions;
      }
      const popupTab = sessions.find((session) => session.tabId !== tabId)!;
      const opened = sessions.find((session) => session.tabId === tabId)!;
      expect(popupTab).toMatchObject({ automationOwner: opened.automationOwner, reveal: false });
      const status = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        tabId,
        operation: "status",
        input: {},
      });
      expect(status.tabs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tabId }),
          expect.objectContaining({ tabId: popupTab.tabId, openerTabId: tabId }),
        ]),
      );
      expect(opener.goto).not.toHaveBeenCalled();
      expect(opener.close).not.toHaveBeenCalled();
      // The page the popup script holds is the tab, so closing it ends the tab.
      yield* Effect.promise(() => popup.page.close());
      while ((yield* manager.list({ threadId: scope.threadId })).sessions.length > 1) {
        yield* Effect.sleep("5 millis");
      }
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("closing a tab while a viewer is still opening it does not leave its page behind", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const browser = yield* ServerBrowser.ServerBrowser;
      const manager = yield* Manager.PreviewManager;
      yield* Effect.yieldNow;
      // The background open fails, so the tab exists only as a session.
      contextFailure = new Error("first launch failed");
      const snapshot = yield* manager.open({ threadId: scope.threadId, runtime: "server" });
      yield* Effect.sleep("10 millis");
      contextFailure = null;
      contextGate = Promise.withResolvers<void>();
      const attaching = yield* browser
        .attachViewer(viewerInput(snapshot.tabId, false))
        .pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.sleep("10 millis");
      yield* manager.close({ threadId: scope.threadId, tabId: snapshot.tabId });
      yield* Effect.sleep("10 millis");
      contextGate.resolve();
      expect((yield* Fiber.join(attaching))._tag).toBe("ServerBrowserTabNotFoundError");
      expect(contexts).toHaveLength(1);
      expect(contexts[0]!.page.close).toHaveBeenCalled();
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("page copies reach only the controlling viewer right after its input", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { browser, tabId } = yield* ready;
      const page = contexts[0]!.page;
      const watcher = yield* browser.attachViewer(viewerInput(tabId, false));
      const viewer = yield* browser.attachViewer(viewerInput(tabId, true));
      yield* viewer.input({ type: "takeControl" });
      const clipboard = (queue: typeof viewer.output) =>
        Queue.clear(queue).pipe(
          Effect.map((items) => items.filter((item) => item._tag === "clipboard")),
        );
      // A page writing on its own, without a recent gesture, stays on the server.
      clipboardBinding!({ page }, "unprompted");
      expect(yield* clipboard(viewer.output)).toEqual([]);
      yield* viewer.input({ type: "key", action: "down", key: "c", code: "KeyC", modifiers: 4 });
      const cdp = contexts[0]!.sessions.at(-1)!;
      expect(cdp.send).toHaveBeenCalledWith(
        "Input.dispatchKeyEvent",
        expect.objectContaining({ key: "c", commands: ["copy"] }),
      );
      clipboardBinding!({ page }, "copied");
      expect(yield* clipboard(viewer.output)).toEqual([{ _tag: "clipboard", text: "copied" }]);
      expect(yield* clipboard(watcher.output)).toEqual([]);
    }),
  ).pipe(Effect.provide(layer)),
);

it.live("a page download is saved, offered to the controller, and listed for the agent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { browser, broker, tabId } = yield* ready;
      const page = contexts[0]!.page;
      const viewer = yield* browser.attachViewer(viewerInput(tabId, true));
      yield* viewer.input({ type: "takeControl" });
      yield* Queue.clear(viewer.output);
      // Stands in for Chromium, which writes the file itself.
      const saved = yield* Queue.unbounded<string>();
      const written = Promise.withResolvers<void>();
      page.emit("download", {
        failure: async () => null,
        saveAs: (path: string) => {
          Queue.offerUnsafe(saved, path);
          return written.promise;
        },
        suggestedFilename: () => "report.csv",
        url: () => "blob:http://localhost:5173/1",
      });
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Queue.take(saved);
      yield* fs.writeFileString(path, "a,b");
      written.resolve();
      let offered = yield* Queue.take(viewer.output);
      while (offered._tag !== "download") offered = yield* Queue.take(viewer.output);
      expect(offered).toMatchObject({ _tag: "download", fileName: "report.csv", sizeBytes: 3 });
      const file = yield* browser.openDownload({
        threadId: scope.threadId,
        tabId,
        downloadId: offered.id,
      });
      expect(Option.isSome(file) && file.value.fileName).toBe("report.csv");
      const status = yield* broker.invoke<PreviewAutomationStatus>({
        scope,
        tabId,
        operation: "status",
        input: {},
      });
      expect(status.downloads).toEqual([
        expect.objectContaining({ fileName: "report.csv", sizeBytes: 3 }),
      ]);
      expect(
        Option.isNone(
          yield* browser.openDownload({ threadId: scope.threadId, tabId, downloadId: "guess" }),
        ),
      ).toBe(true);
    }),
  ).pipe(Effect.provide(layer)),
);
