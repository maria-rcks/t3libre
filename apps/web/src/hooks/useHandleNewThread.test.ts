import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import type { HistoryState } from "@tanstack/react-router";
import { act, createElement } from "react";
import { create } from "react-test-renderer";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null as ModelSelection | null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  let historyKey = 0;
  const location = {
    href: "/",
    state: { __TSR_key: "initial" } as HistoryState & { __TSR_key: string },
  };
  const previousLocations: (typeof location)[] = [];
  const router = {
    state: {
      location,
      matches: [{ params: {} as Record<string, string> }],
    },
    history: {
      location,
      replace: vi.fn((href: string, state: HistoryState) => {
        location.href = href;
        location.state = { ...state, __TSR_key: `history-${++historyKey}` };
      }),
      back: () => {
        const previous = previousLocations.pop();
        if (previous) Object.assign(location, previous);
      },
    },
    navigate: vi.fn(
      async (request: {
        readonly to: string;
        readonly params?: {
          readonly draftId?: string;
          readonly threadId?: string;
          readonly environmentId?: string;
        };
        readonly state?: HistoryState;
        readonly replace?: boolean;
      }) => {
        if (!request.replace) previousLocations.push({ ...location, state: { ...location.state } });
        location.href =
          request.to === "/draft/$draftId"
            ? `/draft/${request.params?.draftId}`
            : request.to === "/$environmentId/$threadId"
              ? `/environment-ssh/${request.params?.threadId}`
              : request.to;
        location.state = { ...request.state, __TSR_key: `history-${++historyKey}` };
        router.state.matches[0]!.params = request.params ? { ...request.params } : {};
      },
    ),
  };
  const defaultProject = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  const draftStore = {
    getComposerDraft: vi.fn((_key?: unknown) => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };

  return {
    connectionPhase: "connected" as
      | "connected"
      | "connecting"
      | "reconnecting"
      | "disconnected"
      | null,
    toast: vi.fn(),
    projectFileReads: vi.fn(),
    projects: [defaultProject],
    bootstrapped: true,
    nearbyThreads: true,
    resolveRouteTargets: false,
    archiveShell: null as { environmentId: string; projectId: string } | null,
    archive:
      vi.fn<
        () => Promise<{ _tag: "Success"; value: undefined } | { _tag: "Failure"; cause: unknown }>
      >(),
    unarchive:
      vi.fn<
        () => Promise<{ _tag: "Success"; value: undefined } | { _tag: "Failure"; cause: unknown }>
      >(),
    archiveNotice: vi.fn<(notice: { undo: () => Promise<unknown> }) => void>(),
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.state.location.state = { __TSR_key: `history-${++historyKey}` };
      router.state.matches[0]!.params = {};
      router.navigate.mockClear();
      router.history.replace.mockClear();
      previousLocations.length = 0;
      this.projects = [defaultProject];
      this.bootstrapped = true;
      this.nearbyThreads = true;
      this.resolveRouteTargets = false;
      this.archiveShell = null;
      this.archive.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
      this.unarchive.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
      this.archiveNotice.mockClear();
      this.projectFileReads.mockReset();
      this.toast.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      draftStore.getComposerDraft.mockReset().mockReturnValue({});
      draftStore.setModelSelection.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
    previousLocations,
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : new Map([
          [
            "environment-primary",
            {
              settings: {
                ...testState.targetSettings,
                newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
              },
            },
          ],
          ["environment-ssh", { settings: testState.targetSettings }],
        ]),
}));
vi.mock("@t3tools/client-runtime/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/environment")>()),
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/contracts")>()),
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  // Environment settings pass through; the tests set project fields on the
  // project record, which the hook still honors until the server folds them.
  // With a file argument the env mode resolves like the real chain.
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useParams: () => null,
  useRouter: () => testState.router,
  useNavigate: () => testState.router.navigate,
  useLocation: ({
    select,
  }: {
    select: (location: { hash: string; pathname: string; state: HistoryState }) => unknown;
  }) =>
    select({
      hash: "",
      pathname: testState.router.state.location.href,
      state: testState.router.state.location.state,
    }),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ authGateState: { status: "server" } }),
  }),
  Link: "a",
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
}));
vi.mock("../components/Sidebar.logic", () => ({
  orderItemsByPreferredIds: () => [],
  sortScopedProjectsForSidebar: <T>(projects: T) => projects,
}));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    finalizePromotedDraftThreadByRef: vi.fn(),
    useBackgroundDraftSubmissionPending: () => false,
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => {
    testState.projectFileReads();
    return testState.projectFileRead;
  },
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => testState.projects,
  readThreadShell: (ref: { threadId: string }) =>
    ref.threadId === "archive-last" ? testState.archiveShell : null,
  useProjects: () => testState.projects,
  useThreadShells: () => [],
  useAllEnvironmentShellsBootstrapped: () => testState.bootstrapped,
  useThread: () => null,
  useThreadShell: () => testState.archiveShell,
  useThreadRefs: () => [],
  useEnvironmentThreadRefs: () =>
    testState.nearbyThreads
      ? [{ environmentId: "environment-ssh", threadId: "nearby-thread" }]
      : [],
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { snapshot: { _tag: "Some" } } }),
}));
vi.mock("../components/ChatView", () => ({ default: "article" }));
vi.mock("../components/ChatView.logic", () => ({
  threadHasStarted: () => false,
  resolveDraftPromotionNavigationTarget: () => null,
}));
vi.mock("../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: true }),
}));
vi.mock("../components/NoProjectsHero", () => ({ NoProjectsHero: () => null }));
vi.mock("../components/onboarding/WelcomeWizard", () => ({ WelcomeWizard: "dialog" }));
vi.mock("../components/WorkspacePageHeader", () => ({ WorkspacePageHeader: () => null }));
vi.mock("../components/ui/button", () => ({ Button: "button" }));
vi.mock("../components/ui/sidebar", () => ({ SidebarInset: "main" }));
vi.mock("../components/ui/empty", () => ({
  Empty: "section",
  EmptyDescription: "p",
  EmptyHeader: "header",
  EmptyTitle: "h1",
}));
vi.mock("../components/ui/refresh-icon", () => ({ RefreshIcon: "svg" }));
vi.mock("../localEnvironment", () => ({ isLocalEnvironmentDisabled: () => false }));
vi.mock("../env", () => ({ isElectron: false }));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", async (importOriginal) => {
  const original = await importOriginal<typeof import("../threadRoutes")>();
  return {
    ...original,
    resolveThreadRouteTarget: (params: Parameters<typeof original.resolveThreadRouteTarget>[0]) =>
      testState.resolveRouteTargets ? original.resolveThreadRouteTarget(params) : null,
  };
});
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));
vi.mock("../terminalUiStateStore", () => ({ useTerminalUiStateStore: () => vi.fn() }));
vi.mock("../lib/archivedThreadsState", () => ({ refreshArchivedThreadsForEnvironment: vi.fn() }));
vi.mock("./showThreadUndoNotice", () => ({ showThreadUndoNotice: testState.archiveNotice }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === threadEnvironment.archive
      ? testState.archive
      : command === threadEnvironment.unarchive
        ? testState.unarchive
        : vi.fn(),
}));

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      testState.connectionPhase === null
        ? null
        : {
            connection: {
              phase: atom === "environment-primary" ? "connected" : testState.connectionPhase,
            },
            entry: { target: { label: "Build box" } },
          },
  },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationAtom: (environmentId: string) => environmentId },
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: <T>(input: T) => input,
  toastManager: { add: testState.toast },
}));

