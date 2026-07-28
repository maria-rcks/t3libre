/**
 * In-browser demo backend for the marketing sidebar demo.
 *
 * Serves the real `WsRpcGroup` RPC contract over in-memory WebSocket pairs,
 * so the unmodified web app (Sidebar V2 included) runs against fixture data
 * with no real server. Command dispatches mutate the in-memory shell store and
 * broadcast the same stream events a real server would.
 *
 * Multiple demo environments run side by side: the primary (same-origin)
 * environment plus fake remote machines on made-up HTTPS origins, each with
 * its own shell store and RPC server. The network interceptors route requests
 * by origin, which is how the demo showcases T3 Connect-style remotes.
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
  EnvironmentAuthorizationError,
  ORCHESTRATION_WS_METHODS,
  OrchestrationGetSnapshotError,
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type ServerConfigStreamEvent,
  type ServerLifecycleStreamEvent,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { PROJECT_FAVICON_FALLBACK_MARKER } from "@t3tools/shared/projectFavicon";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { Socket, SocketServer } from "effect/unstable/socket";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import {
  type DemoEnvironmentFixture,
  demoAttachmentUrlById,
  demoEnvironments,
  demoProjectFaviconUrlByCwd,
  demoReviewDiffPreview,
  demoThreadDiff,
  demoThreadDetails,
  demoVcsStatusByCwd,
} from "./fixtures";

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

class DemoConnectionAcceptor {
  private pending: Array<DemoSocketEndpoint> = [];
  private listener: DemoConnectionListener | null = null;

  accept(listener: DemoConnectionListener): void {
    this.listener = listener;
    for (const endpoint of this.pending.splice(0)) {
      listener(endpoint);
    }
  }

  connectClient(): DemoSocketEndpoint {
    const client = new DemoSocketEndpoint();
    const server = new DemoSocketEndpoint();
    client.peer = server;
    server.peer = client;
    server.open();
    client.open();
    if (this.listener) {
      this.listener(server);
    } else {
      this.pending.push(server);
    }
    return client;
  }
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
          settledOverride: null,
          settledAt: null,
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
      case "thread.settle": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({
          ...thread,
          settledOverride: "settled",
          settledAt: nowIso,
          updatedAt: nowIso,
        });
      }
      case "thread.unsettle": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({
          ...thread,
          settledOverride: "active",
          settledAt: nowIso,
          updatedAt: nowIso,
        });
      }
      case "thread.snooze": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({
          ...thread,
          snoozedUntil: command.snoozedUntil,
          snoozedAt: nowIso,
          updatedAt: nowIso,
        });
      }
      case "thread.unsnooze": {
        const thread = this.threads.get(command.threadId);
        if (!thread) {
          return this.sequence;
        }
        return this.upsertThread({
          ...thread,
          snoozedUntil: null,
          snoozedAt: null,
          updatedAt: nowIso,
        });
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

// ---------------------------------------------------------------------------
// Per-environment backend
// ---------------------------------------------------------------------------

interface DemoBackend {
  readonly fixture: DemoEnvironmentFixture;
  readonly store: DemoShellStore;
  readonly acceptor: DemoConnectionAcceptor;
}

const demoBackends: ReadonlyArray<DemoBackend> = demoEnvironments.map((fixture) => ({
  fixture,
  store: new DemoShellStore(fixture.shellSnapshot),
  acceptor: new DemoConnectionAcceptor(),
}));

function backendForOrigin(origin: string): DemoBackend | undefined {
  return demoBackends.find(
    (backend) => (backend.fixture.origin ?? window.location.origin) === origin,
  );
}

// ---------------------------------------------------------------------------
// Global WebSocket + fetch interception
// ---------------------------------------------------------------------------

export function installDemoNetworkInterceptors(): void {
  const NativeWebSocket = globalThis.WebSocket;
  const DemoWebSocket = function (this: unknown, url: string | URL, protocols?: unknown) {
    const urlString = String(url);
    try {
      const parsed = new URL(urlString, window.location.origin);
      if (parsed.pathname === "/ws" || parsed.pathname.endsWith("/ws")) {
        const backend = backendForOrigin(parsed.origin.replace(/^ws(s?):/, "http$1:"));
        if (backend) {
          return backend.acceptor.connectClient() as unknown as WebSocket;
        }
      }
    } catch {
      // fall through to the native socket
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
    const backend = backendForOrigin(parsed.origin);
    if (backend) {
      const response = demoHttpResponse(backend, parsed);
      if (response) {
        return Promise.resolve(response);
      }
      if (backend.fixture.origin !== null) {
        // Never let requests to a fake remote origin hit the real network.
        return Promise.resolve(new Response(null, { status: 404 }));
      }
    }
    return nativeFetch(input, init);
  };
}

function demoHttpResponse(backend: DemoBackend, url: URL): Response | null {
  const fixture = backend.fixture;
  if (url.pathname === "/.well-known/t3/environment") {
    return jsonResponse(fixture.descriptor);
  }
  if (url.pathname === "/api/auth/session") {
    return jsonResponse({
      authenticated: true,
      auth: fixture.serverConfig.auth,
      scopes: [
        "orchestration:read",
        "orchestration:operate",
        "terminal:operate",
        "review:write",
        "access:read",
        "access:write",
      ],
    });
  }
  if (url.pathname === "/api/auth/websocket-ticket") {
    return jsonResponse({
      ticket: `demo-ticket-${fixture.environmentId}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }
  if (url.pathname === "/api/orchestration/shell") {
    return jsonResponse(backend.store.snapshot());
  }
  const threadMatch = url.pathname.match(/^\/api\/orchestration\/threads\/([^/]+)$/);
  if (threadMatch) {
    const thread = backend.store.thread(decodeURIComponent(threadMatch[1] ?? ""));
    if (!thread) {
      return new Response(null, { status: 404 });
    }
    return jsonResponse(threadDetailSnapshot(thread));
  }
  return null;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// RPC handlers
// ---------------------------------------------------------------------------

const unsupportedError = (method: string) =>
  new EnvironmentAuthorizationError({
    message: `RPC method not supported in the demo: ${method}`,
    requiredScope: "orchestration:operate",
  });

const unsupported = (method: string) => Effect.fail(unsupportedError(method));

function shellStream(store: DemoShellStore): Stream.Stream<OrchestrationShellStreamItem> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<OrchestrationShellStreamItem>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          store.subscribe((item) => {
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
  const detail = demoThreadDetails[thread.id];
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
      settledOverride: thread.settledOverride,
      settledAt: thread.settledAt,
      ...(thread.snoozedUntil !== undefined ? { snoozedUntil: thread.snoozedUntil } : {}),
      ...(thread.snoozedAt !== undefined ? { snoozedAt: thread.snoozedAt } : {}),
      messages: detail?.messages ?? [],
      proposedPlans: [],
      activities: detail?.activities ?? [],
      checkpoints: detail?.checkpoints ?? [],
      session: thread.session,
    },
  };
}

const EMPTY_VCS_STATUS: VcsSnapshot = {
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

type VcsSnapshot = Extract<VcsStatusStreamEvent, { _tag: "snapshot" }>;

/**
 * Per-checkout git status backing the real GitActionsControl. Statuses are
 * mutable so the demo "Commit & push" button behaves like the real one: after
 * an action the working tree becomes clean and subscribers are notified.
 */
