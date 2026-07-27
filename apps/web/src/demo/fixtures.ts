import {
  ExecutionEnvironmentDescriptor,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationShellSnapshot,
  OrchestrationThreadActivity,
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
  readonly instanceId?: string;
  readonly providerName?: string;
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
          providerName: spec.providerName ?? "Codex",
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
  };
}

const demoProjects = [
  {
    id: "project-t3code",
    title: "t3code",
    workspaceRoot: "~/code/t3code",
    defaultModelSelection: { instanceId: "claude", model: "claude-opus-4-5" },
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
    defaultModelSelection: { instanceId: "grok", model: "grok-code-fast-1" },
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
    model: "grok-code-fast-1",
    instanceId: "grok",
    providerName: "Grok",
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
    model: "kimi-k2-thinking",
    instanceId: "opencode",
    providerName: "OpenCode",
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
    model: "claude-opus-4-5",
    instanceId: "claude",
    providerName: "Claude Code",
    branch: "feat/hero-demo",
    createdMinutesAgo: 60 * 2,
    updatedMinutesAgo: 4,
    turn: { state: "running", startedMinutesAgo: 9 },
    sessionStatus: "running",
    hasPendingUserInput: true,
  }),
  demoThread({
    id: "thread-pricing",
    projectId: "project-marketing",
    title: "Pricing page copy refresh",
    model: "claude-sonnet-4-5",
    instanceId: "claude",
    providerName: "Claude Code",
    branch: null,
    createdMinutesAgo: 60 * 26,
    updatedMinutesAgo: 60 * 3,
    turn: { state: "completed", startedMinutesAgo: 60 * 4, completedMinutesAgo: 60 * 3 },
  }),
  demoThread({
    id: "thread-push",
    projectId: "project-mobile",
    title: "Push notifications deep links",
    model: "grok-code-fast-1",
    instanceId: "grok",
    providerName: "Grok",
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
    driver: "claudeAgent",
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
  {
    instanceId: "grok",
    driver: "grok",
    displayName: "Grok",
    enabled: true,
    installed: true,
    version: "1.6.2",
    status: "ready",
    auth: { status: "authenticated", label: "xAI" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "grok-code-fast-1", name: "Grok Code Fast 1", isCustom: false, capabilities: null },
      { slug: "grok-4-fast", name: "Grok 4 Fast", isCustom: false, capabilities: null },
    ],
  },
  {
    instanceId: "opencode",
    driver: "opencode",
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    version: "0.15.8",
    status: "ready",
    auth: { status: "authenticated", label: "OpenCode Zen" },
    checkedAt: minutesAgo(1),
    models: [
      { slug: "kimi-k2-thinking", name: "Kimi K2 Thinking", isCustom: false, capabilities: null },
      { slug: "qwen3-coder", name: "Qwen3 Coder", isCustom: false, capabilities: null },
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

export const demoThreadDetails: Record<string, DemoThreadDetail> = {
  "thread-composer": {
    messages: decodeMessages([
      message({
        id: "msg-composer-u1",
        role: "user",
        text: "Add image attachments to the composer — drag & drop should show an overlay, and pasted screenshots should attach too. Here's the mock:",
        turnId: "thread-composer-turn-0",
        minutesAgo: 41,
        attachments: [
          {
            id: "att-drag-overlay",
            name: "drag-overlay-mock.png",
            mimeType: "image/png",
            sizeBytes: 48213,
          },
        ],
      }),
      message({
        id: "msg-composer-a1",
        role: "assistant",
        text: [
          "Done — the composer now accepts image attachments in three ways:",
          "",
          "1. **Drag & drop** anywhere over the composer (a dashed overlay appears while hovering)",
          "2. **Paste** a screenshot straight from the clipboard",
          "3. The **`+` attach button**, which opens the native file picker",
          "",
          "Key change in `ChatComposer.tsx`:",
          "",
          "```tsx",
          "const dragDepthRef = useRef(0);",
          "const onComposerDragEnter = (event: DragEvent) => {",
          "  if (!hasImageFiles(event)) return;",
          "  dragDepthRef.current += 1;",
          "  setIsDragOverComposer(true);",
          "};",
          "```",
          "",
          "Attachments over 10 MB are rejected with an inline error instead of a toast, and drafts persist attachments across reloads via `composerDraftStore`.",
        ].join("\n"),
        turnId: "thread-composer-turn-0",
        minutesAgo: 22,
      }),
      message({
        id: "msg-composer-u2",
        role: "user",
        text: "Nice. Now make the drop overlay match the new dark theme and add a subtle backdrop blur.",
        turnId: "thread-composer-turn-1",
        minutesAgo: 6,
      }),
    ]),
    activities: decodeActivities([
      {
        id: "act-composer-test",
        tone: "tool",
        kind: "tool.completed",
        summary: "vp test run apps/web/src/components/chat/ChatComposer.test.tsx",
        payload: {
          status: "completed",
          detail: "vp test run apps/web/src/components/chat/ChatComposer.test.tsx",
        },
        turnId: "thread-composer-turn-0",
        sequence: 1,
        createdAt: minutesAgo(24),
      },
    ]),
    checkpoints: decodeCheckpoints([
      {
        turnId: "thread-composer-turn-0",
        checkpointTurnCount: 1,
        checkpointRef: "refs/t3/checkpoints/thread-composer/1",
        status: "ready",
        files: [
          {
            path: "apps/web/src/components/chat/ChatComposer.tsx",
            kind: "modified",
            additions: 182,
            deletions: 24,
          },
          {
            path: "apps/web/src/components/ChatView.tsx",
            kind: "modified",
            additions: 36,
            deletions: 5,
          },
          {
            path: "apps/web/src/composerDraftStore.ts",
            kind: "modified",
            additions: 54,
            deletions: 9,
          },
        ],
        assistantMessageId: "msg-composer-a1",
        completedAt: minutesAgo(22),
      },
    ]),
  },
  "thread-hero": {
    messages: decodeMessages([
      message({
        id: "msg-hero-u1",
        role: "user",
        text: "Replace the hero screenshot on the marketing site with a live demo of the actual app so visitors can click around.",
        turnId: "thread-hero-turn-1",
        minutesAgo: 110,
      }),
      message({
        id: "msg-hero-a1",
        role: "assistant",
        text: [
          "I can bundle the real app against fixture data — no duplicated markup, so the demo updates whenever the components do.",
          "",
          "### Plan",
          "- Build a standalone Vite entry that renders the real `AppRoot`",
          "- Mock only the transport boundary (WebSocket + `fetch`) with the production RPC contracts",
          "- Embed the generated bundle in the hero via an `iframe`",
          "",
          "One decision before I wire it up:",
        ].join("\n"),
        turnId: "thread-hero-turn-1",
        minutesAgo: 8,
      }),
    ]),
    activities: decodeActivities([
      {
        id: "act-hero-question",
        tone: "info",
        kind: "user-input.requested",
        summary: "Waiting for your answer",
        payload: {
          requestId: "req-hero-question",
          questions: [
            {
              id: "q-hero-layout",
              header: "Hero demo",
              question: "Which sidebar should the hero demo default to?",
              options: [
                {
                  label: "Sidebar v2 (flat list)",
                  description: "Showcase the new beta sidebar with rich active cards",
                },
                {
                  label: "Classic sidebar",
                  description: "Project-grouped v1 layout everyone already knows",
                },
              ],
              multiSelect: false,
            },
          ],
        },
        turnId: "thread-hero-turn-1",
        sequence: 2,
        createdAt: minutesAgo(4),
      },
    ]),
    checkpoints: decodeCheckpoints([]),
  },
  "thread-flaky": {
    messages: decodeMessages([
      message({
        id: "msg-flaky-u1",
        role: "user",
        text: "GitManager cross-repo PR metadata test is flaky in CI — times out at 12s roughly one run in five. Find it and fix it.",
        turnId: "thread-flaky-turn-1",
        minutesAgo: 60 * 7,
      }),
      message({
        id: "msg-flaky-a1",
        role: "assistant",
        text: [
          "Found it. The test raced the remote fetch against a fixed 12s timeout:",
          "",
          "- `GitManager.test.ts` spun up **two** temp repos but awaited their fixtures sequentially",
          "- The second `git fetch` occasionally started after the assertion deadline",
          "",
          "Fix: await both fixtures with `Promise.all` and assert on the settled result instead of polling. The test now completes in ~1.4s and passed 200 consecutive runs locally.",
        ].join("\n"),
        turnId: "thread-flaky-turn-1",
        minutesAgo: 35,
      }),
    ]),
    activities: decodeActivities([]),
    checkpoints: decodeCheckpoints([
      {
        turnId: "thread-flaky-turn-1",
        checkpointTurnCount: 1,
        checkpointRef: "refs/t3/checkpoints/thread-flaky/1",
        status: "ready",
        files: [
          {
            path: "apps/server/src/git/GitManager.test.ts",
            kind: "modified",
            additions: 38,
            deletions: 21,
          },
        ],
        assistantMessageId: "msg-flaky-a1",
        completedAt: minutesAgo(35),
      },
    ]),
  },
  "thread-sidebar": {
    messages: decodeMessages([
      message({
        id: "msg-sidebar-u1",
        role: "user",
        text: "Polish sidebar v2: settled threads should sort by settle time, and add the little jump hints when the active thread is scrolled out of view.",
        turnId: "thread-sidebar-turn-1",
        minutesAgo: 60 * 4,
      }),
      message({
        id: "msg-sidebar-a1",
        role: "assistant",
        text: [
          "Settled sort is in — settled rows now order by `settledAt` descending. Working on the jump hints next; I need to run the focused test suite to confirm the sort change:",
        ].join("\n"),
        turnId: "thread-sidebar-turn-1",
        minutesAgo: 16,
      }),
    ]),
    activities: decodeActivities([
      {
        id: "act-sidebar-approval",
        tone: "approval",
        kind: "approval.requested",
        summary: "Approval requested to run a command",
        payload: {
          requestId: "req-sidebar-test",
          requestKind: "command",
          detail: "vp test run apps/web/src/components/SidebarV2.test.tsx",
        },
        turnId: "thread-sidebar-turn-1",
        sequence: 3,
        createdAt: minutesAgo(14),
      },
    ]),
    checkpoints: decodeCheckpoints([]),
  },
};

// ---------------------------------------------------------------------------
// Asset fixtures (project favicons + message attachments)
// ---------------------------------------------------------------------------

export const demoProjectFaviconUrlByCwd: Record<string, string> = {
  "~/code/t3code": "https://www.google.com/s2/favicons?domain=t3.gg&sz=64",
  "~/code/marketing-site": "https://www.google.com/s2/favicons?domain=astro.build&sz=64",
  "~/code/mobile-app": "https://www.google.com/s2/favicons?domain=expo.dev&sz=64",
};

const dragOverlayMockSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">',
  '<rect width="640" height="400" fill="#101012"/>',
  '<rect x="24" y="24" width="180" height="352" rx="12" fill="#18181b"/>',
  '<rect x="228" y="24" width="388" height="352" rx="12" fill="#141417" stroke="#2e2e33" stroke-width="2" stroke-dasharray="8 6"/>',
  '<text x="422" y="196" fill="#9b9ba4" font-family="system-ui, sans-serif" font-size="17" text-anchor="middle">Drop images to attach</text>',
  '<text x="422" y="222" fill="#5c5c66" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle">PNG, JPEG or WebP — up to 10 MB</text>',
  "</svg>",
].join("");

export const demoAttachmentUrlById: Record<string, string> = {
  "att-drag-overlay": `data:image/svg+xml,${encodeURIComponent(dragOverlayMockSvg)}`,
};