import { useNewThreadHandler } from "./useHandleNewThread";
import { useThreadActions } from "./useThreadActions";
import { threadEnvironment } from "../state/threads";
import * as newThread from "./useHandleNewThread";
import { Route } from "../routes/_chat.index";
import { Route as WelcomeRoute } from "../routes/welcome";
import { ThreadRouteView } from "../components/ThreadRouteView";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each([false, true])(
    "keeps physical checkout selection intent (manual: %s)",
    async (manual) => {
      testState.reset(draft);
      const actual =
        await vi.importActual<typeof import("../composerDraftStore")>("../composerDraftStore");
      actual.useComposerDraftStore.setState({
        draftsByThreadKey: {},
        draftThreadsByThreadKey: {},
        logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      });
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-worktree",
      } as never;
      const store = actual.useComposerDraftStore.getState();
      if (draft) {
        store.setLogicalProjectDraftThreadId(
          "remote-project",
          { environmentId: "environment-ssh", projectId: "project-remote" } as never,
          actual.DraftId.make(draft.draftId),
          {
            threadId: draft.threadId as never,
            environmentSelection: "auto",
            loadBalancedEnvironmentId: "previous-environment" as never,
          },
        );
      }
      testState.draftStore.setLogicalProjectDraftThreadId.mockImplementation(
        store.setLogicalProjectDraftThreadId as never,
      );
      try {
        const opened = await useNewThreadHandler()(
          projectRef,
          manual ? { environmentSelection: "manual" } : undefined,
        );
        expect(store.getDraftThread(opened!.draftId)).toMatchObject({
          environmentId: "environment-ssh",
          projectId: "project-worktree",
        });
        expect(store.getDraftThread(opened!.draftId)?.environmentSelection).toBe(
          manual ? "manual" : draft ? "auto" : undefined,
        );
        if (manual)
          expect(store.getDraftThread(opened!.draftId)?.loadBalancedEnvironmentId).toBeNull();
      } finally {
        testState.draftStore.setLogicalProjectDraftThreadId.mockReset();
      }
    },
  );

  it.each(["connecting", "reconnecting", "disconnected", null] as const)(
    "reports an unavailable %s environment without reading defaults or changing the draft",
    async (phase) => {
      testState.reset(draft);
      testState.toast.mockClear();
      testState.projectFileReads.mockClear();
      testState.targetSettings.defaultThreadEnvMode = null;
      // Read connection state at invocation, including a disconnect after
      // the picker rendered and captured its handler.
      const openThread = useNewThreadHandler();
      testState.connectionPhase = phase;
      try {
        const pendingOpen = openThread({
          environmentId: "environment-ssh",
          projectId: "project-remote",
        } as never);

        expect(testState.projectFileReads).not.toHaveBeenCalled();
        expect(await pendingOpen).toBeNull();
        expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
        expect(testState.router.navigate).not.toHaveBeenCalled();
        expect(testState.toast).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error", title: "Environment unavailable" }),
        );
      } finally {
        testState.connectionPhase = "connected";
      }
    },
  );

  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );
});

