import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type RuntimeMode } from "@t3tools/contracts";
import { act, createElement } from "react";
import { create } from "react-test-renderer";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
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
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
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
    select: (location: { hash: string; pathname: string }) => unknown;
  }) => select({ hash: "", pathname: testState.router.state.location.href }),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ authGateState: { status: "server" } }),
  }),
  Link: "a",
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
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
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
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
vi.mock("../state/entities", () => {
  const projects = [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ];
  return {
    readProjects: () => projects,
    readThreadShell: () => null,
    useProjects: () => projects,
    useThreadShells: () => [],
    useAllEnvironmentShellsBootstrapped: () => true,
    useThread: () => null,
  };
});
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
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => null }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () =>
      testState.connectionPhase === null
        ? null
        : {
            connection: { phase: testState.connectionPhase },
            entry: { target: { label: "Build box" } },
          },
  },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => "environment-presentation" },
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: <T>(input: T) => input,
  toastManager: { add: testState.toast },
}));

import { useNewThreadHandler } from "./useHandleNewThread";
import * as newThread from "./useHandleNewThread";
import { Route } from "../routes/_chat.index";
import { Route as WelcomeRoute } from "../routes/welcome";

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
