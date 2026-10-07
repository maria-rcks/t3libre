import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Notification,
  type OrchestrationV2UserMessageInputIntent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadSearch from "./ThreadSearch.ts";

const layerTest = Layer.mergeAll(
  ThreadSearch.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const createProject = (projectId: ProjectId) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/work/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: Partial<
    Pick<OrchestrationV2AppThread, "archivedAt" | "deletedAt" | "forkedFrom" | "historyOrigin">
  > = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
    ...overrides,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  options: {
    readonly minute?: number;
    readonly streaming?: boolean;
    readonly notification?: OrchestrationV2Notification;
    readonly runId?: RunId;
    readonly ordinal?: number;
    readonly inputIntent?: OrchestrationV2UserMessageInputIntent;
  } = {},
): OrchestrationV2DomainEvent => {
  const event: Extract<OrchestrationV2DomainEvent, { type: "message.updated" }> = {
    id: EventId.make(`message:${id}`),
    type: "message.updated",
    threadId,
    providerInstanceId,
    occurredAt: at(options.minute ?? 1),
    payload: {
      createdBy: role === "user" ? "user" : "agent",
      creationSource: role === "user" ? "web" : "provider",
      id: MessageId.make(id),
      threadId,
      runId: options.runId ?? null,
      nodeId: null,
      role,
      text,
      attachments: [],
      streaming: options.streaming ?? false,
      createdAt: at(options.minute ?? 1),
      updatedAt: at(options.minute ?? 1),
      ...(options.notification ? { notification: options.notification } : {}),
    },
  };
  if (options.ordinal === undefined || role === "system") return event;
  const value = event.payload;
  return {
    id: EventId.make(`item:${value.id}`),
    type: "turn-item.updated",
    threadId: event.threadId,
    occurredAt: event.occurredAt,
    payload: {
      id: TurnItemId.make(`item:${value.id}`),
      threadId: value.threadId,
      runId: value.runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: options.ordinal,
      status: "completed",
      title: null,
      startedAt: value.createdAt,
      completedAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(value.notification
        ? { type: "notification", ...value.notification }
        : value.role === "user"
          ? {
              type: "user_message",
              createdBy: value.createdBy,
              creationSource: value.creationSource,
              messageId: value.id,
              inputIntent: options.inputIntent ?? "turn_start",
              text: value.text,
              attachments: [],
            }
          : {
              type: "assistant_message",
              messageId: value.id,
              text: value.text,
              streaming: value.streaming,
            }),
    },
  };
};

