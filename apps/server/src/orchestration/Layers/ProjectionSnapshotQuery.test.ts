import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { encodeThreadDetailPageCursor } from "../threadDetailCursor.ts";
import { projectThreadDetailSnapshot } from "../ActivityPayloadProjection.ts";
import { makeSqlStatementCounter } from "../../../integration/SqlStatementCounter.integration.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.make(value);

const projectionSnapshotLayer = it.layer(
  OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provideMerge(RepositoryIdentityResolver.layer),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  ),
);

projectionSnapshotLayer("ProjectionSnapshotQuery", (it) => {
  it.effect("hydrates read model from projection tables and computes snapshot sequence", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`DELETE FROM projection_thread_proposed_plans`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-1",
        title: "Project 1",
        workspace_root: "/tmp/project-1",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json:
          '[{"id":"script-1","name":"Build","command":"bun run build","icon":"build","runOnWorktreeCreate":false}]',
        created_at: "2026-02-24T00:00:00.000Z",
        updated_at: "2026-02-24T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-1",
        project_id: "project-1",
        title: "Thread 1",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        linked_pull_request_json:
          '{"projectId":"project-1","repository":"pingdotgg/t3code","number":42,"url":"https://github.com/pingdotgg/t3code/pull/42"}',
        latest_turn_id: "turn-1",
        latest_user_message_at: "2026-02-24T00:00:04.000Z",
        pending_approval_count: 1,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        pinned_at: "2026-02-24T00:00:01.000Z",
        pin_order_key: "gm",
        created_at: "2026-02-24T00:00:02.000Z",
        updated_at: "2026-02-24T00:00:03.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_thread_messages ${sql.insert({
        message_id: "message-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        role: "assistant",
        text: "hello from projection",
        is_streaming: 0,
        created_at: "2026-02-24T00:00:04.000Z",
        updated_at: "2026-02-24T00:00:05.000Z",
      })}`;

      yield* sql`INSERT INTO projection_thread_proposed_plans ${sql.insert({
        plan_id: "plan-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        plan_markdown: "# Ship it",
        implemented_at: "2026-02-24T00:00:05.500Z",
        implementation_thread_id: "thread-2",
        created_at: "2026-02-24T00:00:05.000Z",
        updated_at: "2026-02-24T00:00:05.500Z",
      })}`;

      yield* sql`INSERT INTO projection_thread_activities ${sql.insert({
        activity_id: "activity-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        tone: "info",
        kind: "runtime.note",
        summary: "provider started",
        payload_json: '{"stage":"start"}',
        created_at: "2026-02-24T00:00:06.000Z",
      })}`;

      yield* sql`INSERT INTO projection_thread_sessions ${sql.insert({
        thread_id: "thread-1",
        status: "running",
        provider_name: "codex",
        provider_session_id: "provider-session-1",
        provider_thread_id: "provider-thread-1",
        runtime_mode: "approval-required",
        active_turn_id: "turn-1",
        last_error: null,
        updated_at: "2026-02-24T00:00:07.000Z",
      })}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert({
        thread_id: "thread-1",
        turn_id: "turn-1",
        pending_message_id: null,
        source_proposed_plan_thread_id: "thread-1",
        source_proposed_plan_id: "plan-1",
        assistant_message_id: "message-1",
        state: "completed",
        requested_at: "2026-02-24T00:00:08.000Z",
        started_at: "2026-02-24T00:00:08.000Z",
        completed_at: "2026-02-24T00:00:08.000Z",
        checkpoint_turn_count: 1,
        checkpoint_ref: "checkpoint-1",
        checkpoint_status: "ready",
        checkpoint_files_json:
          '[{"path":"README.md","kind":"modified","additions":2,"deletions":1}]',
      })}`;

      let sequence = 5;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`INSERT INTO projection_state ${sql.insert({
          projector: projector,
          last_applied_sequence: sequence,
          updated_at: "2026-02-24T00:00:09.000Z",
        })}`;
        sequence += 1;
      }

      const snapshot = yield* snapshotQuery.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 5);
      assert.equal(snapshot.updatedAt, "2026-02-24T00:00:09.000Z");
      assert.deepEqual(snapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          autoPull: false,
          faviconPath: null,
          projectIcon: null,
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          defaultThreadEnvMode: null,
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.threads, [
        {
          id: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          linkedPullRequest: {
            projectId: asProjectId("project-1"),
            repository: "pingdotgg/t3code",
            number: 42,
            url: "https://github.com/pingdotgg/t3code/pull/42",
          },
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.make("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          unsettledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: "2026-02-24T00:00:01.000Z",
          pinOrderKey: "gm",
          titleRegeneration: null,
          deletedAt: null,
          messages: [
            {
              id: asMessageId("message-1"),
              role: "assistant",
              text: "hello from projection",
              turnId: asTurnId("turn-1"),
              streaming: false,
              createdAt: "2026-02-24T00:00:04.000Z",
              updatedAt: "2026-02-24T00:00:05.000Z",
            },
          ],
          proposedPlans: [
            {
              id: "plan-1",
              turnId: asTurnId("turn-1"),
              planMarkdown: "# Ship it",
              implementedAt: "2026-02-24T00:00:05.500Z",
              implementationThreadId: ThreadId.make("thread-2"),
              createdAt: "2026-02-24T00:00:05.000Z",
              updatedAt: "2026-02-24T00:00:05.500Z",
            },
          ],
          activities: [
            {
              id: asEventId("activity-1"),
              tone: "info",
              kind: "runtime.note",
              summary: "provider started",
              payload: { stage: "start" },
              turnId: asTurnId("turn-1"),
              createdAt: "2026-02-24T00:00:06.000Z",
            },
          ],
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-1"),
              status: "ready",
              files: [{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }],
              assistantMessageId: asMessageId("message-1"),
              completedAt: "2026-02-24T00:00:08.000Z",
            },
          ],
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
        },
      ]);

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.snapshotSequence, 5);
      assert.deepEqual(shellSnapshot.projects, [
        {
          id: asProjectId("project-1"),
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
          repositoryIdentity: null,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          autoPull: false,
          faviconPath: null,
          projectIcon: null,
          scripts: [
            {
              id: "script-1",
              name: "Build",
              command: "bun run build",
              icon: "build",
              runOnWorktreeCreate: false,
            },
          ],
          defaultThreadEnvMode: null,
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:01.000Z",
        },
      ]);
      assert.deepEqual(shellSnapshot.threads, [
        {
          id: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread 1",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          linkedPullRequest: {
            projectId: asProjectId("project-1"),
            repository: "pingdotgg/t3code",
            number: 42,
            url: "https://github.com/pingdotgg/t3code/pull/42",
          },
          latestTurn: {
            turnId: asTurnId("turn-1"),
            state: "completed",
            requestedAt: "2026-02-24T00:00:08.000Z",
            startedAt: "2026-02-24T00:00:08.000Z",
            completedAt: "2026-02-24T00:00:08.000Z",
            assistantMessageId: asMessageId("message-1"),
            sourceProposedPlan: {
              threadId: ThreadId.make("thread-1"),
              planId: "plan-1",
            },
          },
          createdAt: "2026-02-24T00:00:02.000Z",
          updatedAt: "2026-02-24T00:00:03.000Z",
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          unsettledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: "2026-02-24T00:00:01.000Z",
          pinOrderKey: "gm",
          titleRegeneration: null,
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: "2026-02-24T00:00:07.000Z",
          },
          latestUserMessageAt: "2026-02-24T00:00:04.000Z",
          hasPendingApprovals: true,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
          backgroundLiveness: null,
          planProgress: null,
        },
      ]);

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value, snapshot.threads[0]);
      }

      yield* sql`INSERT INTO projection_thread_activities ${sql.insert([
        {
          activity_id: "activity-task-started",
          thread_id: "thread-1",
          turn_id: "turn-1",
          tone: "info",
          kind: "task.started",
          summary: "Ship the query filter",
          payload_json: '{"taskId":"task-1","detail":"Ship the query filter"}',
          created_at: "2026-02-24T00:00:06.100Z",
        },
        {
          activity_id: "activity-malformed-tool",
          thread_id: "thread-1",
          turn_id: "turn-1",
          tone: "info",
          kind: "tool.completed",
          summary: "Malformed tool output",
          payload_json: "not-json",
          created_at: "2026-02-24T00:00:06.200Z",
        },
      ])}`;

      const detailWithoutActivities = yield* snapshotQuery.getThreadDetailById(
        ThreadId.make("thread-1"),
        { activityKinds: [] },
      );
      assert.equal(detailWithoutActivities._tag, "Some");
      if (detailWithoutActivities._tag === "Some") {
        assert.deepEqual(detailWithoutActivities.value.activities, []);
        assert.deepEqual(detailWithoutActivities.value.messages, snapshot.threads[0]?.messages);
        assert.deepEqual(
          detailWithoutActivities.value.proposedPlans,
          snapshot.threads[0]?.proposedPlans,
        );
        assert.deepEqual(
          detailWithoutActivities.value.checkpoints,
          snapshot.threads[0]?.checkpoints,
        );
      }

      const detailWithTaskActivities = yield* snapshotQuery.getThreadDetailById(
        ThreadId.make("thread-1"),
        { activityKinds: ["task.started", "task.progress"] },
      );
      assert.equal(detailWithTaskActivities._tag, "Some");
      if (detailWithTaskActivities._tag === "Some") {
        assert.deepEqual(detailWithTaskActivities.value.activities, [
          {
            id: asEventId("activity-task-started"),
            tone: "info",
            kind: "task.started",
            summary: "Ship the query filter",
            payload: { taskId: "task-1", detail: "Ship the query filter" },
            turnId: asTurnId("turn-1"),
            createdAt: "2026-02-24T00:00:06.100Z",
          },
        ]);
      }

      const counter = makeSqlStatementCounter();
      const context = yield* snapshotQuery
        .getThreadRuntimeContext(ThreadId.make("thread-1"))
        .pipe(Effect.withTracer(counter.tracer));
      assert.equal(counter.count(), 1);
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          id: ThreadId.make("thread-1"),
          title: "Thread 1",
          session: snapshot.threads[0]?.session,
        });
      }

      yield* sql`
        UPDATE projection_thread_sessions
        SET status = 'starting', active_turn_id = NULL, provider_name = 'claudeAgent',
            provider_instance_id = 'claude-secondary', last_error = 'Starting another session'
        WHERE thread_id = 'thread-1'
      `;
      const changedContext = yield* snapshotQuery.getThreadRuntimeContext(
        ThreadId.make("thread-1"),
      );
      assert.equal(changedContext._tag, "Some");
      if (changedContext._tag === "Some") {
        assert.equal(changedContext.value.session?.status, "starting");
        assert.equal(changedContext.value.session?.activeTurnId, null);
        assert.equal(changedContext.value.session?.providerName, "claudeAgent");
        assert.equal(changedContext.value.session?.providerInstanceId, "claude-secondary");
        assert.equal(changedContext.value.session?.lastError, "Starting another session");
      }
    }),
  );

  it.effect("keeps archived threads out of the main shell snapshot", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-archive-test",
        title: "Archive Test",
        workspace_root: "/tmp/archive-test",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-06T00:00:00.000Z",
        updated_at: "2026-04-06T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert([
        {
          thread_id: "thread-active",
          project_id: "project-archive-test",
          title: "Active Thread",
          model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          branch: null,
          worktree_path: null,
          latest_turn_id: null,
          latest_user_message_at: null,
          pending_approval_count: 0,
          pending_user_input_count: 0,
          has_actionable_proposed_plan: 0,
          created_at: "2026-04-06T00:00:02.000Z",
          updated_at: "2026-04-06T00:00:03.000Z",
          archived_at: null,
          deleted_at: null,
        },
        {
          thread_id: "thread-archived",
          project_id: "project-archive-test",
          title: "Archived Thread",
          model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          branch: null,
          worktree_path: null,
          latest_turn_id: null,
          latest_user_message_at: null,
          pending_approval_count: 0,
          pending_user_input_count: 0,
          has_actionable_proposed_plan: 0,
          created_at: "2026-04-06T00:00:04.000Z",
          updated_at: "2026-04-06T00:00:05.000Z",
          archived_at: "2026-04-06T00:00:06.000Z",
          deleted_at: null,
        },
      ])}`;

      yield* sql`INSERT INTO projection_state ${sql.insert([
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.projects,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threads,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
      ])}`;

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-active")],
      );

      const archivedShellSnapshot = yield* snapshotQuery.getArchivedShellSnapshot();
      assert.deepEqual(
        archivedShellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-archived")],
      );
      assert.equal(archivedShellSnapshot.threads[0]?.archivedAt, "2026-04-06T00:00:06.000Z");
      const activeContext = yield* snapshotQuery.getThreadRuntimeContext(
        ThreadId.make("thread-active"),
      );
      assert.equal(activeContext._tag, "Some");
      if (activeContext._tag === "Some") assert.equal(activeContext.value.session, null);
      for (const threadId of ["thread-archived", "thread-missing"]) {
        assert.equal(
          (yield* snapshotQuery.getThreadRuntimeContext(ThreadId.make(threadId)))._tag,
          "None",
        );
      }
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-04-06T00:00:08.000Z' WHERE thread_id = 'thread-active'`;
      assert.equal(
        (yield* snapshotQuery.getThreadRuntimeContext(ThreadId.make("thread-active")))._tag,
        "None",
      );
    }),
  );

  it.effect("keeps settled threads in the shell snapshot with non-null settlement fields", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-settled-test",
        title: "Settled Test",
        workspace_root: "/tmp/settled-test",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-06T00:00:00.000Z",
        updated_at: "2026-04-06T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-settled",
        project_id: "project-settled-test",
        title: "Settled Thread",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        latest_turn_id: null,
        latest_user_message_at: null,
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-04-06T00:00:02.000Z",
        updated_at: "2026-04-06T00:00:05.000Z",
        archived_at: null,
        settled_override: "settled",
        settled_at: "2026-04-06T00:00:04.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_state ${sql.insert([
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.projects,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threads,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
          last_applied_sequence: 4,
          updated_at: "2026-04-06T00:00:07.000Z",
        },
      ])}`;

      // Settled ≠ archived: the thread must appear in the LIVE shell
      // snapshot, carrying its settlement fields through the row aliases.
      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepEqual(
        shellSnapshot.threads.map((thread) => thread.id),
        [ThreadId.make("thread-settled")],
      );
      assert.equal(shellSnapshot.threads[0]?.settledOverride, "settled");
      assert.equal(shellSnapshot.threads[0]?.settledAt, "2026-04-06T00:00:04.000Z");

      // And the full command read model carries them too.
      const readModel = yield* snapshotQuery.getCommandReadModel();
      const thread = readModel.threads.find(
        (candidate) => candidate.id === ThreadId.make("thread-settled"),
      );
      assert.equal(thread?.settledOverride, "settled");
      assert.equal(thread?.settledAt, "2026-04-06T00:00:04.000Z");
    }),
  );

  it.effect(
    "reads targeted project, thread, and count queries without hydrating the full snapshot",
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;

        yield* sql`DELETE FROM projection_projects`;
        yield* sql`DELETE FROM projection_threads`;
        yield* sql`DELETE FROM projection_turns`;

        yield* sql`INSERT INTO projection_projects ${sql.insert([
          {
            project_id: "project-active",
            title: "Active Project",
            workspace_root: "/tmp/workspace",
            default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
            scripts_json: "[]",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:01.000Z",
            deleted_at: null,
          },
          {
            project_id: "project-deleted",
            title: "Deleted Project",
            workspace_root: "/tmp/deleted",
            default_model_selection_json: null,
            scripts_json: "[]",
            created_at: "2026-03-01T00:00:02.000Z",
            updated_at: "2026-03-01T00:00:03.000Z",
            deleted_at: "2026-03-01T00:00:04.000Z",
          },
        ])}`;

        yield* sql`INSERT INTO projection_threads ${sql.insert([
          {
            thread_id: "thread-first",
            project_id: "project-active",
            title: "First Thread",
            model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
            runtime_mode: "full-access",
            interaction_mode: "default",
            branch: null,
            worktree_path: null,
            latest_turn_id: null,
            created_at: "2026-03-01T00:00:05.000Z",
            updated_at: "2026-03-01T00:00:06.000Z",
            archived_at: null,
            deleted_at: null,
          },
          {
            thread_id: "thread-second",
            project_id: "project-active",
            title: "Second Thread",
            model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
            runtime_mode: "full-access",
            interaction_mode: "default",
            branch: null,
            worktree_path: null,
            latest_turn_id: null,
            created_at: "2026-03-01T00:00:07.000Z",
            updated_at: "2026-03-01T00:00:08.000Z",
            archived_at: null,
            deleted_at: null,
          },
          {
            thread_id: "thread-deleted",
            project_id: "project-active",
            title: "Deleted Thread",
            model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
            runtime_mode: "full-access",
            interaction_mode: "default",
            branch: null,
            worktree_path: null,
            latest_turn_id: null,
            created_at: "2026-03-01T00:00:09.000Z",
            updated_at: "2026-03-01T00:00:10.000Z",
            archived_at: null,
            deleted_at: "2026-03-01T00:00:11.000Z",
          },
        ])}`;

        const counts = yield* snapshotQuery.getCounts();
        assert.deepEqual(counts, {
          projectCount: 2,
          threadCount: 3,
        });

        const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/workspace");
        assert.equal(project._tag, "Some");
        if (project._tag === "Some") {
          assert.equal(project.value.id, asProjectId("project-active"));
        }

        const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot("/tmp/missing");
        assert.equal(missingProject._tag, "None");

        const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          asProjectId("project-active"),
        );
        assert.equal(firstThreadId._tag, "Some");
        if (firstThreadId._tag === "Some") {
          assert.equal(firstThreadId.value, ThreadId.make("thread-first"));
        }
      }),
  );

  it.effect("measures replay payload bytes without decoding event bodies", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM orchestration_events`;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
          command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
        )
        VALUES
          (
            'replay-event-1', 'thread', 'thread-replay', 1, 'thread.activity-appended',
            '2026-03-01T00:00:00.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 1000, 'x')), '{}'
          ),
          (
            'replay-event-2', 'thread', 'thread-replay', 2, 'thread.activity-appended',
            '2026-03-01T00:00:01.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 2000, 'x')), '{}'
          ),
          (
            'replay-event-3', 'thread', 'thread-replay', 3, 'thread.activity-appended',
            '2026-03-01T00:00:02.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', printf('%.*c', 3000, 'x')), '{}'
          ),
          (
            'replay-event-4', 'thread', 'thread-replay', 4, 'thread.activity-appended',
            '2026-03-01T00:00:03.000Z', NULL, NULL, NULL, 'provider',
            json_object('output', '😀'), '{}'
          )
      `;

      // Bytes, not code points: the 4-byte emoji row is {"output":"😀"}, 17 bytes.
      const stats = yield* snapshotQuery.getEventReplayStats({
        fromSequenceExclusive: 1,
        toSequenceInclusive: 4,
      });
      assert.deepStrictEqual(stats, {
        eventCount: 3,
        payloadBytes: 5043,
      });
    }),
  );

  it.effect("reads single-thread checkpoint context without hydrating unrelated threads", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-context",
        title: "Context Project",
        workspace_root: "/tmp/context-workspace",
        default_model_selection_json: null,
        scripts_json: "[]",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-context",
        project_id: "project-context",
        title: "Context Thread",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: "feature/perf",
        worktree_path: "/tmp/context-worktree",
        latest_turn_id: null,
        created_at: "2026-03-02T00:00:02.000Z",
        updated_at: "2026-03-02T00:00:03.000Z",
        archived_at: null,
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert([
        {
          thread_id: "thread-context",
          turn_id: "turn-1",
          pending_message_id: null,
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: null,
          state: "completed",
          requested_at: "2026-03-02T00:00:04.000Z",
          started_at: "2026-03-02T00:00:04.000Z",
          completed_at: "2026-03-02T00:00:04.000Z",
          checkpoint_turn_count: 1,
          checkpoint_ref: "checkpoint-a",
          checkpoint_status: "ready",
          checkpoint_files_json: "[]",
        },
        {
          thread_id: "thread-context",
          turn_id: "turn-2",
          pending_message_id: null,
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: null,
          state: "completed",
          requested_at: "2026-03-02T00:00:05.000Z",
          started_at: "2026-03-02T00:00:05.000Z",
          completed_at: "2026-03-02T00:00:05.000Z",
          checkpoint_turn_count: 2,
          checkpoint_ref: "checkpoint-b",
          checkpoint_status: "ready",
          checkpoint_files_json: "[]",
        },
      ])}`;

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.make("thread-context"),
      );
      assert.equal(context._tag, "Some");
      if (context._tag === "Some") {
        assert.deepEqual(context.value, {
          threadId: ThreadId.make("thread-context"),
          projectId: asProjectId("project-context"),
          workspaceRoot: "/tmp/context-workspace",
          worktreePath: "/tmp/context-worktree",
          checkpoints: [
            {
              turnId: asTurnId("turn-1"),
              checkpointTurnCount: 1,
              checkpointRef: asCheckpointRef("checkpoint-a"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:04.000Z",
            },
            {
              turnId: asTurnId("turn-2"),
              checkpointTurnCount: 2,
              checkpointRef: asCheckpointRef("checkpoint-b"),
              status: "ready",
              files: [],
              assistantMessageId: null,
              completedAt: "2026-03-02T00:00:05.000Z",
            },
          ],
        });
      }
    }),
  );

  it.effect("keeps thread detail activity ordering consistent with shell snapshot ordering", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-1",
        title: "Project 1",
        workspace_root: "/tmp/project-1",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-01T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-1",
        project_id: "project-1",
        title: "Thread 1",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        latest_turn_id: null,
        latest_user_message_at: null,
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-04-01T00:00:02.000Z",
        updated_at: "2026-04-01T00:00:03.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_thread_activities ${sql.insert([
        {
          activity_id: "activity-unsequenced",
          thread_id: "thread-1",
          turn_id: null,
          tone: "info",
          kind: "runtime.note",
          summary: "unsequenced first",
          payload_json: '{"source":"unsequenced"}',
          sequence: null,
          created_at: "2026-04-01T00:00:06.000Z",
        },
        {
          activity_id: "activity-sequence-2",
          thread_id: "thread-1",
          turn_id: null,
          tone: "info",
          kind: "runtime.note",
          summary: "sequence two",
          payload_json: '{"source":"sequence-2"}',
          sequence: 2,
          created_at: "2026-04-01T00:00:04.000Z",
        },
        {
          activity_id: "activity-sequence-1",
          thread_id: "thread-1",
          turn_id: null,
          tone: "info",
          kind: "runtime.note",
          summary: "sequence one",
          payload_json: '{"source":"sequence-1"}',
          sequence: 1,
          created_at: "2026-04-01T00:00:05.000Z",
        },
      ])}`;

      const snapshot = yield* snapshotQuery.getSnapshot();
      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));

      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.deepEqual(threadDetail.value.activities, snapshot.threads[0]?.activities ?? []);
      }

      assert.deepEqual(snapshot.threads[0]?.activities ?? [], [
        {
          id: asEventId("activity-unsequenced"),
          tone: "info",
          kind: "runtime.note",
          summary: "unsequenced first",
          payload: { source: "unsequenced" },
          turnId: null,
          createdAt: "2026-04-01T00:00:06.000Z",
        },
        {
          id: asEventId("activity-sequence-1"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence one",
          payload: { source: "sequence-1" },
          turnId: null,
          sequence: 1,
          createdAt: "2026-04-01T00:00:05.000Z",
        },
        {
          id: asEventId("activity-sequence-2"),
          tone: "info",
          kind: "runtime.note",
          summary: "sequence two",
          payload: { source: "sequence-2" },
          turnId: null,
          sequence: 2,
          createdAt: "2026-04-01T00:00:04.000Z",
        },
      ]);
    }),
  );

  it.effect("uses projection_threads.latest_turn_id for targeted thread latest turn queries", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-1",
        title: "Project 1",
        workspace_root: "/tmp/project-1",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-02T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-1",
        project_id: "project-1",
        title: "Thread 1",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        latest_turn_id: "turn-running",
        latest_user_message_at: "2026-04-02T00:00:04.000Z",
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-04-02T00:00:02.000Z",
        updated_at: "2026-04-02T00:00:03.000Z",
        archived_at: null,
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert([
        {
          thread_id: "thread-1",
          turn_id: "turn-completed",
          pending_message_id: "message-user-1",
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: "message-assistant-1",
          state: "completed",
          requested_at: "2026-04-02T00:00:05.000Z",
          started_at: "2026-04-02T00:00:06.000Z",
          completed_at: "2026-04-02T00:00:20.000Z",
          checkpoint_turn_count: 5,
          checkpoint_ref: "checkpoint-5",
          checkpoint_status: "ready",
          checkpoint_files_json: "[]",
        },
        {
          thread_id: "thread-1",
          turn_id: "turn-running",
          pending_message_id: "message-user-2",
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: null,
          state: "running",
          requested_at: "2026-04-02T00:00:30.000Z",
          started_at: "2026-04-02T00:00:30.000Z",
          completed_at: null,
          checkpoint_turn_count: null,
          checkpoint_ref: null,
          checkpoint_status: null,
          checkpoint_files_json: "[]",
        },
      ])}`;

      const threadShell = yield* snapshotQuery.getThreadShellById(ThreadId.make("thread-1"));
      assert.equal(threadShell._tag, "Some");
      if (threadShell._tag === "Some") {
        assert.equal(threadShell.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadShell.value.latestTurn?.state, "running");
        assert.equal(threadShell.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }

      const threadDetail = yield* snapshotQuery.getThreadDetailById(ThreadId.make("thread-1"));
      assert.equal(threadDetail._tag, "Some");
      if (threadDetail._tag === "Some") {
        assert.equal(threadDetail.value.latestTurn?.turnId, asTurnId("turn-running"));
        assert.equal(threadDetail.value.latestTurn?.state, "running");
        assert.equal(threadDetail.value.latestTurn?.startedAt, "2026-04-02T00:00:30.000Z");
      }
    }),
  );

  it.effect("uses projection_threads.latest_turn_id for bulk command and shell snapshots", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-1",
        title: "Project 1",
        workspace_root: "/tmp/project-1",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-03T00:00:00.000Z",
        updated_at: "2026-04-03T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-1",
        project_id: "project-1",
        title: "Thread 1",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        latest_turn_id: "turn-running",
        latest_user_message_at: "2026-04-03T00:00:04.000Z",
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-04-03T00:00:02.000Z",
        updated_at: "2026-04-03T00:00:03.000Z",
        archived_at: null,
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert([
        {
          thread_id: "thread-1",
          turn_id: "turn-running",
          pending_message_id: "message-user-2",
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: null,
          state: "running",
          requested_at: "2026-04-03T00:00:30.000Z",
          started_at: "2026-04-03T00:00:30.000Z",
          completed_at: null,
          checkpoint_turn_count: null,
          checkpoint_ref: null,
          checkpoint_status: null,
          checkpoint_files_json: "[]",
        },
        {
          thread_id: "thread-1",
          turn_id: "turn-completed",
          pending_message_id: "message-user-1",
          source_proposed_plan_thread_id: null,
          source_proposed_plan_id: null,
          assistant_message_id: "message-assistant-1",
          state: "completed",
          requested_at: "2026-04-03T00:00:05.000Z",
          started_at: "2026-04-03T00:00:06.000Z",
          completed_at: "2026-04-03T00:00:20.000Z",
          checkpoint_turn_count: null,
          checkpoint_ref: null,
          checkpoint_status: null,
          checkpoint_files_json: "[]",
        },
      ])}`;

      yield* sql`INSERT INTO projection_state ${sql.insert([
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.projects,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threads,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
        {
          projector: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
          last_applied_sequence: 3,
          updated_at: "2026-04-03T00:00:40.000Z",
        },
      ])}`;

      const commandReadModel = yield* snapshotQuery.getCommandReadModel();
      assert.equal(commandReadModel.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(commandReadModel.threads[0]?.latestTurn?.state, "running");

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(shellSnapshot.threads[0]?.latestTurn?.state, "running");

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-running"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.state, "running");
    }),
  );

  it.effect("keeps deleted project and thread tombstones in the command read model", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-deleted",
        title: "Deleted Project",
        workspace_root: "/tmp/deleted-project",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-04-05T00:00:00.000Z",
        updated_at: "2026-04-05T00:00:01.000Z",
        deleted_at: "2026-04-05T00:00:02.000Z",
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-deleted",
        project_id: "project-deleted",
        title: "Deleted Thread",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        branch: null,
        worktree_path: null,
        latest_turn_id: "turn-deleted",
        latest_user_message_at: null,
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-04-05T00:00:03.000Z",
        updated_at: "2026-04-05T00:00:04.000Z",
        archived_at: null,
        deleted_at: "2026-04-05T00:00:05.000Z",
      })}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert({
        thread_id: "thread-deleted",
        turn_id: "turn-deleted",
        pending_message_id: "message-deleted-user",
        source_proposed_plan_thread_id: null,
        source_proposed_plan_id: null,
        assistant_message_id: "message-deleted-assistant",
        state: "completed",
        requested_at: "2026-04-05T00:00:04.100Z",
        started_at: "2026-04-05T00:00:04.200Z",
        completed_at: "2026-04-05T00:00:04.300Z",
        checkpoint_turn_count: null,
        checkpoint_ref: null,
        checkpoint_status: null,
        checkpoint_files_json: "[]",
      })}`;

      const commandReadModel = yield* snapshotQuery.getCommandReadModel();
      assert.equal(commandReadModel.projects[0]?.id, asProjectId("project-deleted"));
      assert.equal(commandReadModel.projects[0]?.deletedAt, "2026-04-05T00:00:02.000Z");
      assert.equal(commandReadModel.threads[0]?.id, ThreadId.make("thread-deleted"));
      assert.equal(commandReadModel.threads[0]?.deletedAt, "2026-04-05T00:00:05.000Z");
      assert.equal(commandReadModel.threads[0]?.latestTurn?.turnId, asTurnId("turn-deleted"));
      assert.equal(commandReadModel.threads[0]?.latestTurn?.state, "completed");

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.equal(fullSnapshot.threads[0]?.id, ThreadId.make("thread-deleted"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.turnId, asTurnId("turn-deleted"));
      assert.equal(fullSnapshot.threads[0]?.latestTurn?.state, "completed");

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.equal(shellSnapshot.projects.length, 0);
      assert.equal(shellSnapshot.threads.length, 0);
    }),
  );

  it.effect("searches active user messages and canonical assistant outputs", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_projects`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-search",
        title: "Project Needle",
        workspace_root: "/tmp/project-search",
        default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        scripts_json: "[]",
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:01.000Z",
        deleted_at: null,
      })}`;

      yield* sql`INSERT INTO projection_threads ${sql.insert([
        {
          thread_id: "thread-active",
          project_id: "project-search",
          title: "Literal 100% fix",
          model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          branch: "search-branch",
          worktree_path: null,
          latest_turn_id: "turn-active",
          latest_user_message_at: "2026-05-01T00:00:02.000Z",
          pending_approval_count: 0,
          pending_user_input_count: 0,
          has_actionable_proposed_plan: 0,
          created_at: "2026-05-01T00:00:02.000Z",
          updated_at: "2026-05-01T00:00:03.000Z",
          archived_at: null,
          deleted_at: null,
        },
        {
          thread_id: "thread-percent-decoy",
          project_id: "project-search",
          title: "Literal 100x fix",
          model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          branch: null,
          worktree_path: null,
          latest_turn_id: null,
          latest_user_message_at: null,
          pending_approval_count: 0,
          pending_user_input_count: 0,
          has_actionable_proposed_plan: 0,
          created_at: "2026-05-01T00:00:04.000Z",
          updated_at: "2026-05-01T00:00:05.000Z",
          archived_at: null,
          deleted_at: null,
        },
        {
          thread_id: "thread-hidden",
          project_id: "project-search",
          title: "Archived search",
          model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          branch: null,
          worktree_path: null,
          latest_turn_id: null,
          latest_user_message_at: null,
          pending_approval_count: 0,
          pending_user_input_count: 0,
          has_actionable_proposed_plan: 0,
          created_at: "2026-05-01T00:00:06.000Z",
          updated_at: "2026-05-01T00:00:07.000Z",
          archived_at: "2026-05-01T00:00:08.000Z",
          deleted_at: null,
        },
      ])}`;

      yield* sql`INSERT INTO projection_thread_messages ${sql.insert([
        {
          message_id: "message-user",
          thread_id: "thread-active",
          turn_id: "turn-active",
          role: "user",
          text: "Please find this USER needle in an old prompt.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:12.000Z",
          updated_at: "2026-05-01T00:00:12.000Z",
        },
        {
          message_id: "message-percent",
          thread_id: "thread-active",
          turn_id: null,
          role: "user",
          text: "Literal 100% fix in a prompt.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:11.000Z",
          updated_at: "2026-05-01T00:00:11.000Z",
        },
        {
          message_id: "message-percent-decoy",
          thread_id: "thread-percent-decoy",
          turn_id: null,
          role: "user",
          text: "Literal 100x fix in a prompt.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:11.000Z",
          updated_at: "2026-05-01T00:00:11.000Z",
        },
        {
          message_id: "message-final",
          thread_id: "thread-active",
          turn_id: "turn-active",
          role: "assistant",
          text: "The canonical final needle appears in this completed answer.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:13.000Z",
          updated_at: "2026-05-01T00:00:13.000Z",
        },
        {
          message_id: "message-interim",
          thread_id: "thread-active",
          turn_id: "turn-active",
          role: "assistant",
          text: "Interim needle must not be searchable.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:14.000Z",
          updated_at: "2026-05-01T00:00:14.000Z",
        },
        {
          message_id: "message-system",
          thread_id: "thread-active",
          turn_id: null,
          role: "system",
          text: "System needle must not be searchable.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:15.000Z",
          updated_at: "2026-05-01T00:00:15.000Z",
        },
        {
          message_id: "message-hidden",
          thread_id: "thread-hidden",
          turn_id: null,
          role: "user",
          text: "Hidden needle in archive.",
          is_streaming: 0,
          created_at: "2026-05-01T00:00:16.000Z",
          updated_at: "2026-05-01T00:00:16.000Z",
        },
      ])}`;

      yield* sql`INSERT INTO projection_turns ${sql.insert({
        thread_id: "thread-active",
        turn_id: "turn-active",
        pending_message_id: "message-user",
        assistant_message_id: "message-final",
        state: "completed",
        requested_at: "2026-05-01T00:00:12.000Z",
        started_at: "2026-05-01T00:00:12.000Z",
        completed_at: "2026-05-01T00:00:13.000Z",
        checkpoint_files_json: "[]",
      })}`;

      const literalPercent = yield* snapshotQuery.searchThreads({ query: "100%" });
      assert.deepStrictEqual(
        literalPercent.matches.map((match) => [match.threadId, match.source]),
        [[ThreadId.make("thread-active"), "user"]],
      );

      const user = yield* snapshotQuery.searchThreads({ query: "user needle" });
      assert.equal(user.matches[0]?.source, "user");
      assert.match(user.matches[0]?.snippet ?? "", /USER needle/);

      const assistant = yield* snapshotQuery.searchThreads({ query: "FINAL NEEDLE" });
      assert.equal(assistant.matches[0]?.source, "assistant");

      const deduped = yield* snapshotQuery.searchThreads({ query: "needle" });
      assert.deepStrictEqual(
        deduped.matches.map((match) => [match.threadId, match.source]),
        [[ThreadId.make("thread-active"), "user"]],
      );

      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "interim needle" })).matches,
        [],
      );
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "system needle" })).matches,
        [],
      );
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "hidden needle" })).matches,
        [],
      );
      yield* sql`
        UPDATE projection_threads
        SET deleted_at = '2026-05-01T00:00:20.000Z'
        WHERE thread_id = 'thread-active'
      `;
      assert.deepStrictEqual(
        (yield* snapshotQuery.searchThreads({ query: "user needle" })).matches,
        [],
      );
    }),
  );
});