class DemoVcsStore {
  private statuses = new Map<string, VcsSnapshot>();
  private listeners = new Map<string, Set<(event: VcsStatusStreamEvent) => void>>();

  constructor() {
    for (const [cwd, status] of Object.entries(demoVcsStatusByCwd)) {
      if (status._tag === "snapshot") {
        this.statuses.set(cwd, status);
      }
    }
  }

  snapshot(cwd: string): VcsSnapshot {
    return this.statuses.get(cwd) ?? EMPTY_VCS_STATUS;
  }

  combined(cwd: string): VcsStatusResult {
    const snapshot = this.snapshot(cwd);
    return {
      ...snapshot.local,
      hasUpstream: snapshot.remote?.hasUpstream ?? false,
      aheadCount: snapshot.remote?.aheadCount ?? 0,
      behindCount: snapshot.remote?.behindCount ?? 0,
      ...(snapshot.remote?.aheadOfDefaultCount !== undefined
        ? { aheadOfDefaultCount: snapshot.remote.aheadOfDefaultCount }
        : {}),
      pr: snapshot.remote?.pr ?? null,
    };
  }

  subscribe(cwd: string, listener: (event: VcsStatusStreamEvent) => void): () => void {
    let set = this.listeners.get(cwd);
    if (!set) {
      set = new Set();
      this.listeners.set(cwd, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  update(cwd: string, next: VcsSnapshot): void {
    this.statuses.set(cwd, next);
    for (const listener of this.listeners.get(cwd) ?? []) {
      listener(next);
    }
  }
}

const demoVcsStore = new DemoVcsStore();

const DEMO_COMMIT_SUBJECT_BY_CWD: Record<string, string> = {
  "~/code/t3code-worktrees/composer-attachments":
    "Add drag-drop attachment overlay to the composer",
  "~/code/t3code-worktrees/git-manager-test": "Deflake GitManager cross-repo PR metadata test",
};

const DEMO_COMMIT_SUBJECT_FALLBACK = "Checkpoint demo changes";

function demoCommitSubject(cwd: string): string {
  return DEMO_COMMIT_SUBJECT_BY_CWD[cwd] ?? DEMO_COMMIT_SUBJECT_FALLBACK;
}

function settleVcsAction(cwd: string, input: GitRunStackedActionInput): void {
  const current = demoVcsStore.snapshot(cwd);
  const includesPr = input.action === "create_pr" || input.action === "commit_push_pr";
  const refName = current.local.refName ?? "main";
  demoVcsStore.update(cwd, {
    _tag: "snapshot",
    local: {
      ...current.local,
      hasWorkingTreeChanges: input.action === "push" ? current.local.hasWorkingTreeChanges : false,
      workingTree:
        input.action === "push"
          ? current.local.workingTree
          : { files: [], insertions: 0, deletions: 0 },
    },
    remote: {
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      aheadOfDefaultCount: current.remote?.aheadOfDefaultCount ?? 0,
      pr: includesPr
        ? {
            number: 1338,
            title: demoCommitSubject(cwd),
            url: "https://github.com/pingdotgg/t3code/pull/1338",
            baseRef: "main",
            headRef: refName,
            state: "open",
          }
        : (current.remote?.pr ?? null),
    },
  });
}

function demoGitActionEvents(input: GitRunStackedActionInput): GitActionProgressEvent[] {
  const base = { actionId: input.actionId, cwd: input.cwd, action: input.action };
  const status = demoVcsStore.snapshot(input.cwd);
  const refName = status.local.refName ?? "main";
  const includesCommit = input.action !== "push" && input.action !== "create_pr";
  const includesPush = input.action !== "commit" && input.action !== "create_pr";
  const includesPr = input.action === "create_pr" || input.action === "commit_push_pr";
  const subject = input.commitMessage?.split("\n")[0] ?? demoCommitSubject(input.cwd);

  const phases: Array<"commit" | "push" | "pr"> = [
    ...(includesCommit ? (["commit"] as const) : []),
    ...(includesPush ? (["push"] as const) : []),
    ...(includesPr ? (["pr"] as const) : []),
  ];

  const result: GitRunStackedActionResult = {
    action: input.action,
    branch: { status: "skipped_not_requested" },
    commit: includesCommit
      ? { status: "created", commitSha: "9e84b71", subject }
      : { status: "skipped_not_requested" },
    push: includesPush
      ? { status: "pushed", branch: refName, upstreamBranch: `origin/${refName}` }
      : { status: "skipped_not_requested" },
    pr: includesPr
      ? {
          status: "created",
          url: "https://github.com/pingdotgg/t3code/pull/1338",
          number: 1338,
          baseBranch: "main",
          headBranch: refName,
          title: subject,
        }
      : { status: "skipped_not_requested" },
    toast: {
      title: includesPr ? "Pull request created" : "Pushed to GitHub",
      description: includesPr ? subject : `${refName} → origin/${refName}`,
      cta: includesPr
        ? {
            kind: "open_pr",
            label: "Open pull request",
            url: "https://github.com/pingdotgg/t3code/pull/1338",
          }
        : { kind: "none" },
    },
  };

  return [
    { ...base, kind: "action_started", phases },
    ...phases.map(
      (phase): GitActionProgressEvent => ({
        ...base,
        kind: "phase_started",
        phase,
        label:
          phase === "commit"
            ? "Committing..."
            : phase === "push"
              ? `Pushing to origin/${refName}...`
              : "Creating pull request...",
      }),
    ),
    { ...base, kind: "action_finished", result },
  ];
}

const demoStartedAtIso = new Date().toISOString();
const demoAssetsExpireAt = Date.now() + 24 * 60 * 60 * 1000;

function makeHandlersLayer(backend: DemoBackend) {
  const { fixture, store } = backend;
  const serverConfigSnapshot: ServerConfigStreamEvent = {
    version: 1,
    type: "snapshot",
    config: fixture.serverConfig,
  };
  const lifecycleReady: ServerLifecycleStreamEvent = {
    version: 1,
    sequence: 1,
    type: "ready",
    payload: { at: demoStartedAtIso, environment: fixture.descriptor },
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

  return WsRpcGroup.toLayer(
    Effect.sync(() => {
      return {
        [WS_METHODS.serverProbe]: () => Effect.succeed({}),
        [WS_METHODS.serverGetConfig]: () => Effect.succeed(fixture.serverConfig),
        [WS_METHODS.serverGetSettings]: () => Effect.succeed(fixture.serverConfig.settings),
        [WS_METHODS.serverUpdateSettings]: () => Effect.succeed(fixture.serverConfig.settings),
        [WS_METHODS.serverRefreshProviders]: () =>
          Effect.succeed({ providers: fixture.serverConfig.providers }),
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
        [WS_METHODS.subscribeVcsStatus]: (input) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const queue = yield* Queue.unbounded<VcsStatusStreamEvent>();
              yield* Effect.acquireRelease(
                Effect.sync(() =>
                  demoVcsStore.subscribe(input.cwd, (event) => {
                    Queue.offerUnsafe(queue, event);
                  }),
                ),
                (unsubscribe) => Effect.sync(unsubscribe),
              );
              return Stream.concat(
                Stream.make(demoVcsStore.snapshot(input.cwd) as VcsStatusStreamEvent),
                Stream.fromQueue(queue),
              );
            }),
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) => {
          const live = shellStream(store);
          if (input.afterSequence !== undefined) {
            return live;
          }
          const snapshotItem: OrchestrationShellStreamItem = {
            kind: "snapshot",
            snapshot: store.snapshot(),
          };
          return Stream.concat(Stream.make(snapshotItem), live);
        },
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
          Stream.unwrap(
            Effect.sync(() => {
              const thread = store.thread(input.threadId);
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
          Effect.sync(() => ({ sequence: store.dispatch(command) })),
        [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: () =>
          Effect.sync(() => store.snapshot()),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          Effect.succeed(demoThreadDiff(input.threadId, input.fromTurnCount, input.toTurnCount)),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          Effect.succeed(demoThreadDiff(input.threadId, 0, input.toTurnCount)),
        [ORCHESTRATION_WS_METHODS.replayEvents]: () => Effect.succeed([]),
        [WS_METHODS.serverUpdateProvider]: () => unsupported("serverUpdateProvider"),
        [WS_METHODS.serverUpdateServer]: () => unsupported("serverUpdateServer"),
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
          Stream.fail(unsupportedError("cloudInstallRelayClient")),
        [WS_METHODS.sourceControlLookupRepository]: () =>
          unsupported("sourceControlLookupRepository"),
        [WS_METHODS.sourceControlCloneRepository]: () =>
          unsupported("sourceControlCloneRepository"),
        [WS_METHODS.sourceControlPublishRepository]: () =>
          unsupported("sourceControlPublishRepository"),
        [WS_METHODS.projectsListEntries]: () => unsupported("projectsListEntries"),
        [WS_METHODS.projectsReadFile]: () => unsupported("projectsReadFile"),
        [WS_METHODS.projectsSearchEntries]: () => unsupported("projectsSearchEntries"),
        [WS_METHODS.projectsWriteFile]: () => unsupported("projectsWriteFile"),
        [WS_METHODS.shellOpenInEditor]: () => unsupported("shellOpenInEditor"),
        [WS_METHODS.filesystemBrowse]: () => unsupported("filesystemBrowse"),
        [WS_METHODS.assetsCreateUrl]: (input) =>
          Effect.sync(() => {
            const expiresAt = demoAssetsExpireAt;
            const resource = input.resource;
            const relativeUrl =
              resource._tag === "project-favicon"
                ? (demoProjectFaviconUrlByCwd[resource.cwd] ??
                  `/${PROJECT_FAVICON_FALLBACK_MARKER}`)
                : resource._tag === "attachment"
                  ? demoAttachmentUrlById[resource.attachmentId]
                  : undefined;
            return { relativeUrl: relativeUrl ?? `/${PROJECT_FAVICON_FALLBACK_MARKER}`, expiresAt };
          }),
        [WS_METHODS.vcsPull]: () => unsupported("vcsPull"),
        [WS_METHODS.vcsRefreshStatus]: (input) =>
          Effect.sync(() => demoVcsStore.combined(input.cwd)),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          Stream.fromIterable(demoGitActionEvents(input)).pipe(
            Stream.mapEffect((event) => Effect.as(Effect.sleep("650 millis"), event)),
            Stream.onEnd(Effect.sync(() => settleVcsAction(input.cwd, input))),
          ),
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
        [WS_METHODS.reviewGetDiffPreview]: (input) =>
          Effect.succeed(demoReviewDiffPreview(input.cwd)),
        [WS_METHODS.terminalOpen]: () => unsupported("terminalOpen"),
        [WS_METHODS.terminalAttach]: () => Stream.fail(unsupportedError("terminalAttach")),
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
        [WS_METHODS.previewList]: () =>
          Effect.succeed({ sessions: [], serverEpoch: "demo", revision: 0 }),
        [WS_METHODS.previewReportStatus]: () => unsupported("previewReportStatus"),
        [WS_METHODS.previewAutomationConnect]: () =>
          Stream.fail(unsupportedError("previewAutomationConnect")),
        [WS_METHODS.previewAutomationRespond]: () => unsupported("previewAutomationRespond"),
        [WS_METHODS.previewAutomationFocusHost]: () => unsupported("previewAutomationFocusHost"),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// SocketServer wiring
// ---------------------------------------------------------------------------

function makeSocketServerLayer(backend: DemoBackend) {
  return Layer.succeed(
    SocketServer.SocketServer,
    SocketServer.SocketServer.of({
      address: { _tag: "TcpAddress", hostname: backend.fixture.environmentId, port: 0 },
      run: <R, E, _>(handler: (socket: Socket.Socket) => Effect.Effect<_, E, R>) =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<DemoSocketEndpoint>();
          backend.acceptor.accept((endpoint) => {
            Queue.offerUnsafe(queue, endpoint);
          });
          return yield* Queue.take(queue).pipe(
            Effect.flatMap((endpoint) =>
              Socket.fromWebSocket(
                Effect.succeed(endpoint as unknown as globalThis.WebSocket),
              ).pipe(Effect.flatMap((socket) => Effect.forkChild(handler(socket)))),
            ),
            Effect.forever,
          );
        }),
    }),
  );
}

export function startDemoServer(): void {
  installDemoNetworkInterceptors();

  for (const backend of demoBackends) {
    const serverLayer = RpcServer.layer(WsRpcGroup, { disableTracing: true }).pipe(
      Layer.provide(makeHandlersLayer(backend)),
      Layer.provide(RpcServer.layerProtocolSocketServer),
      Layer.provide(makeSocketServerLayer(backend)),
      Layer.provide(RpcSerialization.layerJson),
    );
    Effect.runFork(Layer.launch(serverLayer));
  }
}
