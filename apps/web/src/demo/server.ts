/**
 * In-browser demo backend for the marketing sidebar demo.
 *
 * Serves the real `WsRpcGroup` RPC contract over an in-memory WebSocket pair,
 * so the unmodified web app (Sidebar V2 included) runs against fixture data
 * with no real server. Command dispatches mutate the in-memory shell store and
 * broadcast the same stream events a real server would.
 */
import {
  type AuthAccessStreamEvent,
  type ClientOrchestrationCommand,
  type DiscoveredLocalServerList,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
  type OrchestrationThreadStreamItem,
  ORCHESTRATION_WS_METHODS,
  OrchestrationGetSnapshotError,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  type VcsStatusStreamEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { Socket, SocketServer } from "effect/unstable/socket";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { demoDescriptor, demoServerConfig, demoShellSnapshot } from "./fixtures";

// ---------------------------------------------------------------------------
// In-memory WebSocket pair
// ---------------------------------------------------------------------------

type WsListener = (event: never) => void;

class DemoSocketEndpoint {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  readonly CONNECTING = 0 as const;
  readonly OPEN = 1 as const;
  readonly CLOSING = 2 as const;
  readonly CLOSED = 3 as const;

  readyState: number = DemoSocketEndpoint.CONNECTING;
  binaryType = "arraybuffer";
  peer: DemoSocketEndpoint | null = null;

  private listeners = new Map<string, Set<WsListener>>();
  private bufferedMessages: Array<unknown> = [];

  addEventListener(type: string, listener: unknown, _options?: unknown): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as WsListener);
    if (type === "message" && this.bufferedMessages.length > 0) {
      const pending = this.bufferedMessages.splice(0);
      queueMicrotask(() => {
        for (const event of pending) {
          this.dispatch("message", event);
        }
      });
    }
  }

  removeEventListener(type: string, listener: unknown): void {
    this.listeners.get(type)?.delete(listener as WsListener);
  }

  dispatch(type: string, event: unknown): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) {
      if (type === "message") {
        this.bufferedMessages.push(event);
      }
      return;
    }
    for (const listener of [...set]) {
      (listener as (event: unknown) => void)(event);
    }
  }

  open(): void {
    this.readyState = DemoSocketEndpoint.OPEN;
    queueMicrotask(() => this.dispatch("open", { type: "open" }));
  }

  send(data: unknown): void {
    const peer = this.peer;
    if (!peer || peer.readyState !== DemoSocketEndpoint.OPEN) {
      return;
    }
    queueMicrotask(() => peer.dispatch("message", { type: "message", data }));
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === DemoSocketEndpoint.CLOSED) {
      return;
    }
    this.readyState = DemoSocketEndpoint.CLOSED;
    const peer = this.peer;
    queueMicrotask(() => {
      this.dispatch("close", { type: "close", code, reason, wasClean: true });
      if (peer && peer.readyState !== DemoSocketEndpoint.CLOSED) {
        peer.close(code, reason);
      }
    });
  }
}

interface DemoConnectionListener {
  (serverEndpoint: DemoSocketEndpoint): void;
}

const pendingServerEndpoints: Array<DemoSocketEndpoint> = [];
let connectionListener: DemoConnectionListener | null = null;

function acceptDemoConnection(listener: DemoConnectionListener): void {
  connectionListener = listener;
  for (const endpoint of pendingServerEndpoints.splice(0)) {
    listener(endpoint);
  }
}

function connectDemoClient(): DemoSocketEndpoint {
  const client = new DemoSocketEndpoint();
  const server = new DemoSocketEndpoint();
  client.peer = server;
  server.peer = client;
  server.open();
  client.open();
  if (connectionListener) {
    connectionListener(server);
  } else {
    pendingServerEndpoints.push(server);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Global WebSocket + fetch interception
// ---------------------------------------------------------------------------

function isDemoBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.pathname === "/ws" || parsed.pathname.endsWith("/ws");
  } catch {
    return false;
  }
}

