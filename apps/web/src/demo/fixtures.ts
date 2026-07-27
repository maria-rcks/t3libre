import {
  ExecutionEnvironmentDescriptor,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationShellSnapshot,
  OrchestrationThreadActivity,
  ReviewDiffPreviewResult,
  ServerConfig,
  ThreadTurnDiff,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  SHOWCASE_ENVIRONMENTS,
  SHOWCASE_PROJECTS,
  SHOWCASE_THREADS,
} from "../../../../scripts/mobile-showcase-fixtures";

export const DEMO_ENVIRONMENT_ID = "demo-environment";
export const DEMO_ENVIRONMENT_LABEL = SHOWCASE_ENVIRONMENTS[0].label;

const now = Date.now();
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

/** Sentinel wake time for "permanently" snoozed demo threads. */
const SNOOZE_FOREVER = "2099-01-01T09:00:00.000Z";

// ---------------------------------------------------------------------------
// Providers (shared across demo environments)
// ---------------------------------------------------------------------------

const demoProviders = [
  {
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.52.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
      { slug: "gpt-5.4-codex", name: "GPT-5.4 Codex", isCustom: false, capabilities: null },
    ],
  },
  {
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    displayName: "Claude Code",
    enabled: true,
    installed: true,
    version: "2.3.0",
    status: "ready",
    auth: { status: "authenticated", label: "API key" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "claude-opus-5", name: "Claude Opus 5", isCustom: false, capabilities: null },
      { slug: "claude-sonnet-5", name: "Claude Sonnet 5", isCustom: false, capabilities: null },
    ],
  },
  {
    instanceId: "grok",
    driver: "grok",
    displayName: "Grok",
    enabled: true,
    installed: true,
    version: "1.8.0",
    status: "ready",
    auth: { status: "authenticated", label: "xAI" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "grok-code-fast-2", name: "Grok Code Fast 2", isCustom: false, capabilities: null },
      { slug: "grok-5", name: "Grok 5", isCustom: false, capabilities: null },
    ],
  },
  {
    instanceId: "opencode",
    driver: "opencode",
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    version: "0.16.2",
    status: "ready",
    auth: { status: "authenticated", label: "OpenCode Zen" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "kimi-k2-thinking", name: "Kimi K2 Thinking", isCustom: false, capabilities: null },
      { slug: "glm-5", name: "GLM-5", isCustom: false, capabilities: null },
    ],
  },
];

// ---------------------------------------------------------------------------
// Thread + project fixture builders
// ---------------------------------------------------------------------------

interface DemoThreadSpec {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly model: string;
  readonly instanceId?: string;
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
  /** Marks the thread as explicitly settled this many minutes ago. */
  readonly settledMinutesAgo?: number;
  /** Snoozes the thread until the far-future sentinel ("permanently"). */
  readonly snoozedForever?: boolean;
}

function demoThread(spec: DemoThreadSpec) {
  const updatedAt = minutesAgo(spec.updatedMinutesAgo);
  return {
    id: spec.id,
    projectId: spec.projectId,
    title: spec.title,
    modelSelection: { instanceId: spec.instanceId ?? "codex", model: spec.model },
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
          // The wire providerName is the driver kind slug, not a display name.
          providerName: spec.instanceId ?? "codex",
          providerInstanceId: spec.instanceId ?? "codex",
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
    ...(spec.settledMinutesAgo !== undefined
      ? { settledOverride: "settled", settledAt: minutesAgo(spec.settledMinutesAgo) }
      : {}),
    ...(spec.snoozedForever
      ? { snoozedUntil: SNOOZE_FOREVER, snoozedAt: minutesAgo(spec.updatedMinutesAgo) }
      : {}),
  };
}

function decodeShellSnapshot(input: {
  projects: ReadonlyArray<unknown>;
  threads: ReadonlyArray<unknown>;
}): OrchestrationShellSnapshot {
  return Schema.decodeUnknownSync(OrchestrationShellSnapshot)({
    snapshotSequence: 1,
    projects: input.projects,
    threads: input.threads,
    updatedAt: minutesAgo(0),
  });
}