it("shows the index retry action after an unavailable result and opens the same checkout after reconnect", async () => {
  testState.reset(null);
  testState.toast.mockClear();
  testState.connectionPhase = "disconnected";
  const openThread = useNewThreadHandler();
  const handler = vi.spyOn(newThread, "useNewThreadHandler").mockReturnValue(openThread);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await Route.options.component!.preload?.();
  const renderer = await act(async () => create(createElement(Route.options.component!)));
  try {
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Environment unavailable" }),
    );
    expect(renderer.toJSON()).not.toBeNull();
    const retry = renderer.root.findByType("button");
    expect(retry.children).toContain("Try again");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    testState.connectionPhase = "connected";
    await act(async () => retry.props.onClick());
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      { environmentId: "environment-ssh", projectId: "project-remote" },
      "draft-delayed",
      expect.anything(),
    );
  } finally {
    await act(async () => renderer.unmount());
    handler.mockRestore();
    testState.connectionPhase = "connected";
    vi.unstubAllGlobals();
  }
});

it("keeps welcome open when an imported checkout is unavailable and retries that checkout after reconnect", async () => {
  testState.reset(null);
  testState.toast.mockClear();
  testState.projectFileReads.mockClear();
  testState.connectionPhase = "disconnected";
  testState.router.state.location.href = "/welcome";
  const projectRef = {
    environmentId: EnvironmentId.make("environment-ssh"),
    projectId: ProjectId.make("project-remote"),
  };
  const openThread = useNewThreadHandler();
  const handler = vi.spyOn(newThread, "useNewThreadHandler").mockReturnValue(openThread);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await WelcomeRoute.options.component!.preload?.();
  const renderer = await act(async () => create(createElement(WelcomeRoute.options.component!)));
  try {
    const wizard = renderer.root.findByType("dialog");
    await act(async () => wizard.props.onDone(projectRef));
    expect(renderer.root.findByType("dialog")).toBe(wizard);
    expect(testState.router.state.location.href).toBe("/welcome");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.projectFileReads).not.toHaveBeenCalled();
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Environment unavailable" }),
    );
    testState.connectionPhase = "connected";
    await act(async () => wizard.props.onDone(projectRef));
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(renderer.root.findAllByType("dialog")).toHaveLength(0);
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.anything(),
    );
  } finally {
    await act(async () => renderer.unmount());
    handler.mockRestore();
    testState.connectionPhase = "connected";
    vi.unstubAllGlobals();
  }
});