export function installDemoNetworkInterceptors(): void {
  const NativeWebSocket = globalThis.WebSocket;
  const DemoWebSocket = function (this: unknown, url: string | URL, protocols?: unknown) {
    const urlString = String(url);
    if (isDemoBackendUrl(urlString)) {
      return connectDemoClient() as unknown as WebSocket;
    }
    return new NativeWebSocket(urlString, protocols as string | Array<string> | undefined);
  } as unknown as typeof WebSocket;
  DemoWebSocket.prototype = NativeWebSocket.prototype;
  Object.assign(DemoWebSocket, {
    CONNECTING: NativeWebSocket.CONNECTING,
    OPEN: NativeWebSocket.OPEN,
    CLOSING: NativeWebSocket.CLOSING,
    CLOSED: NativeWebSocket.CLOSED,
  });
  globalThis.WebSocket = DemoWebSocket;

  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const urlString =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(urlString, window.location.origin);
    if (parsed.origin === window.location.origin) {
      if (parsed.pathname === "/.well-known/t3/environment") {
        return Promise.resolve(jsonResponse(demoDescriptor));
      }
      if (parsed.pathname === "/api/auth/session") {
        return Promise.resolve(
          jsonResponse({
            authenticated: true,
            auth: demoServerConfig.auth,
            scopes: [
              "orchestration:read",
              "orchestration:operate",
              "terminal:operate",
              "review:write",
              "access:read",
              "access:write",
            ],
          }),
        );
      }
      if (parsed.pathname === "/api/orchestration/shell") {
        return Promise.resolve(jsonResponse(shellStore.snapshot()));
      }
    }
    return nativeFetch(input, init);
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// In-memory shell store
// ---------------------------------------------------------------------------

type ShellSubscriber = (item: OrchestrationShellStreamItem) => void;

class DemoShellStore {
  private sequence: number;
  private projects: Map<string, OrchestrationProjectShell>;
  private threads: Map<string, OrchestrationThreadShell>;
  private subscribers = new Set<ShellSubscriber>();

  constructor(initial: OrchestrationShellSnapshot) {
    this.sequence = initial.snapshotSequence;
    this.projects = new Map(initial.projects.map((project) => [project.id, project]));
    this.threads = new Map(initial.threads.map((thread) => [thread.id, thread]));
  }

  snapshot(): OrchestrationShellSnapshot {
    return {
      snapshotSequence: this.sequence,
      projects: [...this.projects.values()],
      threads: [...this.threads.values()],
      updatedAt: new Date().toISOString(),
    };
  }

  subscribe(subscriber: ShellSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  thread(threadId: string): OrchestrationThreadShell | undefined {
    return this.threads.get(threadId);
  }

  private emit(item: OrchestrationShellStreamItem): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber(item);
    }
  }

  upsertThread(thread: OrchestrationThreadShell): number {
    this.sequence += 1;
    this.threads.set(thread.id, thread);
    this.emit({ kind: "thread-upserted", sequence: this.sequence, thread });
    return this.sequence;
  }

  removeThread(threadId: OrchestrationThreadShell["id"]): number {
    this.sequence += 1;
    this.threads.delete(threadId);
    this.emit({ kind: "thread-removed", sequence: this.sequence, threadId });
    return this.sequence;
  }

  upsertProject(project: OrchestrationProjectShell): number {
    this.sequence += 1;
    this.projects.set(project.id, project);
    this.emit({ kind: "project-upserted", sequence: this.sequence, project });
    return this.sequence;
  }

  removeProject(projectId: OrchestrationProjectShell["id"]): number {
    this.sequence += 1;
    this.projects.delete(projectId);
    this.emit({ kind: "project-removed", sequence: this.sequence, projectId });
    return this.sequence;
  }

  dispatch(command: ClientOrchestrationCommand): number {
    const nowIso = new Date().toISOString();
    switch (command.type) {
      case "thread.create": {
        return this.upsertThread({
          id: command.threadId,
          projectId: command.projectId,
          title: command.title,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
          interactionMode: command.interactionMode,
          branch: command.branch,
          worktreePath: command.worktreePath,
          latestTurn: null,
          createdAt: command.createdAt,
          updatedAt: nowIso,
          archivedAt: null,
          session: null,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
        });
      }
      case "thread.archive": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({ ...thread, archivedAt: nowIso, updatedAt: nowIso });
      }
      case "thread.unarchive": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({ ...thread, archivedAt: null, updatedAt: nowIso });
      }
      case "thread.delete": {
        return this.removeThread(command.threadId);
      }
      case "thread.meta.update": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({
          ...thread,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.modelSelection !== undefined
            ? { modelSelection: command.modelSelection }
            : {}),
          ...(command.branch !== undefined ? { branch: command.branch } : {}),
          ...(command.worktreePath !== undefined ? { worktreePath: command.worktreePath } : {}),
          updatedAt: nowIso,
        });
      }
      case "project.create": {
        return this.upsertProject({
          id: command.projectId,
          title: command.title,
          workspaceRoot: command.workspaceRoot,
          defaultModelSelection: command.defaultModelSelection ?? null,
          scripts: [],
          createdAt: command.createdAt,
          updatedAt: nowIso,
        });
      }
      case "project.meta.update": {
        const project = this.projects.get(command.projectId);
        if (!project) {
          return this.sequence;
        }
        return this.upsertProject({
          ...project,
          ...(command.title !== undefined ? { title: command.title } : {}),
          ...(command.workspaceRoot !== undefined ? { workspaceRoot: command.workspaceRoot } : {}),
          ...(command.defaultModelSelection !== undefined
            ? { defaultModelSelection: command.defaultModelSelection }
            : {}),
          ...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
          updatedAt: nowIso,
        });
      }
      case "project.delete": {
        for (const thread of [...this.threads.values()]) {
          if (thread.projectId === command.projectId) {
            this.removeThread(thread.id);
          }
        }
        return this.removeProject(command.projectId);
      }
      default: {
        this.sequence += 1;
        return this.sequence;
      }
    }
  }
}