function makeServerConfig(descriptor: ExecutionEnvironmentDescriptor, cwd: string): ServerConfig {
  const base = Schema.decodeUnknownSync(ServerConfig)({
    environment: Schema.encodeSync(ExecutionEnvironmentDescriptor)(descriptor),
    auth: {
      policy: "unsafe-no-auth",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "t3-demo-session",
    },
    cwd,
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
  return { ...base, keybindings: DEFAULT_RESOLVED_KEYBINDINGS };
}

const demoCapabilities = {
  repositoryIdentity: false,
  threadSettlement: true,
  threadSnooze: true,
};

function makeDescriptor(input: {
  environmentId: string;
  label: string;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
}): ExecutionEnvironmentDescriptor {
  return Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)({
    environmentId: input.environmentId,
    label: input.label,
    platform: { os: input.os, arch: input.arch },
    serverVersion: import.meta.env.APP_VERSION || "0.0.0",
    capabilities: demoCapabilities,
  });
}

// ---------------------------------------------------------------------------
// Environments: one local (primary) + two remote machines over T3 Connect
// ---------------------------------------------------------------------------

export interface DemoEnvironmentFixture {
  readonly environmentId: string;
  readonly label: string;
  /** Fake HTTPS origin the environment is served from; null = same-origin primary. */
  readonly origin: string | null;
  readonly bearerToken: string | null;
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly serverConfig: ServerConfig;
  readonly shellSnapshot: OrchestrationShellSnapshot;
}

// ---------------------------------------------------------------------------
// Showcase dataset mapping (single source of truth shared with the mobile
// screenshot harness in scripts/mobile-showcase-fixtures.ts)
// ---------------------------------------------------------------------------

type ShowcaseThread = (typeof SHOWCASE_THREADS)[number];

const showcaseState = (thread: ShowcaseThread): "working" | "approval" | "plan" | undefined =>
  "state" in thread ? thread.state : undefined;

/** Spread showcase threads across every provider so the multi-agent story shows. */
const SHOWCASE_PROVIDER_OVERRIDES: Record<string, { instanceId: string; model: string }> = {
  "remote-command-center": { instanceId: "codex", model: "gpt-5.4" },
  "pocket-command-center": { instanceId: "claudeAgent", model: "claude-opus-5" },
  "buttery-suspense": { instanceId: "claudeAgent", model: "claude-opus-5" },
  "hydration-haikus": { instanceId: "grok", model: "grok-code-fast-2" },
  "beautiful-boot": { instanceId: "opencode", model: "kimi-k2-thinking" },
  "scheduler-breathe": { instanceId: "codex", model: "gpt-5.4" },
};

/** Completed showcase threads that recede into the settled shelf. */
const SHOWCASE_SETTLED_MINUTES: Record<string, number> = {
  "hydration-haikus": 20,
  "scheduler-breathe": 45,
};

function showcaseSpec(thread: ShowcaseThread): DemoThreadSpec {
  const state = showcaseState(thread);
  const active = state === "working" || state === "approval";
  const provider = SHOWCASE_PROVIDER_OVERRIDES[thread.id];
  const settledMinutesAgo = SHOWCASE_SETTLED_MINUTES[thread.id];
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    model: provider?.model ?? "gpt-5.4",
    ...(provider ? { instanceId: provider.instanceId } : {}),
    branch: thread.branch,
    createdMinutesAgo: thread.minutesAgo + 120,
    updatedMinutesAgo: thread.minutesAgo,
    turn: {
      state: active ? "running" : "completed",
      startedMinutesAgo: thread.minutesAgo + 2,
      completedMinutesAgo: thread.minutesAgo,
    },
    sessionStatus: active ? "running" : "ready",
    hasPendingApprovals: state === "approval",
    hasActionableProposedPlan: state === "plan",
    ...(settledMinutesAgo !== undefined ? { settledMinutesAgo } : {}),
  };
}

const showcaseThreadsFor = (projectId: string) =>
  SHOWCASE_THREADS.filter((thread) => thread.projectId === projectId).map((thread) =>
    demoThread(showcaseSpec(thread)),
  );