describe("archive draft recovery", () => {
  const target = {
    environmentId: EnvironmentId.make("environment-ssh"),
    threadId: ThreadId.make("archive-last"),
  };
  const projectRef = {
    environmentId: target.environmentId,
    projectId: ProjectId.make("project-remote"),
  };
  let actions: ReturnType<typeof useThreadActions>;
  let renderer: ReturnType<typeof create>;

  function Probe() {
    actions = useThreadActions();
    return createElement(ThreadRouteView, { target: { kind: "server", threadRef: target } });
  }

  beforeEach(async () => {
    testState.reset(null);
    testState.connectionPhase = "connected";
    testState.archiveShell = projectRef;
    testState.router.state.location.href = "/environment-ssh/archive-last";
    testState.router.state.matches[0]!.params = target;
    testState.projects.unshift({
      ...testState.projects[0]!,
      environmentId: "environment-primary",
      id: "project-other",
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await Route.options.component!.preload?.();
    renderer = await act(async () => create(createElement(Probe)));
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it("retains the archived checkout after disconnect and retries that same checkout", async () => {
    let resolveArchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const archiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveArchive = resolve;
    });
    testState.archive.mockReturnValueOnce(archiveDone);
    const pendingArchive = actions.archiveThread(target);
    await act(async () => {
      testState.connectionPhase = "reconnecting";
      testState.archiveShell = null;
      renderer.update(createElement(Probe));
    });
    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
    resolveArchive({ _tag: "Success", value: undefined });
    await pendingArchive;

    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
    expect(testState.projectFileReads).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
    await act(async () => renderer.update(createElement(Route.options.component!)));
    const retry = renderer.root.findByType("button");
    expect(retry.children).toContain("Try again");
    expect(renderer.toJSON()).not.toBeNull();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();

    await act(async () => retry.props.onClick());
    expect(testState.projectFileReads).not.toHaveBeenCalled();
    expect(testState.router.state.location.href).toBe("/");
    testState.connectionPhase = "connected";
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
    expect(testState.archive).toHaveBeenCalledOnce();
  });

  it("preserves user navigation during the archive rpc", async () => {
    let resolveArchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const archiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveArchive = resolve;
    });
    testState.archive.mockReturnValueOnce(archiveDone);
    const pendingArchive = actions.archiveThread(target);
    await testState.router.navigate({ to: "/usage" });
    testState.connectionPhase = "reconnecting";
    resolveArchive({ _tag: "Success", value: undefined });
    await pendingArchive;
    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.state.location.state.archiveDraftRetry).toBeUndefined();
    expect(testState.router.navigate).toHaveBeenCalledOnce();
    expect(testState.toast).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
    testState.archiveShell = null;
    testState.router.history.back();
    await act(async () => renderer.update(createElement(Probe)));
    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
  });

  it("recovers the archived checkout when back reaches the missing thread", async () => {
    await actions.archiveThread(target);
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledOnce();
    testState.archiveShell = null;
    testState.router.history.back();
    await act(async () => renderer.update(createElement(Probe)));
    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
  });

  it("clears archive recovery context when its rpc fails", async () => {
    testState.archive.mockResolvedValueOnce({
      _tag: "Failure",
      cause: new Error("archive failed"),
    });
    const result = await actions.archiveThread(target);
    expect(result._tag).toBe("Failure");
    expect(testState.router.state.location.href).toBe("/environment-ssh/archive-last");
    expect(testState.router.state.location.state.archiveDraftRetry).toBeUndefined();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.archiveNotice).not.toHaveBeenCalled();
  });

  it("automatically opens the exact checkout when its missing-thread redirect precedes the rpc", async () => {
    let resolveArchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const archiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveArchive = resolve;
    });
    testState.archive.mockReturnValueOnce(archiveDone);
    const pendingArchive = actions.archiveThread(target);
    testState.archiveShell = null;
    await act(async () => renderer.update(createElement(Probe)));
    expect(testState.router.state.location.href).toBe("/");
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
    resolveArchive({ _tag: "Success", value: undefined });
    await pendingArchive;
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledOnce();
    expect(testState.toast).not.toHaveBeenCalled();
  });

  it("keeps the last archived thread's checkout available to retry", async () => {
    testState.nearbyThreads = false;
    let resolveArchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const archiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveArchive = resolve;
    });
    testState.archive.mockReturnValueOnce(archiveDone);
    const pendingArchive = actions.archiveThread(target);
    testState.connectionPhase = "reconnecting";
    testState.archiveShell = null;
    await act(async () => renderer.update(createElement(Probe)));
    expect(testState.router.state.location.href).toBe("/");
    await act(async () => renderer.update(createElement(Route.options.component!)));
    resolveArchive({ _tag: "Success", value: undefined });
    await pendingArchive;
    expect(renderer.root.findByType("button").props.disabled).toBe(false);
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("keeps ordinary missing-thread recovery free of archive context", async () => {
    testState.archiveShell = null;
    await act(async () => renderer.update(createElement(Probe)));
    expect(testState.router.state.location.href).toBe("/");
    expect(testState.router.state.location.state.archiveDraftRetry).toBeUndefined();
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "carries the archived thread's working mode and model (early redirect: %s, configured model: %s)",
    async (early, configured) => {
      testState.resolveRouteTargets = true;
      const { useComposerDraftStore: realComposerDraftStore } =
        await vi.importActual<typeof import("../composerDraftStore")>("../composerDraftStore");
      const originStore = realComposerDraftStore.getState();
      const carriedSelection = {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "carried-model",
      };
      const configuredSelection = {
        instanceId: ProviderInstanceId.make("codex"),
        model: "configured-model",
      };
      testState.targetSettings.defaultModelSelection = configured ? configuredSelection : null;
      originStore.clearDraftThread(target);
      originStore.setInteractionMode(target, "plan");
      originStore.setModelSelection(target, carriedSelection, { explicit: true });
      testState.draftStore.getComposerDraft.mockImplementation((key) =>
        typeof key === "object" &&
        key !== null &&
        "threadId" in key &&
        key.threadId === target.threadId
          ? (realComposerDraftStore.getState().getComposerDraft(target) ?? {})
          : {},
      );
      let resolveArchive!: (value: { _tag: "Success"; value: undefined }) => void;
      testState.archive.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
      );
      const pendingArchive = actions.archiveThread(target);
      testState.archiveShell = null;
      expect(originStore.getComposerDraft(target)?.interactionMode).toBe("plan");
      expect(
        originStore.getComposerDraft(target)?.modelSelectionByProvider[carriedSelection.instanceId],
      ).toEqual(carriedSelection);
      if (early) {
        await act(async () => renderer.update(createElement(Probe)));
        await act(async () => renderer.update(createElement(Route.options.component!)));
      }
      resolveArchive({ _tag: "Success", value: undefined });
      await pendingArchive;
      expect.soft(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        "draft-delayed",
        expect.objectContaining({
          interactionMode: "plan",
          runtimeMode: "full-access",
          envMode: "local",
        }),
      );
      expect
        .soft(testState.draftStore.setModelSelection)
        .toHaveBeenCalledWith(
          "draft-delayed",
          configured ? configuredSelection : carriedSelection,
          { replaceOptions: true },
        );
      originStore.clearDraftThread(target);
    },
  );

  it("does not turn a stale draft result into an archive retry", async () => {
    testState.targetSettings.defaultThreadEnvMode = null;
    let resolveReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      resolveReadStarted = resolve;
    });
    testState.projectFileReads.mockImplementationOnce(() => resolveReadStarted());
    const pendingArchive = actions.archiveThread(target);
    await readStarted;
    await testState.router.navigate({ to: "/usage" });
    testState.completeProjectFileRead(null);
    await pendingArchive;
    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.state.location.state.archiveDraftRetry).toBeUndefined();
    expect(testState.router.navigate).toHaveBeenCalledOnce();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("cancels a pending recovery retry as soon as undo starts", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    await act(async () => renderer.update(createElement(Route.options.component!)));
    testState.connectionPhase = "connected";
    testState.targetSettings.defaultThreadEnvMode = null;
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(testState.projectFileReads).toHaveBeenCalledOnce();
    let resolveUnarchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const unarchiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveUnarchive = resolve;
    });
    testState.unarchive.mockReturnValueOnce(unarchiveDone);
    const undo = testState.archiveNotice.mock.lastCall![0].undo();
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(renderer.root.findByType("button").props.disabled).toBe(true);
    await act(async () => testState.completeProjectFileRead(null));
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
    expect(testState.router.state.location.href).toBe("/");
    resolveUnarchive({ _tag: "Success", value: undefined });
    await undo;
    expect(testState.router.state.location.href).toBe("/environment-ssh/archive-last");
  });

  it("does not overwrite navigation after undo starts", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    let resolveUnarchive!: (value: { _tag: "Success"; value: undefined }) => void;
    const unarchiveDone = new Promise<{ _tag: "Success"; value: undefined }>((resolve) => {
      resolveUnarchive = resolve;
    });
    testState.unarchive.mockReturnValueOnce(unarchiveDone);
    const undo = testState.archiveNotice.mock.lastCall![0].undo();
    await testState.router.navigate({ to: "/usage" });
    resolveUnarchive({ _tag: "Success", value: undefined });
    await undo;
    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.state.location.state.archiveDraftRetry).toBeUndefined();
  });

  it("retries the same checkout after undo fails", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    await act(async () => renderer.update(createElement(Route.options.component!)));
    testState.unarchive.mockResolvedValueOnce({ _tag: "Failure", cause: new Error("undo failed") });
    await testState.archiveNotice.mock.lastCall![0].undo();
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(renderer.root.findByType("button").props.disabled).toBe(false);
    testState.connectionPhase = "connected";
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
  });

  it("can recover the checkout after successful undo and back", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    await act(async () => renderer.update(createElement(Route.options.component!)));
    await testState.archiveNotice.mock.lastCall![0].undo();
    await act(async () => renderer.update(createElement(Probe)));
    testState.connectionPhase = "connected";
    testState.router.history.back();
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
  });

  it("keeps retry available after unarchiving without navigation", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    await act(async () => renderer.update(createElement(Route.options.component!)));
    await actions.unarchiveThread(target);
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(testState.router.state.location.href).toBe("/");
    expect(renderer.root.findByType("button").props.disabled).toBe(false);
    testState.connectionPhase = "connected";
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      projectRef,
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
  });

  it("keeps a removed recovery checkout visible without opening another project", async () => {
    testState.connectionPhase = "reconnecting";
    await actions.archiveThread(target);
    testState.projects = testState.projects.filter(
      (project) => project.id !== projectRef.projectId,
    );
    testState.connectionPhase = "connected";
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(renderer.toJSON()).not.toBeNull();
    expect(renderer.root.findByType("button").props.disabled).toBe(true);
    expect(testState.router.state.location.state.archiveDraftRetry?.projectRef).toEqual(projectRef);
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("keeps ordinary index startup on its most recent project", async () => {
    testState.router.state.location.href = "/";
    await act(async () => renderer.update(createElement(Route.options.component!)));
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledExactlyOnceWith(
      "remote-project",
      { environmentId: "environment-primary", projectId: "project-other" },
      "draft-delayed",
      expect.objectContaining({ envMode: "local" }),
    );
    expect(testState.router.state.location.href).toBe("/draft/draft-delayed");
    expect(testState.archive).not.toHaveBeenCalled();
  });
});