const shellStore = new DemoShellStore(demoShellSnapshot);

// ---------------------------------------------------------------------------
// RPC handlers
// ---------------------------------------------------------------------------

const unsupported = (method: string) =>
  Effect.die(new Error(`RPC method not supported in the demo: ${method}`));

function shellStream(): Stream.Stream<OrchestrationShellStreamItem> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<OrchestrationShellStreamItem>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          shellStore.subscribe((item) => {
            Queue.offerUnsafe(queue, item);
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      return Stream.fromQueue(queue);
    }),
  );
}

function threadDetailSnapshot(thread: OrchestrationThreadShell): OrchestrationThreadDetailSnapshot {
  return {
    snapshotSequence: 1,
    thread: {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: thread.session,
    },
  };
}

const EMPTY_VCS_STATUS: VcsStatusStreamEvent = {
  _tag: "snapshot",
  local: {
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "main",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  },
  remote: null,
};

const demoStartedAtIso = new Date().toISOString();

const serverConfigSnapshot: ServerConfigStreamEvent = {
  version: 1,
  type: "snapshot",
  config: demoServerConfig,
};
const lifecycleReady: ServerLifecycleStreamEvent = {
  version: 1,
  sequence: 1,
  type: "ready",
  payload: { at: demoStartedAtIso, environment: demoDescriptor },
};
const authAccessSnapshot: AuthAccessStreamEvent = {
  version: 1,
  revision: 1,
  type: "snapshot",
  payload: { pairingLinks: [], clientSessions: [] },
};
const noLocalServers: DiscoveredLocalServerList = {
  servers: [],
  scannedAt: demoStartedAtIso,
};