function showcaseProject(
  projectId: string,
  defaultModelSelection: { instanceId: string; model: string },
) {
  const project = SHOWCASE_PROJECTS.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Unknown showcase project: ${projectId}`);
  return {
    id: project.id,
    title: project.title,
    workspaceRoot: `~/Code/${project.directory}`,
    defaultModelSelection,
    scripts: [],
    createdAt: minutesAgo(60 * 24 * 30),
    updatedAt: minutesAgo(3),
  };
}

const [moonbaseEnvironment, suspenseEnvironment, kernelEnvironment] = SHOWCASE_ENVIRONMENTS;

const primaryDescriptor = makeDescriptor({
  environmentId: DEMO_ENVIRONMENT_ID,
  label: moonbaseEnvironment.label,
  os: "darwin",
  arch: "arm64",
});

const suspenseDescriptor = makeDescriptor({
  environmentId: suspenseEnvironment.id,
  label: suspenseEnvironment.label,
  os: "darwin",
  arch: "arm64",
});

const kernelDescriptor = makeDescriptor({
  environmentId: kernelEnvironment.id,
  label: kernelEnvironment.label,
  os: "linux",
  arch: "x64",
});

const moonbaseShell = decodeShellSnapshot({
  projects: [showcaseProject("t3code", { instanceId: "codex", model: "gpt-5.4" })],
  threads: [
    ...showcaseThreadsFor("t3code"),
    demoThread({
      id: "flaky-git-suite",
      projectId: "t3code",
      title: "Deflake the GitManager cross-repo suite",
      model: "kimi-k2-thinking",
      instanceId: "opencode",
      branch: "fix/git-manager-test",
      createdMinutesAgo: 60 * 24 * 6,
      updatedMinutesAgo: 60 * 24 * 2,
      turn: {
        state: "completed",
        startedMinutesAgo: 60 * 24 * 2 + 30,
        completedMinutesAgo: 60 * 24 * 2,
      },
      snoozedForever: true,
    }),
  ],
});

const suspenseShell = decodeShellSnapshot({
  projects: [showcaseProject("react", { instanceId: "claudeAgent", model: "claude-opus-5" })],
  threads: showcaseThreadsFor("react"),
});

const kernelShell = decodeShellSnapshot({
  projects: [showcaseProject("linux", { instanceId: "codex", model: "gpt-5.4" })],
  threads: [
    ...showcaseThreadsFor("linux"),
    demoThread({
      id: "perf-soak",
      projectId: "linux",
      title: "Nightly perf soak keeps paging on-call",
      model: "grok-5",
      instanceId: "grok",
      branch: null,
      createdMinutesAgo: 60 * 24 * 9,
      updatedMinutesAgo: 60 * 24 * 3,
      turn: {
        state: "completed",
        startedMinutesAgo: 60 * 24 * 3 + 40,
        completedMinutesAgo: 60 * 24 * 3,
      },
      snoozedForever: true,
    }),
  ],
});

export const demoEnvironments: ReadonlyArray<DemoEnvironmentFixture> = [
  {
    environmentId: DEMO_ENVIRONMENT_ID,
    label: moonbaseEnvironment.label,
    origin: null,
    bearerToken: null,
    descriptor: primaryDescriptor,
    serverConfig: makeServerConfig(primaryDescriptor, "~/Code"),
    shellSnapshot: moonbaseShell,
  },
  {
    environmentId: suspenseEnvironment.id,
    label: suspenseEnvironment.label,
    origin: "https://suspense-station.t3connect.demo",
    bearerToken: "demo-suspense-station-token",
    descriptor: suspenseDescriptor,
    serverConfig: makeServerConfig(suspenseDescriptor, "~/Code"),
    shellSnapshot: suspenseShell,
  },
  {
    environmentId: kernelEnvironment.id,
    label: kernelEnvironment.label,
    origin: "https://kernel-cabin.t3connect.demo",
    bearerToken: "demo-kernel-cabin-token",
    descriptor: kernelDescriptor,
    serverConfig: makeServerConfig(kernelDescriptor, "~/Code"),
    shellSnapshot: kernelShell,
  },
];

/** Backwards-compatible aliases for the primary environment. */
export const demoDescriptor = primaryDescriptor;
export const demoServerConfig = demoEnvironments[0]!.serverConfig;
export const demoShellSnapshot = moonbaseShell;

/** Threads that open with the browser (right side panel) already visible. */
export const demoBrowserPanelThreadKeys: ReadonlyArray<string> = [
  `${DEMO_ENVIRONMENT_ID}:remote-command-center`,
  `${suspenseEnvironment.id}:buttery-suspense`,
];

// The browser preview surface needs the Electron desktop bridge, so the web
// demo showcases the right panel with the diff surface instead.
const DEMO_UNIFIED_DIFF = `diff --git a/apps/mobile/src/features/home/environmentPresence.ts b/apps/mobile/src/features/home/environmentPresence.ts
index 4b1c9d2..8f27a51 100644
--- a/apps/mobile/src/features/home/environmentPresence.ts
+++ b/apps/mobile/src/features/home/environmentPresence.ts
@@ -1,3 +1,7 @@
-export function environmentLabel(count: number): string {
-  return \`\${count} environments\`;
+const PULSE = ["✦", "✧", "·", "✧"] as const;
+
+export function environmentLabel(connected: number, total: number, frame: number): string {
+  const pulse = PULSE[frame % PULSE.length];
+  return \`\${pulse} \${connected}/\${total} ready\`;
 }
diff --git a/apps/mobile/src/features/home/RemoteHandoffCard.tsx b/apps/mobile/src/features/home/RemoteHandoffCard.tsx
new file mode 100644
index 0000000..b2d61c4
--- /dev/null
+++ b/apps/mobile/src/features/home/RemoteHandoffCard.tsx
@@ -0,0 +1,10 @@
+import { View, Text } from "react-native";
+
+export function RemoteHandoffCard(props: { machine: string; latencyMs: number }) {
+  return (
+    <View className="rounded-2xl bg-surface-2 p-4">
+      <Text className="font-semibold">Ready on {props.machine}</Text>
+      <Text className="text-success">Handoff in {props.latencyMs}ms</Text>
+    </View>
+  );
+}
`;

const decodeThreadTurnDiff = Schema.decodeUnknownSync(ThreadTurnDiff);
const decodeReviewDiffPreview = Schema.decodeUnknownSync(ReviewDiffPreviewResult);

export function demoReviewDiffPreview(cwd: string): ReviewDiffPreviewResult {
  return decodeReviewDiffPreview({
    cwd,
    generatedAt: DateTime.makeUnsafe(minutesAgo(2)),
    sources: [
      {
        id: "branch-range",
        kind: "branch-range",
        title: "Branch changes",
        baseRef: "main",
        headRef: "feat/remote-command-center",
        diff: DEMO_UNIFIED_DIFF,
        diffHash: "demo-diff-hash",
        truncated: false,
      },
    ],
  });
}

export function demoThreadDiff(
  threadId: string,
  fromTurnCount: number,
  toTurnCount: number,
): typeof ThreadTurnDiff.Type {
  return decodeThreadTurnDiff({ threadId, fromTurnCount, toTurnCount, diff: DEMO_UNIFIED_DIFF });
}

// ---------------------------------------------------------------------------
// Thread histories (messages, activities, checkpoints)
// ---------------------------------------------------------------------------

const decodeMessages = Schema.decodeUnknownSync(Schema.Array(OrchestrationMessage));
const decodeActivities = Schema.decodeUnknownSync(Schema.Array(OrchestrationThreadActivity));
const decodeCheckpoints = Schema.decodeUnknownSync(Schema.Array(OrchestrationCheckpointSummary));

export interface DemoThreadDetail {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
}

function message(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId: string | null;
  minutesAgo: number;
  attachments?: ReadonlyArray<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}) {
  return {
    id: input.id,
    role: input.role,
    text: input.text,
    ...(input.attachments
      ? {
          attachments: input.attachments.map((attachment) => ({
            type: "image",
            ...attachment,
          })),
        }
      : {}),
    turnId: input.turnId,
    streaming: false,
    createdAt: minutesAgo(input.minutesAgo),
    updatedAt: minutesAgo(input.minutesAgo),
  };
}

// Base histories come straight from the showcase dataset (request/response per
// thread); the records below layer the richer web-only elements on top —
// extra turns, image attachments, tool/approval/question activities, and
// checkpoint diff boxes.

const EXTRA_LEAD_MESSAGES: Record<string, ReadonlyArray<unknown>> = {
  "remote-command-center": [
    message({
      id: "msg-remote-command-center-u0",
      role: "user",
      text: "Here's the mock for the handoff card I want on the home screen when another machine is ready:",
      turnId: "remote-command-center-turn-0",
      minutesAgo: 55,
      attachments: [
        {
          id: "att-remote-handoff",
          name: "remote-handoff-card-mock.png",
          mimeType: "image/png",
          sizeBytes: 51284,
        },
      ],
    }),
    message({
      id: "msg-remote-command-center-a0",
      role: "assistant",
      text: [
        "Got it — `RemoteHandoffCard` will render the machine name plus live latency:",
        "",
        "```tsx",
        "export function RemoteHandoffCard(props: { machine: string; latencyMs: number }) {",
        "  return (",
        '    <View className="rounded-2xl bg-surface-2 p-4">',
        '      <Text className="font-semibold">Ready on {props.machine}</Text>',
        '      <Text className="text-success">Handoff in {props.latencyMs}ms</Text>',
        "    </View>",
        "  );",
        "}",
        "```",
      ].join("\n"),
      turnId: "remote-command-center-turn-0",
      minutesAgo: 48,
    }),
  ],
};

const EXTRA_ACTIVITIES: Record<string, ReadonlyArray<unknown>> = {
  "remote-command-center": [
    {
      id: "act-remote-command-center-test",
      tone: "tool",
      kind: "tool.completed",
      summary: "vp test run --changed — 612 tests passed · 3 environments online",
      payload: {
        status: "completed",
        detail: "vp test run --changed",
      },
      turnId: "remote-command-center-turn-1",
      sequence: 1,
      createdAt: minutesAgo(5),
    },
  ],
  "pocket-command-center": [
    {
      id: "act-pocket-command-center-approval",
      tone: "approval",
      kind: "approval.requested",
      summary: "Approval requested to run a command",
      payload: {
        requestId: "req-pocket-motion",
        requestKind: "command",
        detail: "vp run mobile:handoff-motion --record",
      },
      turnId: "pocket-command-center-turn-1",
      sequence: 3,
      createdAt: minutesAgo(19),
    },
  ],
  "beautiful-boot": [
    {
      id: "act-beautiful-boot-question",
      tone: "info",
      kind: "user-input.requested",
      summary: "Waiting for your answer",
      payload: {
        requestId: "req-beautiful-boot-question",
        questions: [
          {
            id: "q-beautiful-boot-grouping",
            header: "Boot timeline",
            question: "How should the timeline group kernel milestones?",
            options: [
              {
                label: "By subsystem",
                description: "Cluster init lines under mm / sched / drivers headings",
              },
              {
                label: "Strictly chronological",
                description: "Keep raw ordering and only add elapsed-time markers",
              },
            ],
            multiSelect: false,
          },
        ],
      },
      turnId: "beautiful-boot-turn-1",
      sequence: 2,
      createdAt: minutesAgo(30),
    },
  ],
};

const EXTRA_CHECKPOINTS: Record<string, ReadonlyArray<unknown>> = {
  "remote-command-center": [
    {
      turnId: "remote-command-center-turn-0",
      checkpointTurnCount: 1,
      checkpointRef: "refs/t3/checkpoints/remote-command-center/1",
      status: "ready",
      files: [
        {
          path: "apps/mobile/src/features/home/RemoteHandoffCard.tsx",
          kind: "added",
          additions: 10,
          deletions: 0,
        },
      ],
      assistantMessageId: "msg-remote-command-center-a0",
      completedAt: minutesAgo(48),
    },
    {
      turnId: "remote-command-center-turn-1",
      checkpointTurnCount: 1,
      checkpointRef: "refs/t3/checkpoints/remote-command-center/2",
      status: "ready",
      files: [
        {
          path: "apps/mobile/src/features/home/environmentPresence.ts",
          kind: "modified",
          additions: 6,
          deletions: 2,
        },
        {
          path: "packages/client-runtime/src/connection/supervisor.ts",
          kind: "modified",
          additions: 41,
          deletions: 12,
        },
      ],
      assistantMessageId: "msg-remote-command-center-a1",
      completedAt: minutesAgo(3),
    },
  ],
  "hydration-haikus": [
    {
      turnId: "hydration-haikus-turn-1",
      checkpointTurnCount: 1,
      checkpointRef: "refs/t3/checkpoints/hydration-haikus/1",
      status: "ready",
      files: [
        {
          path: "packages/react-dom/src/client/ReactDOMHydrationDiagnostics.js",
          kind: "modified",
          additions: 42,
          deletions: 17,
        },
      ],
      assistantMessageId: "msg-hydration-haikus-a1",
      completedAt: minutesAgo(44),
    },
  ],
  "scheduler-breathe": [
    {
      turnId: "scheduler-breathe-turn-1",
      checkpointTurnCount: 1,
      checkpointRef: "refs/t3/checkpoints/scheduler-breathe/1",
      status: "ready",
      files: [
        {
          path: "kernel/sched/fair.c",
          kind: "modified",
          additions: 58,
          deletions: 33,
        },
      ],
      assistantMessageId: "msg-scheduler-breathe-a1",
      completedAt: minutesAgo(76),
    },
  ],
};

function showcaseDetail(thread: ShowcaseThread): DemoThreadDetail {
  const turnId = `${thread.id}-turn-1`;
  const baseMessages: Array<unknown> = [
    ...(EXTRA_LEAD_MESSAGES[thread.id] ?? []),
    message({
      id: `msg-${thread.id}-u1`,
      role: "user",
      text: thread.request,
      turnId,
      minutesAgo: thread.minutesAgo + 1,
    }),
  ];
  if (thread.response !== null) {
    baseMessages.push(
      message({
        id: `msg-${thread.id}-a1`,
        role: "assistant",
        text: thread.response,
        turnId,
        minutesAgo: thread.minutesAgo,
      }),
    );
  }
  return {
    messages: decodeMessages(baseMessages),
    activities: decodeActivities(EXTRA_ACTIVITIES[thread.id] ?? []),
    checkpoints: decodeCheckpoints(EXTRA_CHECKPOINTS[thread.id] ?? []),
  };
}

export const demoThreadDetails: Record<string, DemoThreadDetail> = {
  ...Object.fromEntries(SHOWCASE_THREADS.map((thread) => [thread.id, showcaseDetail(thread)])),
  "flaky-git-suite": {
    messages: decodeMessages([
      message({
        id: "msg-flaky-git-suite-u1",
        role: "user",
        text: "GitManager cross-repo PR metadata test is flaky in CI — times out at 12s roughly one run in five. Not urgent, snoozing this after your first pass.",
        turnId: "flaky-git-suite-turn-1",
        minutesAgo: 60 * 24 * 2 + 30,
      }),
      message({
        id: "msg-flaky-git-suite-a1",
        role: "assistant",
        text: "Found it — the test awaits two temp-repo fixtures sequentially, so the second `git fetch` occasionally starts after the 12s deadline. Fix is to provision both with `Promise.all` and only start the clock on the assertion. Parked until you unsnooze.",
        turnId: "flaky-git-suite-turn-1",
        minutesAgo: 60 * 24 * 2,
      }),
    ]),
    activities: decodeActivities([]),
    checkpoints: decodeCheckpoints([]),
  },
  "perf-soak": {
    messages: decodeMessages([
      message({
        id: "msg-perf-soak-u1",
        role: "user",
        text: "The nightly perf soak keeps paging on-call with false positives. Investigate when there's slack — snoozing.",
        turnId: "perf-soak-turn-1",
        minutesAgo: 60 * 24 * 3 + 40,
      }),
      message({
        id: "msg-perf-soak-a1",
        role: "assistant",
        text: "Initial findings: the soak compares against a fixed baseline captured on older hardware, so every run on the new rig trips the threshold. Rebaselining per-machine should silence the pages — parked until you unsnooze.",
        turnId: "perf-soak-turn-1",
        minutesAgo: 60 * 24 * 3,
      }),
    ]),
    activities: decodeActivities([]),
    checkpoints: decodeCheckpoints([]),
  },
};

// ---------------------------------------------------------------------------
// Asset fixtures (project favicons + message attachments)
// ---------------------------------------------------------------------------

const faviconDataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

export const demoProjectFaviconUrlByCwd: Record<string, string> = Object.fromEntries(
  SHOWCASE_PROJECTS.map((project) => [
    `~/Code/${project.directory}`,
    faviconDataUrl(project.favicon),
  ]),
);

const remoteHandoffMockSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">',
  '<rect width="640" height="400" fill="#101012"/>',
  '<rect x="140" y="110" width="360" height="180" rx="20" fill="#18181b" stroke="#2e2e33" stroke-width="2"/>',
  '<text x="320" y="185" fill="#e4e4e7" font-family="system-ui, sans-serif" font-size="20" font-weight="600" text-anchor="middle">Ready on Kernel Cabin</text>',
  '<text x="320" y="220" fill="#4ade80" font-family="system-ui, sans-serif" font-size="15" text-anchor="middle">Handoff in 38ms</text>',
  "</svg>",
].join("");

export const demoAttachmentUrlById: Record<string, string> = {
  "att-remote-handoff": `data:image/svg+xml,${encodeURIComponent(remoteHandoffMockSvg)}`,
};
