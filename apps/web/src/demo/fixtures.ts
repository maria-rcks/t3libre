import {
  ExecutionEnvironmentDescriptor,
  OrchestrationShellSnapshot,
  ServerConfig,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Schema from "effect/Schema";

export const DEMO_ENVIRONMENT_ID = "demo-environment";
export const DEMO_ENVIRONMENT_LABEL = "T3 Code Demo";

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const demoDescriptor: ExecutionEnvironmentDescriptor = Schema.decodeUnknownSync(
  ExecutionEnvironmentDescriptor,
)({
  environmentId: DEMO_ENVIRONMENT_ID,
  label: DEMO_ENVIRONMENT_LABEL,
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: import.meta.env.APP_VERSION || "0.0.0",
  capabilities: { repositoryIdentity: false },
});

interface DemoThreadSpec {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly model: string;
  readonly branch: string | null;
  readonly createdMinutesAgo: number;
  readonly updatedMinutesAgo: number;
  readonly turn?: {
    readonly state: "running" | "completed" | "interrupted" | "error";
    readonly startedMinutesAgo?: number;
    readonly completedMinutesAgo?: number;
  };
  readonly sessionStatus?: "running" | "ready" | "idle";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly hasActionableProposedPlan?: boolean;
}

function demoThread(spec: DemoThreadSpec) {
  const updatedAt = minutesAgo(spec.updatedMinutesAgo);
  return {
    id: spec.id,
    projectId: spec.projectId,
    title: spec.title,
    modelSelection: { instanceId: "codex", model: spec.model },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: spec.branch,
    worktreePath: null,
    latestTurn: spec.turn
      ? {
          turnId: `${spec.id}-turn-1`,
          state: spec.turn.state,
          requestedAt: minutesAgo(spec.turn.startedMinutesAgo ?? spec.updatedMinutesAgo),
          startedAt: minutesAgo(spec.turn.startedMinutesAgo ?? spec.updatedMinutesAgo),
          completedAt:
            spec.turn.state === "running"
              ? null
              : minutesAgo(spec.turn.completedMinutesAgo ?? spec.updatedMinutesAgo),
          assistantMessageId: null,
        }
      : null,
    createdAt: minutesAgo(spec.createdMinutesAgo),
    updatedAt,
    archivedAt: null,
    session: spec.sessionStatus
      ? {
          threadId: spec.id,
          status: spec.sessionStatus,
          providerName: "Codex",
          providerInstanceId: "codex",
          runtimeMode: "full-access",
          activeTurnId: spec.turn?.state === "running" ? `${spec.id}-turn-1` : null,
          lastError: null,
          updatedAt,
        }
      : null,
    latestUserMessageAt: minutesAgo(spec.updatedMinutesAgo + 1),
    hasPendingApprovals: spec.hasPendingApprovals ?? false,
    hasPendingUserInput: spec.hasPendingUserInput ?? false,
    hasActionableProposedPlan: spec.hasActionableProposedPlan ?? false,
  };
}

const demoProjects = [
  {
    id: "project-t3code",
    title: "t3code",
    workspaceRoot: "~/code/t3code",
    defaultModelSelection: { instanceId: "codex", model: "gpt-5.2-codex" },
    scripts: [],
    createdAt: minutesAgo(60 * 24 * 30),
    updatedAt: minutesAgo(2),
  },
  {
    id: "project-marketing",
    title: "marketing-site",
    workspaceRoot: "~/code/marketing-site",
    defaultModelSelection: { instanceId: "claude", model: "claude-sonnet-4-5" },
    scripts: [],
    createdAt: minutesAgo(60 * 24 * 12),
    updatedAt: minutesAgo(25),
  },
  {
    id: "project-mobile",
    title: "mobile-app",
    workspaceRoot: "~/code/mobile-app",
    defaultModelSelection: { instanceId: "codex", model: "gpt-5.2-codex" },
    scripts: [],
    createdAt: minutesAgo(60 * 24 * 5),
    updatedAt: minutesAgo(60 * 3),
  },
];

const demoThreads = [
  demoThread({
    id: "thread-composer",
    projectId: "project-t3code",
    title: "Composer attachments + drag-drop overlay",
    model: "gpt-5.2-codex",
    branch: "feat/composer-attachments",
    createdMinutesAgo: 42,
    updatedMinutesAgo: 1,
    turn: { state: "running", startedMinutesAgo: 6 },
    sessionStatus: "running",
  }),
  demoThread({
    id: "thread-sidebar",
    projectId: "project-t3code",
    title: "Sidebar v2 polish — settled sort + jump hints",
    model: "gpt-5.2-codex",
    branch: "feat/sidebar-v2-polish",
    createdMinutesAgo: 60 * 5,
    updatedMinutesAgo: 12,
    turn: { state: "running", startedMinutesAgo: 14 },
    sessionStatus: "running",
    hasPendingApprovals: true,
  }),
  demoThread({
    id: "thread-flaky",
    projectId: "project-t3code",
    title: "Fix flaky GitManager cross-repo test",
    model: "claude-sonnet-4-5",
    branch: "fix/git-manager-test",
    createdMinutesAgo: 60 * 8,
    updatedMinutesAgo: 35,
    turn: { state: "completed", startedMinutesAgo: 48, completedMinutesAgo: 35 },
    sessionStatus: "ready",
  }),
  demoThread({
    id: "thread-hero",
    projectId: "project-marketing",
    title: "Interactive hero demo",
    model: "claude-sonnet-4-5",
    branch: "feat/hero-demo",
    createdMinutesAgo: 60 * 2,
    updatedMinutesAgo: 4,
    turn: { state: "running", startedMinutesAgo: 9 },
    sessionStatus: "running",
  }),
  demoThread({
    id: "thread-pricing",
    projectId: "project-marketing",
    title: "Pricing page copy refresh",
    model: "claude-sonnet-4-5",
    branch: null,
    createdMinutesAgo: 60 * 26,
    updatedMinutesAgo: 60 * 3,
    turn: { state: "completed", startedMinutesAgo: 60 * 4, completedMinutesAgo: 60 * 3 },
  }),
  demoThread({
    id: "thread-push",
    projectId: "project-mobile",
    title: "Push notifications deep links",
    model: "gpt-5.2-codex",
    branch: "feat/push-deeplinks",
    createdMinutesAgo: 60 * 30,
    updatedMinutesAgo: 60 * 20,
    turn: { state: "completed", startedMinutesAgo: 60 * 21, completedMinutesAgo: 60 * 20 },
  }),
];

export const demoShellSnapshot: OrchestrationShellSnapshot = Schema.decodeUnknownSync(
  OrchestrationShellSnapshot,
)({
  snapshotSequence: 1,
  projects: demoProjects,
  threads: demoThreads,
  updatedAt: minutesAgo(0),
});

const demoProviders = [
  {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.48.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex", isCustom: false, capabilities: null },
      { slug: "gpt-5.2", name: "GPT-5.2", isCustom: false, capabilities: null },
    ],
  },
  {
    instanceId: "claude",
    driver: "claude",
    displayName: "Claude Code",
    enabled: true,
    installed: true,
    version: "2.1.4",
    status: "ready",
    auth: { status: "authenticated", label: "API key" },
    checkedAt: minutesAgo(1),
    models: [
      {
        slug: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        isCustom: false,
        capabilities: null,
      },
      { slug: "claude-opus-4-5", name: "Claude Opus 4.5", isCustom: false, capabilities: null },
    ],
  },
];

const demoServerConfigBase: ServerConfig = Schema.decodeUnknownSync(ServerConfig)({
  environment: Schema.encodeSync(ExecutionEnvironmentDescriptor)(demoDescriptor),
  auth: {
    policy: "unsafe-no-auth",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "t3-demo-session",
  },
  cwd: "~/code",
  keybindingsConfigPath: "~/.t3/keybindings.json",
  keybindings: [],
  issues: [],
  providers: demoProviders,
  availableEditors: [],
  observability: {
    logsDirectoryPath: "~/.t3/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: {},
});

export const demoServerConfig: ServerConfig = {
  ...demoServerConfigBase,
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
};