const handlersLayer = WsRpcGroup.toLayer(
  Effect.sync(() => {
    return {
      [WS_METHODS.serverProbe]: () => Effect.succeed({}),
      [WS_METHODS.serverGetConfig]: () => Effect.succeed(demoServerConfig),
      [WS_METHODS.serverGetSettings]: () => Effect.succeed(demoServerConfig.settings),
      [WS_METHODS.serverUpdateSettings]: () => Effect.succeed(demoServerConfig.settings),
      [WS_METHODS.serverRefreshProviders]: () =>
        Effect.succeed({ providers: demoServerConfig.providers }),
      [WS_METHODS.subscribeServerConfig]: () =>
        Stream.concat(Stream.make(serverConfigSnapshot), Stream.never),
      [WS_METHODS.subscribeServerLifecycle]: () =>
        Stream.concat(Stream.make(lifecycleReady), Stream.never),
      [WS_METHODS.subscribeAuthAccess]: () =>
        Stream.concat(Stream.make(authAccessSnapshot), Stream.never),
      [WS_METHODS.subscribeDiscoveredLocalServers]: () =>
        Stream.concat(Stream.make(noLocalServers), Stream.never),
      [WS_METHODS.subscribeTerminalEvents]: () => Stream.never,
      [WS_METHODS.subscribeTerminalMetadata]: () => Stream.never,
      [WS_METHODS.subscribePreviewEvents]: () => Stream.never,
      [WS_METHODS.subscribeVcsStatus]: () =>
        Stream.concat(Stream.make(EMPTY_VCS_STATUS), Stream.never),
      [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) => {
        const live = shellStream();
        if (input.afterSequence !== undefined) {
          return live;
        }
        const snapshotItem: OrchestrationShellStreamItem = {
          kind: "snapshot",
          snapshot: shellStore.snapshot(),
        };
        return Stream.concat(Stream.make(snapshotItem), live);
      },
      [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
        Stream.unwrap(
          Effect.sync(() => {
            const thread = shellStore.thread(input.threadId);
            if (!thread) {
              return Stream.fail(
                new OrchestrationGetSnapshotError({ message: "Thread not found" }),
              );
            }
            const snapshotItem: OrchestrationThreadStreamItem = {
              kind: "snapshot",
              snapshot: threadDetailSnapshot(thread),
            };
            return Stream.concat(Stream.make(snapshotItem), Stream.never);
          }),
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        Effect.sync(() => ({ sequence: shellStore.dispatch(command) })),
      [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: () =>
        Effect.sync(() => shellStore.snapshot()),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: () => unsupported("getTurnDiff"),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: () => unsupported("getFullThreadDiff"),
      [ORCHESTRATION_WS_METHODS.replayEvents]: () => Effect.succeed([]),
      [WS_METHODS.serverUpdateProvider]: () => unsupported("serverUpdateProvider"),
      [WS_METHODS.serverUpsertKeybinding]: () => unsupported("serverUpsertKeybinding"),
      [WS_METHODS.serverRemoveKeybinding]: () => unsupported("serverRemoveKeybinding"),
      [WS_METHODS.serverDiscoverSourceControl]: () => unsupported("serverDiscoverSourceControl"),
      [WS_METHODS.serverGetTraceDiagnostics]: () => unsupported("serverGetTraceDiagnostics"),
      [WS_METHODS.serverGetProcessDiagnostics]: () => unsupported("serverGetProcessDiagnostics"),
      [WS_METHODS.serverGetProcessResourceHistory]: () =>
        unsupported("serverGetProcessResourceHistory"),
      [WS_METHODS.serverSignalProcess]: () => unsupported("serverSignalProcess"),
      [WS_METHODS.cloudGetRelayClientStatus]: () => unsupported("cloudGetRelayClientStatus"),
      [WS_METHODS.cloudInstallRelayClient]: () =>
        Stream.die(new Error("not supported in the demo")),
      [WS_METHODS.sourceControlLookupRepository]: () =>
        unsupported("sourceControlLookupRepository"),
      [WS_METHODS.sourceControlCloneRepository]: () => unsupported("sourceControlCloneRepository"),
      [WS_METHODS.sourceControlPublishRepository]: () =>
        unsupported("sourceControlPublishRepository"),
      [WS_METHODS.projectsListEntries]: () => unsupported("projectsListEntries"),
      [WS_METHODS.projectsReadFile]: () => unsupported("projectsReadFile"),
      [WS_METHODS.projectsSearchEntries]: () => unsupported("projectsSearchEntries"),
      [WS_METHODS.projectsWriteFile]: () => unsupported("projectsWriteFile"),
      [WS_METHODS.shellOpenInEditor]: () => unsupported("shellOpenInEditor"),
      [WS_METHODS.filesystemBrowse]: () => unsupported("filesystemBrowse"),
      [WS_METHODS.assetsCreateUrl]: () => unsupported("assetsCreateUrl"),
      [WS_METHODS.vcsPull]: () => unsupported("vcsPull"),
      [WS_METHODS.vcsRefreshStatus]: () => unsupported("vcsRefreshStatus"),
      [WS_METHODS.gitRunStackedAction]: () => Stream.die(new Error("not supported in the demo")),
      [WS_METHODS.gitResolvePullRequest]: () => unsupported("gitResolvePullRequest"),
      [WS_METHODS.gitPreparePullRequestThread]: () => unsupported("gitPreparePullRequestThread"),
      [WS_METHODS.vcsListRefs]: () =>
        Effect.succeed({
          refs: [],
          isRepo: true,
          hasPrimaryRemote: false,
          nextCursor: null,
          totalCount: 0,
        }),
      [WS_METHODS.vcsCreateWorktree]: () => unsupported("vcsCreateWorktree"),
      [WS_METHODS.vcsRemoveWorktree]: () => unsupported("vcsRemoveWorktree"),
      [WS_METHODS.vcsCreateRef]: () => unsupported("vcsCreateRef"),
      [WS_METHODS.vcsSwitchRef]: () => unsupported("vcsSwitchRef"),
      [WS_METHODS.vcsInit]: () => unsupported("vcsInit"),
      [WS_METHODS.reviewGetDiffPreview]: () => unsupported("reviewGetDiffPreview"),
      [WS_METHODS.terminalOpen]: () => unsupported("terminalOpen"),
      [WS_METHODS.terminalAttach]: () => Stream.die(new Error("not supported in the demo")),
      [WS_METHODS.terminalWrite]: () => unsupported("terminalWrite"),
      [WS_METHODS.terminalResize]: () => unsupported("terminalResize"),
      [WS_METHODS.terminalClear]: () => unsupported("terminalClear"),
      [WS_METHODS.terminalRestart]: () => unsupported("terminalRestart"),
      [WS_METHODS.terminalClose]: () => unsupported("terminalClose"),
      [WS_METHODS.previewOpen]: () => unsupported("previewOpen"),
      [WS_METHODS.previewNavigate]: () => unsupported("previewNavigate"),
      [WS_METHODS.previewResize]: () => unsupported("previewResize"),
      [WS_METHODS.previewRefresh]: () => unsupported("previewRefresh"),
      [WS_METHODS.previewClose]: () => unsupported("previewClose"),
      [WS_METHODS.previewList]: () => Effect.succeed({ sessions: [] }),
      [WS_METHODS.previewReportStatus]: () => unsupported("previewReportStatus"),
      [WS_METHODS.previewAutomationConnect]: () =>
        Stream.die(new Error("not supported in the demo")),
      [WS_METHODS.previewAutomationRespond]: () => unsupported("previewAutomationRespond"),
      [WS_METHODS.previewAutomationFocusHost]: () => unsupported("previewAutomationFocusHost"),
    };
  }),
);

// ---------------------------------------------------------------------------
// SocketServer wiring
// ---------------------------------------------------------------------------

const demoSocketServerLayer = Layer.succeed(
  SocketServer.SocketServer,
  SocketServer.SocketServer.of({
    address: { _tag: "TcpAddress", hostname: "demo", port: 0 },
    run: <R, E, _>(handler: (socket: Socket.Socket) => Effect.Effect<_, E, R>) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<DemoSocketEndpoint>();
        acceptDemoConnection((endpoint) => {
          Queue.offerUnsafe(queue, endpoint);
        });
        return yield* Queue.take(queue).pipe(
          Effect.flatMap((endpoint) =>
            Socket.fromWebSocket(Effect.succeed(endpoint as unknown as globalThis.WebSocket)).pipe(
              Effect.flatMap((socket) => Effect.forkChild(handler(socket))),
            ),
          ),
          Effect.forever,
        );
      }),
  }),
);

export function startDemoServer(): void {
  installDemoNetworkInterceptors();

  const serverLayer = RpcServer.layer(WsRpcGroup, { disableTracing: true }).pipe(
    Layer.provide(handlersLayer),
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(demoSocketServerLayer),
    Layer.provide(RpcSerialization.layerJson),
  );

  Effect.runFork(Layer.launch(serverLayer));
}