it.layer(layerTest)("ThreadSearch", (it) => {
  it.effect("returns one finished user or assistant match per active thread", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:search");
      const deletedProject = ProjectId.make("project:search-deleted");
      yield* createProject(project);
      yield* createProject(deletedProject);
      yield* Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
        projects.apply({
          sequence: 0,
          eventId: EventId.make("deleted:project"),
          aggregateKind: "project",
          aggregateId: deletedProject,
          occurredAt: DateTime.formatIso(at(2)),
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: {},
          type: "project.deleted",
          payload: { projectId: deletedProject, deletedAt: DateTime.formatIso(at(2)) },
        }),
      );

      const both = ThreadId.make("thread:both");
      const assistantOnly = ThreadId.make("thread:assistant");
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(both, project),
        message(both, "both-assistant", "assistant", "needle from the answer", { minute: 3 }),
        message(both, "both-user-old", "user", "older needle question", { minute: 1 }),
        message(both, "both-user-new", "user", "newer needle question", { minute: 2 }),
        thread(assistantOnly, project),
        message(assistantOnly, "assistant-only", "assistant", "needle in an answer"),
        message(assistantOnly, "assistant-streaming", "user", "needle still typing", {
          streaming: true,
        }),
        message(assistantOnly, "assistant-system", "system", "needle system prompt"),
        thread(ThreadId.make("thread:archived"), project, { archivedAt: at(1) }),
        message(ThreadId.make("thread:archived"), "archived", "user", "needle archived"),
        thread(ThreadId.make("thread:deleted"), project, { deletedAt: at(1) }),
        message(ThreadId.make("thread:deleted"), "deleted", "user", "needle deleted"),
        thread(ThreadId.make("thread:orphaned"), deletedProject),
        message(ThreadId.make("thread:orphaned"), "orphaned", "user", "needle orphaned"),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      const result = yield* search.search({ query: "NEEDLE", limit: 20 });
      assert.deepEqual(
        result.matches.map((match) => [match.threadId, match.source, match.snippet]),
        [
          [both, "user", "newer needle question"],
          [assistantOnly, "assistant", "needle in an answer"],
        ],
      );
      assert.lengthOf((yield* search.search({ query: "needle", limit: 1 })).matches, 1);
      // LIKE wildcards in the query match literally.
      assert.deepEqual((yield* search.search({ query: "ne%le" })).matches, []);
    }),
  );

  it.effect("finds every literal occurrence across persisted conversation messages", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = ProjectId.make("project:find");
      const threadId = ThreadId.make("thread:find");
      const other = ThreadId.make("thread:other");
      yield* createProject(project);
      yield* projections.apply(thread(threadId, project, { archivedAt: at(5) }));
      yield* projections.apply(thread(other, project));
      const messages = [
        message(threadId, "old", "user", "Needle needle", { minute: 1, ordinal: 0 }),
        message(threadId, "new", "assistant", "needle %_ needle", { minute: 2, ordinal: 1 }),
        message(threadId, "ignored", "system", "needle"),
        message(threadId, "notification", "user", "needle notification-only", {
          ordinal: 2,
          notification: {
            source: { kind: "background_task" },
            outcome: "completed",
            summary: "needle notification-only",
          },
        }),
        message(other, "other", "assistant", "needle", { ordinal: 0 }),
      ];
      yield* Effect.forEach(messages, projections.apply, { discard: true });
      assert.deepEqual(yield* search.find({ threadId, query: "NEEDLE" }), {
        total: 4,
        match: { messageId: MessageId.make("old"), occurrence: 0 },
      });
      assert.deepEqual(yield* search.find({ threadId, query: "needle", index: 1 }), {
        total: 4,
        match: { messageId: MessageId.make("old"), occurrence: 1 },
      });
      assert.deepEqual(yield* search.find({ threadId, query: "needle", index: 3 }), {
        total: 4,
        match: { messageId: MessageId.make("new"), occurrence: 1 },
      });
      assert.deepEqual(yield* search.find({ threadId, query: "needle", index: 4 }), {
        total: 4,
        match: null,
      });
      assert.deepEqual(yield* search.find({ threadId, query: "%_" }), {
        total: 1,
        match: { messageId: MessageId.make("new"), occurrence: 0 },
      });
      assert.deepEqual(yield* search.find({ threadId, query: "missing" }), {
        total: 0,
        match: null,
      });
      assert.deepEqual(yield* search.find({ threadId, query: "notification-only" }), {
        total: 0,
        match: null,
      });
    }),
  );

  it.effect(
    "finds the visible nested fork history and preserves inherited rollback snapshots",
    () =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const search = yield* ThreadSearch.ThreadSearch;
        const project = ProjectId.make("project:find-fork");
        const source = ThreadId.make("thread:find-source");
        const branch = ThreadId.make("thread:find-branch");
        const target = ThreadId.make("thread:find-target");
        const sourceCutoff = RunId.make("run:source-cutoff");
        const sourceLater = RunId.make("run:source-later");
        const branchEarly = RunId.make("run:branch-early");
        const branchCutoff = RunId.make("run:branch-cutoff");
        const branchLater = RunId.make("run:branch-later");
        const localRollback = RunId.make("run:local-rollback");
        const localQueued = RunId.make("run:local-queued");
        const localCancelled = RunId.make("run:local-cancelled");
        yield* createProject(project);
        yield* Effect.forEach(
          [
            thread(source, project, {
              historyOrigin: "v1_import",
              forkedFrom: { type: "run", threadId: target, runId: localCancelled },
            }),
            thread(branch, project, {
              forkedFrom: { type: "run", threadId: source, runId: sourceCutoff },
            }),
            thread(target, project, {
              forkedFrom: { type: "run", threadId: branch, runId: branchCutoff },
            }),
          ],
          projections.apply,
          { discard: true },
        );
        for (const [threadId, id, ordinal, status] of [
          [source, sourceCutoff, 1, "rolled_back"],
          [source, sourceLater, 2, "completed"],
          [branch, branchEarly, 1, "completed"],
          [branch, branchCutoff, 2, "completed"],
          [branch, branchLater, 3, "completed"],
          [target, localRollback, 1, "rolled_back"],
          [target, localQueued, 2, "cancelled"],
          [target, localCancelled, 3, "cancelled"],
        ] as const) {
          yield* projections.apply({
            id: EventId.make(`created:${id}`),
            type: "run.created",
            threadId,
            occurredAt: at(ordinal),
            payload: {
              id,
              threadId,
              ordinal,
              providerInstanceId,
              modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
              providerThreadId: null,
              userMessageId: MessageId.make(`message:${id}`),
              rootNodeId: null,
              activeAttemptId: null,
              status,
              requestedAt: at(ordinal),
              startedAt: at(ordinal),
              completedAt: at(ordinal),
              checkpointId: null,
              contextHandoffId: null,
            },
          });
        }
        const messages = [
          message(source, "source-legacy", "user", "needle legacy", { minute: 9, ordinal: 0 }),
          message(source, "source-snapshot", "assistant", "needle snapshot", {
            runId: sourceCutoff,
            minute: 8,
            ordinal: 1,
          }),
          message(source, "source-later", "assistant", "needle later", {
            runId: sourceLater,
            ordinal: 2,
          }),
          message(branch, "branch-runless", "user", "needle runless", { ordinal: 0 }),
          message(branch, "branch-early", "user", "needle branch", {
            runId: branchEarly,
            ordinal: 1,
          }),
          message(branch, "branch-cutoff", "assistant", "needle cutoff", {
            runId: branchCutoff,
            ordinal: 2,
          }),
          message(branch, "branch-later", "assistant", "needle later", {
            runId: branchLater,
            ordinal: 3,
          }),
          message(target, "target-local", "assistant", "needle local", { ordinal: 1 }),
          message(target, "target-rollback", "assistant", "needle undone", {
            runId: localRollback,
            ordinal: 2,
          }),
          message(target, "target-queued", "user", "needle queued", {
            runId: localQueued,
            ordinal: 3,
            inputIntent: "queued_turn",
          }),
          message(target, "target-cancelled", "user", "needle cancelled", {
            runId: localCancelled,
            ordinal: 4,
          }),
        ];
        yield* Effect.forEach(messages, projections.apply, { discard: true });
        // Queued records without a committed turn item are composer state.
        yield* projections.apply(message(target, "target-uncommitted", "user", "needle pending"));
        const visibleIds = (yield* projections.getThreadProjection(
          target,
        )).visibleTurnItems.flatMap(({ item }) =>
          item.type === "user_message" || item.type === "assistant_message" ? [item.messageId] : [],
        );
        assert.deepEqual(visibleIds, [
          "source-legacy",
          "source-snapshot",
          "branch-early",
          "branch-cutoff",
          "target-local",
          "target-cancelled",
        ]);
        for (const [index, messageId] of visibleIds.entries()) {
          assert.deepEqual(yield* search.find({ threadId: target, query: "needle", index }), {
            total: visibleIds.length,
            match: { messageId, occurrence: 0 },
          });
        }
        assert.deepEqual(yield* search.find({ threadId: target, query: "undone" }), {
          total: 0,
          match: null,
        });
        assert.deepEqual(yield* search.find({ threadId: source, query: "snapshot" }), {
          total: 0,
          match: null,
        });
        const missing = ThreadId.make("thread:find-boundary-missing");
        yield* projections.apply(
          thread(missing, project, {
            forkedFrom: { type: "run", threadId: source, runId: RunId.make("run:missing") },
          }),
        );
        yield* projections.apply(
          message(missing, "boundary-missing", "user", "needle missing", { ordinal: 0 }),
        );
        assert.deepEqual(yield* search.find({ threadId: missing, query: "needle" }), {
          total: 1,
          match: { messageId: MessageId.make("boundary-missing"), occurrence: 0 },
        });
      }),
  );

  it.effect("reports an unreadable match as a decode failure", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = ProjectId.make("project:search-corrupt");
      const threadId = ThreadId.make("thread:corrupt");
      yield* createProject(project);
      yield* Effect.forEach(
        [thread(threadId, project), message(threadId, "corrupt", "user", "20260927")],
        projections.apply,
        { discard: true },
      );
      yield* sql`
        UPDATE orchestration_v2_projection_messages
        SET payload_json = json_set(payload_json, '$.text', 20260927)
        WHERE message_id = 'corrupt'
      `;

      const error = yield* Effect.flip(search.search({ query: "0260927" }));
      assert.equal(error.operation, "decode");
    }),
  );
});