it.effect(
  "ProjectionSnapshotQuery dedupes repository identity resolution by workspace root and skips deleted projects for shell snapshots",
  () => {
    const resolveCalls: string[] = [];
    const layer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provideMerge(
        Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
          resolve: (cwd: string) =>
            Effect.sync(() => {
              resolveCalls.push(cwd);
              return {
                canonicalKey: `github.com/acme${cwd}`,
                locator: {
                  source: "git-remote" as const,
                  remoteName: "origin",
                  remoteUrl: `https://github.com/acme${cwd}.git`,
                },
                rootPath: cwd,
              };
            }),
        }),
      ),
      Layer.provideMerge(SqlitePersistenceMemory),
    );

    return Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert([
        {
          project_id: "project-1",
          title: "Shared Project 1",
          workspace_root: "/tmp/shared-root",
          default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          scripts_json: "[]",
          created_at: "2026-04-04T00:00:00.000Z",
          updated_at: "2026-04-04T00:00:01.000Z",
          deleted_at: null,
        },
        {
          project_id: "project-2",
          title: "Shared Project 2",
          workspace_root: "/tmp/shared-root",
          default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          scripts_json: "[]",
          created_at: "2026-04-04T00:00:02.000Z",
          updated_at: "2026-04-04T00:00:03.000Z",
          deleted_at: null,
        },
        {
          project_id: "project-3",
          title: "Deleted Project",
          workspace_root: "/tmp/deleted-root",
          default_model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
          scripts_json: "[]",
          created_at: "2026-04-04T00:00:04.000Z",
          updated_at: "2026-04-04T00:00:05.000Z",
          deleted_at: "2026-04-04T00:00:06.000Z",
        },
      ])}`;

      const shellSnapshot = yield* snapshotQuery.getShellSnapshot();
      assert.deepStrictEqual(resolveCalls.toSorted(), ["/tmp/shared-root"]);
      assert.equal(shellSnapshot.projects.length, 2);
      assert.equal(shellSnapshot.projects[0]?.repositoryIdentity?.rootPath, "/tmp/shared-root");
      assert.equal(shellSnapshot.projects[1]?.repositoryIdentity?.rootPath, "/tmp/shared-root");

      resolveCalls.length = 0;

      const fullSnapshot = yield* snapshotQuery.getSnapshot();
      assert.deepStrictEqual(resolveCalls.toSorted(), ["/tmp/deleted-root", "/tmp/shared-root"]);
      assert.equal(fullSnapshot.projects.length, 3);
      assert.equal(fullSnapshot.projects[2]?.repositoryIdentity?.rootPath, "/tmp/deleted-root");
    }).pipe(Effect.provide(layer));
  },
);

projectionSnapshotLayer("ProjectionSnapshotQuery windowed thread detail", (it) => {
  // A thread shaped like real fan-out usage: user turns interleaved with
  // subagent turns (no user pending message), plus a turnless straggler user
  // message and a turnless activity anchored between turns.
  //
  //   row  turn      pending msg        anchor (requested_at)
  //   1    turn-1    user-msg-1         T00
  //   2    turn-2    (subagent)         T01
  //   3    turn-3    (subagent)         T02
  //   4    turn-4    user-msg-4         T03
  //   5    turn-5    user-msg-5         T04
  //
  // Straggler user message at T03.5 (turn_id NULL, not any pending_message_id)
  // and a turnless activity at T03.6 — both belong to the page containing T03+.
  const seedFanOutThread = Effect.fnUntraced(function* () {
    const sql = yield* SqlClient.SqlClient;

    // Tests in this block share one in-memory database; reset before seeding.
    yield* sql`DELETE FROM projection_projects`;
    yield* sql`DELETE FROM projection_threads`;
    yield* sql`DELETE FROM projection_turns`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_state`;

    yield* sql`INSERT INTO projection_projects ${sql.insert({
      project_id: "project-w",
      title: "Windowed",
      workspace_root: "/tmp/project-w",
      scripts_json: "[]",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      deleted_at: null,
    })}`;
    yield* sql`INSERT INTO projection_threads ${sql.insert({
      thread_id: "thread-w",
      project_id: "project-w",
      title: "Windowed thread",
      model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
      runtime_mode: "full-access",
      interaction_mode: "default",
      latest_turn_id: "turn-5",
      pending_approval_count: 0,
      pending_user_input_count: 0,
      has_actionable_proposed_plan: 0,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:10.000Z",
      deleted_at: null,
    })}`;

    const turns: ReadonlyArray<{
      turn: string;
      pendingMessage: string | null;
      at: string;
    }> = [
      { turn: "turn-1", pendingMessage: "user-msg-1", at: "2026-03-01T00:00:00.000Z" },
      { turn: "turn-2", pendingMessage: null, at: "2026-03-01T00:01:00.000Z" },
      { turn: "turn-3", pendingMessage: null, at: "2026-03-01T00:02:00.000Z" },
      { turn: "turn-4", pendingMessage: "user-msg-4", at: "2026-03-01T00:03:00.000Z" },
      { turn: "turn-5", pendingMessage: "user-msg-5", at: "2026-03-01T00:04:00.000Z" },
    ];
    for (const { turn, pendingMessage, at } of turns) {
      yield* sql`INSERT INTO projection_turns ${sql.insert({
        thread_id: "thread-w",
        turn_id: turn,
        pending_message_id: pendingMessage,
        state: "completed",
        requested_at: at,
        started_at: at,
        completed_at: at,
        checkpoint_files_json: "[]",
      })}`;
      if (pendingMessage !== null) {
        yield* sql`INSERT INTO projection_thread_messages ${sql.insert({
          message_id: pendingMessage,
          thread_id: "thread-w",
          turn_id: null,
          role: "user",
          text: "prompt for " + turn,
          is_streaming: 0,
          created_at: at,
          updated_at: at,
        })}`;
      }
      yield* sql`INSERT INTO projection_thread_messages ${sql.insert({
        message_id: turn + "-reply",
        thread_id: "thread-w",
        turn_id: turn,
        role: "assistant",
        text: "reply from " + turn,
        is_streaming: 0,
        created_at: at,
        updated_at: at,
      })}`;
      yield* sql`INSERT INTO projection_thread_activities ${sql.insert({
        activity_id: turn + "-activity",
        thread_id: "thread-w",
        turn_id: turn,
        tone: "tool",
        kind: "tool.completed",
        summary: "ran tool",
        payload_json: '{"ok":true}',
        created_at: at,
      })}`;
    }

    // Straggler user message sent while turn-4 ran: turn_id NULL and not any
    // turn's pending_message_id.
    yield* sql`INSERT INTO projection_thread_messages ${sql.insert({
      message_id: "user-msg-straggler",
      thread_id: "thread-w",
      turn_id: null,
      role: "user",
      text: "while you are at it",
      is_streaming: 0,
      created_at: "2026-03-01T00:03:30.000Z",
      updated_at: "2026-03-01T00:03:30.000Z",
    })}`;
    // Turnless activity in the same time range.
    yield* sql`INSERT INTO projection_thread_activities ${sql.insert({
      activity_id: "turnless-activity",
      thread_id: "thread-w",
      turn_id: null,
      tone: "info",
      kind: "context-window.updated",
      summary: "usage",
      payload_json: '{"usedTokens":1}',
      created_at: "2026-03-01T00:03:36.000Z",
    })}`;

    for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
      yield* sql`INSERT INTO projection_state ${sql.insert({
        projector: projector,
        last_applied_sequence: 42,
        updated_at: "2026-03-01T00:00:10.000Z",
      })}`;
    }
  });

  const threadW = ThreadId.make("thread-w");
  const messageIds = (snapshot: { thread: { messages: ReadonlyArray<{ id: string }> } }) =>
    snapshot.thread.messages.map((message) => message.id).toSorted();
  const activityIds = (snapshot: { thread: { activities: ReadonlyArray<{ id: string }> } }) =>
    snapshot.thread.activities.map((activity) => activity.id).toSorted();

  it.effect("returns the full thread with no page metadata when no window is requested", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW);
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.page, undefined);
        assert.equal(snapshot.value.thread.messages.length, 9);
        assert.equal(snapshot.value.thread.activities.length, 6);
        assert.equal(snapshot.value.snapshotSequence, 42);
      }
    }),
  );

  it.effect("windows to the last N user-anchored turns with subagent turns riding along", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // turnLimit 2 walks back: turn-5 (user), turn-4 (user) -> window is
      // rows 4..5. Subagent turns 2-3 are older than the 2nd user turn and
      // stay out; the straggler message and turnless activity (T03.5/T03.6,
      // after turn-4's anchor) ride along.
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), [
          "turn-4-reply",
          "turn-5-reply",
          "user-msg-4",
          "user-msg-5",
          "user-msg-straggler",
        ]);
        assert.deepEqual(activityIds(snapshot.value), [
          "turn-4-activity",
          "turn-5-activity",
          "turnless-activity",
        ]);
        assert.equal(snapshot.value.page?.hasMore, true);
        assert.notEqual(snapshot.value.page?.beforeCursor, null);
        assert.equal(snapshot.value.page?.snapshotSequence, 42);
      }
    }),
  );

  it.effect("subagent turns between user turns ride along inside the window", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // turnLimit 3 reaches user turn-1, dragging subagent turns 2-3 along:
      // the full thread, so no further pages.
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 3 });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.thread.messages.length, 9);
        assert.equal(snapshot.value.thread.activities.length, 6);
        assert.equal(snapshot.value.page?.hasMore, false);
        assert.equal(snapshot.value.page?.beforeCursor, null);
      }
    }),
  );

  it.effect("cursors survive a projection rewrite that reassigns turn row ids", () =>
    Effect.gen(function* () {
      // The revert projector (and any projection rebuild) deletes and
      // re-upserts projection_turns, assigning fresh autoincrement row ids.
      // The keyset cursor is derived from event content, so a page cursor
      // minted before the rewrite must keep working after it.
      yield* seedFanOutThread();
      const sql = yield* SqlClient.SqlClient;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;
      const cursor = firstPage.value.page?.beforeCursor;
      assert.notEqual(cursor, null);
      if (cursor === null || cursor === undefined) return;

      // Simulate the rewrite: delete and re-insert every turn row with the
      // same content, which reassigns all row ids.
      const turnRows = yield* sql`
        SELECT thread_id, turn_id, pending_message_id, state, requested_at, started_at,
          completed_at, checkpoint_files_json
        FROM projection_turns WHERE thread_id = 'thread-w' ORDER BY row_id
      `;
      yield* sql`DELETE FROM projection_turns WHERE thread_id = 'thread-w'`;
      for (const row of turnRows) {
        yield* sql`INSERT INTO projection_turns ${sql.insert({
          thread_id: row.thread_id as string,
          turn_id: row.turn_id as string,
          pending_message_id: row.pending_message_id as string | null,
          state: row.state as string,
          requested_at: row.requested_at as string,
          started_at: row.started_at as string,
          completed_at: row.completed_at as string,
          checkpoint_files_json: row.checkpoint_files_json as string,
        })}`;
      }

      const olderPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 1,
        beforeCursor: cursor,
      });
      assert.equal(olderPage._tag, "Some");
      if (olderPage._tag === "Some") {
        // Identical older slice to what the pre-rewrite cursor would return.
        assert.deepEqual(messageIds(olderPage.value), [
          "turn-1-reply",
          "turn-2-reply",
          "turn-3-reply",
          "user-msg-1",
        ]);
        assert.equal(olderPage.value.page?.hasMore, false);
      }
    }),
  );

  it.effect("beforeCursor returns the disjoint adjacent older slice", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;
      const cursor = firstPage.value.page?.beforeCursor;
      assert.notEqual(cursor, null);
      assert.notEqual(cursor, undefined);
      if (cursor === null || cursor === undefined) return;

      // Older page: user turn-1 plus subagent turns 2-3 riding along. Disjoint
      // from the first page: no turn-4/5 rows, no straggler.
      const olderPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 1,
        beforeCursor: cursor,
      });
      assert.equal(olderPage._tag, "Some");
      if (olderPage._tag === "Some") {
        assert.deepEqual(messageIds(olderPage.value), [
          "turn-1-reply",
          "turn-2-reply",
          "turn-3-reply",
          "user-msg-1",
        ]);
        assert.deepEqual(activityIds(olderPage.value), [
          "turn-1-activity",
          "turn-2-activity",
          "turn-3-activity",
        ]);
        assert.equal(olderPage.value.page?.hasMore, false);
        assert.equal(olderPage.value.page?.beforeCursor, null);
      }
    }),
  );

  it.effect("a cursor for a different thread degrades to the first page", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const firstPage = yield* snapshotQuery.getThreadDetailSnapshot(threadW, { turnLimit: 2 });
      assert.equal(firstPage._tag, "Some");
      if (firstPage._tag !== "Some") return;

      const foreign = encodeThreadDetailPageCursor({
        threadId: ThreadId.make("thread-other"),
        beforeAnchorAt: "2026-03-01T00:01:00.000Z",
        beforeTurnId: "turn-2",
      });
      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
        beforeCursor: foreign,
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), messageIds(firstPage.value));
      }
    }),
  );

  it.effect("a malformed cursor degrades to the first page instead of failing", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
        beforeCursor: "not-a-cursor",
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.page?.hasMore, true);
        assert.equal(snapshot.value.thread.messages.length, 5);
      }
    }),
  );

  it.effect("windows never split below the raw-turn ceiling boundary contiguously", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      // Page repeatedly with turnLimit 1 and assert the union of all pages is
      // exactly the full thread with no duplicates (disjointness + coverage).
      const seenMessages: string[] = [];
      const seenActivities: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
          turnLimit: 1,
          ...(cursor !== undefined ? { beforeCursor: cursor } : {}),
        });
        assert.equal(snapshot._tag, "Some");
        if (snapshot._tag !== "Some") return;
        seenMessages.push(...snapshot.value.thread.messages.map((message) => message.id));
        seenActivities.push(...snapshot.value.thread.activities.map((activity) => activity.id));
        const next = snapshot.value.page?.beforeCursor;
        if (next === null || next === undefined) break;
        cursor = next;
      }
      assert.equal(new Set(seenMessages).size, seenMessages.length);
      assert.equal(new Set(seenActivities).size, seenActivities.length);
      assert.equal(seenMessages.length, 9);
      assert.equal(seenActivities.length, 6);
    }),
  );

  it.effect("bounds activity hydration and preserves unresolved requests", () =>
    Effect.gen(function* () {
      yield* seedFanOutThread();
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`
        WITH RECURSIVE activity_rows(sequence) AS (
          SELECT 1
          UNION ALL
          SELECT sequence + 1 FROM activity_rows WHERE sequence < 501
        )
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
        )
        SELECT
          printf('activity-%04d', sequence),
          'thread-w',
          'turn-5',
          'tool',
          CASE
            WHEN sequence = 2 THEN 'tool.updated'
            WHEN sequence IN (3, 70) THEN 'context-window.updated'
            ELSE 'tool.completed'
          END,
          'ran tool',
          CASE
            WHEN sequence IN (2, 80) THEN json_object(
              'itemType', 'command_execution',
              'toolCallId', 'cross-batch-call',
              'title', CASE WHEN sequence = 80 THEN 'Build completed' ELSE 'Build' END,
              'status', 'completed',
              'data', json_object(
                'toolCallId', 'cross-batch-call',
                'item', json_object(
                  'command', 'vp test run',
                  'aggregatedOutput', printf(
                    'command output%s%s',
                    char(10),
                    replace(hex(zeroblob(8192)), '00', 'x')
                  )
                ),
                'rawOutput', printf(
                  'raw output%s%s',
                  char(10),
                  replace(hex(zeroblob(8192)), '00', 'y')
                ),
                'files', json_array(json_object('path', 'apps/server/src/snapshot.ts'))
              )
            )
            WHEN sequence = 10 THEN json_object(
              'itemType', 'mcp_tool_call',
              'status', 'completed',
              'data', json_object(
                'item', json_object(
                  'type', 'mcpToolCall',
                  'id', 'mcp-item-10',
                  'tool', 'fetch_pr',
                  'server', 'github',
                  'status', 'completed',
                  'arguments', json_object('pr', 42),
                  'result', json_object(
                    'content', json_array(json_object(
                      'type', 'text',
                      'text', printf(
                        'PR body line one%s%s',
                        char(10),
                        replace(hex(zeroblob(8192)), '00', 'z')
                      )
                    ))
                  ),
                  '_meta', json_object('raw', replace(hex(zeroblob(8192)), '00', 'q'))
                )
              )
            )
            WHEN sequence = 11 THEN json_object(
              'itemType', 'command_execution',
              'status', 'completed',
              'data', json_object(
                'item', json_object(
                  'status', 'failed',
                  'command', 'vp test run',
                  'aggregatedOutput', printf(
                    'failed command%s%s',
                    char(10),
                    replace(hex(zeroblob(8192)), '00', 'w')
                  )
                ),
                'rawOutput', json_object('stdout', 'failed output'),
                'files', json_array(json_object('path', 'apps/server/src/failed.ts'))
              )
            )
            WHEN sequence IN (3, 70) THEN json_object(
              'usedTokens', sequence * 100,
              'modelContextWindow', 100000
            )
            ELSE json_object('sequence', sequence)
          END,
          sequence,
          '2026-03-01T00:04:00.000Z'
        FROM activity_rows
      `;

      const fullDetail = yield* snapshotQuery.getThreadDetailById(threadW);
      assert.equal(fullDetail._tag, "Some");
      if (fullDetail._tag === "Some") {
        assert.equal(fullDetail.value.activities.length, 500);
        assert.equal(fullDetail.value.activities[0]?.id, asEventId("activity-0002"));
        assert.equal(fullDetail.value.activities.at(-1)?.id, asEventId("activity-0501"));
      }

      const windowedDetail = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
      });
      assert.equal(windowedDetail._tag, "Some");
      if (windowedDetail._tag === "Some") {
        assert.equal(windowedDetail.value.thread.activities.length, 500);
        assert.equal(windowedDetail.value.thread.activities[0]?.id, asEventId("activity-0002"));
        assert.equal(windowedDetail.value.thread.activities.at(-1)?.id, asEventId("activity-0501"));
      }

      yield* sql`INSERT INTO projection_thread_activities ${sql.insert([
        {
          activity_id: "approval-old",
          thread_id: "thread-w",
          turn_id: null,
          tone: "approval",
          kind: "approval.requested",
          summary: "Approve old command",
          payload_json: '{"requestId":"approval-1"}',
          sequence: null,
          created_at: "2026-03-01T00:00:01.000Z",
        },
        {
          activity_id: "user-input-old",
          thread_id: "thread-w",
          turn_id: null,
          tone: "approval",
          kind: "user-input.requested",
          summary: "Answer old question",
          payload_json: '{"requestId":"input-1"}',
          sequence: null,
          created_at: "2026-03-01T00:00:02.000Z",
        },
        {
          activity_id: "user-input-closed",
          thread_id: "thread-w",
          turn_id: null,
          tone: "approval",
          kind: "user-input.requested",
          summary: "Closed question",
          payload_json: '{"requestId":"input-closed"}',
          sequence: null,
          created_at: "2026-03-01T00:00:03.000Z",
        },
        {
          activity_id: "user-input-closed-resolution",
          thread_id: "thread-w",
          turn_id: null,
          tone: "info",
          kind: "user-input.resolved",
          summary: "Closed question",
          payload_json: '{"requestId":"input-closed"}',
          sequence: null,
          created_at: "2026-03-01T00:00:04.000Z",
        },
        {
          activity_id: "user-input-tied-z-request",
          thread_id: "thread-w",
          turn_id: null,
          tone: "approval",
          kind: "user-input.requested",
          summary: "Tied open question",
          payload_json: '{"requestId":"input-tied-open"}',
          sequence: null,
          created_at: "2026-03-01T00:00:05.000Z",
        },
        {
          activity_id: "user-input-tied-a-resolution",
          thread_id: "thread-w",
          turn_id: null,
          tone: "info",
          kind: "user-input.resolved",
          summary: "Tied open question",
          payload_json: '{"requestId":"input-tied-open"}',
          sequence: null,
          created_at: "2026-03-01T00:00:05.000Z",
        },
      ])}`;
      yield* sql`INSERT INTO projection_pending_approvals ${sql.insert({
        request_id: "approval-1",
        thread_id: "thread-w",
        turn_id: null,
        status: "pending",
        decision: null,
        created_at: "2026-03-01T00:00:01.000Z",
        resolved_at: null,
      })}`;
      yield* sql`
        UPDATE projection_threads
        SET pending_approval_count = 1, pending_user_input_count = 1
        WHERE thread_id = 'thread-w'
      `;

      const detailWithPinnedRequests = yield* snapshotQuery.getThreadDetailById(threadW);
      assert.equal(detailWithPinnedRequests._tag, "Some");
      if (detailWithPinnedRequests._tag === "Some") {
        const ids = new Set(
          detailWithPinnedRequests.value.activities.map((activity) => activity.id),
        );
        assert.equal(detailWithPinnedRequests.value.activities.length, 503);
        assert.equal(ids.has(asEventId("approval-old")), true);
        assert.equal(ids.has(asEventId("user-input-old")), true);
        assert.equal(ids.has(asEventId("user-input-closed")), false);
        assert.equal(ids.has(asEventId("user-input-tied-z-request")), true);
      }

      const windowWithPinnedRequests = yield* snapshotQuery.getThreadDetailSnapshot(threadW, {
        turnLimit: 2,
      });
      assert.equal(windowWithPinnedRequests._tag, "Some");
      if (windowWithPinnedRequests._tag === "Some") {
        const ids = new Set(
          windowWithPinnedRequests.value.thread.activities.map((activity) => activity.id),
        );
        assert.equal(windowWithPinnedRequests.value.thread.activities.length, 503);
        assert.equal(ids.has(asEventId("approval-old")), true);
        assert.equal(ids.has(asEventId("user-input-old")), true);
        assert.equal(ids.has(asEventId("user-input-closed")), false);
        assert.equal(ids.has(asEventId("user-input-tied-z-request")), true);
      }

      const fullSnapshot = yield* snapshotQuery.getThreadDetailSnapshot(threadW);
      assert.equal(fullSnapshot._tag, "Some");
      if (
        detailWithPinnedRequests._tag === "Some" &&
        fullSnapshot._tag === "Some" &&
        windowWithPinnedRequests._tag === "Some"
      ) {
        const projectedFullSnapshot = projectThreadDetailSnapshot(fullSnapshot.value);
        const projectedRawBaseline = projectThreadDetailSnapshot({
          snapshotSequence: fullSnapshot.value.snapshotSequence,
          thread: detailWithPinnedRequests.value,
        });
        assert.deepStrictEqual(projectedFullSnapshot, projectedRawBaseline);

        const rawActivitiesById = new Map(
          detailWithPinnedRequests.value.activities.map((activity) => [activity.id, activity]),
        );
        const projectedWindowSnapshot = projectThreadDetailSnapshot(windowWithPinnedRequests.value);
        const projectedWindowBaseline = projectThreadDetailSnapshot({
          ...windowWithPinnedRequests.value,
          thread: {
            ...windowWithPinnedRequests.value.thread,
            activities: windowWithPinnedRequests.value.thread.activities.map(
              (activity) => rawActivitiesById.get(activity.id) ?? activity,
            ),
          },
        });
        assert.deepStrictEqual(projectedWindowSnapshot, projectedWindowBaseline);

        const projectedIds = new Set(
          projectedFullSnapshot.thread.activities.map((activity) => activity.id),
        );
        assert.equal(projectedIds.has(asEventId("activity-0002")), false);
        assert.equal(projectedIds.has(asEventId("activity-0003")), false);
        assert.equal(projectedIds.has(asEventId("activity-0070")), true);

        const failedCommand = projectedFullSnapshot.thread.activities.find(
          (activity) => activity.id === asEventId("activity-0011"),
        );
        assert.deepStrictEqual(failedCommand?.payload, {
          itemType: "command_execution",
          status: "failed",
          data: {
            item: {
              command: "vp test run",
              aggregatedOutput: "failed command",
            },
            files: [{ path: "apps/server/src/failed.ts" }],
            rawOutput: { content: "failed output" },
          },
        });
      }
    }),
  );

  it.effect("a thread with no turns returns its content unwindowed on the first page", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      yield* sql`DELETE FROM projection_projects`;
      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_turns`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_thread_activities`;
      yield* sql`DELETE FROM projection_state`;

      yield* sql`INSERT INTO projection_projects ${sql.insert({
        project_id: "project-e",
        title: "Empty",
        workspace_root: "/tmp/project-e",
        scripts_json: "[]",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        deleted_at: null,
      })}`;
      yield* sql`INSERT INTO projection_threads ${sql.insert({
        thread_id: "thread-e",
        project_id: "project-e",
        title: "Turnless thread",
        model_selection_json: '{"provider":"codex","model":"gpt-5-codex"}',
        runtime_mode: "full-access",
        interaction_mode: "default",
        pending_approval_count: 0,
        pending_user_input_count: 0,
        has_actionable_proposed_plan: 0,
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        deleted_at: null,
      })}`;
      yield* sql`INSERT INTO projection_thread_messages ${sql.insert({
        message_id: "pre-turn-msg",
        thread_id: "thread-e",
        turn_id: null,
        role: "user",
        text: "first prompt",
        is_streaming: 0,
        created_at: "2026-03-02T00:00:01.000Z",
        updated_at: "2026-03-02T00:00:01.000Z",
      })}`;
      for (const projector of Object.values(ORCHESTRATION_PROJECTOR_NAMES)) {
        yield* sql`INSERT INTO projection_state ${sql.insert({
          projector: projector,
          last_applied_sequence: 7,
          updated_at: "2026-03-02T00:00:01.000Z",
        })}`;
      }

      const snapshot = yield* snapshotQuery.getThreadDetailSnapshot(ThreadId.make("thread-e"), {
        turnLimit: 5,
      });
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.deepEqual(messageIds(snapshot.value), ["pre-turn-msg"]);
        assert.equal(snapshot.value.page?.hasMore, false);
        assert.equal(snapshot.value.page?.beforeCursor, null);
      }
    }),
  );
});
