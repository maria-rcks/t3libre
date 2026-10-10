import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("055_OrchestrationV2", (it) => {
  it.effect("keeps released migrations contiguous apart from ids claimed elsewhere", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        migrationEntries.map(([id]) => id),
        [...Array.from({ length: 60 }, (_, index) => index + 1), 64],
      );
    }),
  );

  it.effect("upgrades released schema 53 through the latest migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });

      const executed = yield* runMigrations();
      assert.deepStrictEqual(executed, [
        [54, "ProjectionThreadsAutoSettleDisabledAt"],
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
        [57, "ScheduledTaskWebhooks"],
        [58, "WebhookRelayDeliveries"],
        [59, "McpAppModelContext"],
        [60, "ThreadSnapshotWindowIndexes"],
        [64, "ProjectionThreadSweepIndexes"],
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);

      const migrations = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 48
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 48, name: "ProjectionThreadBranchPullRequest" },
        { migration_id: 49, name: "ProjectionThreadsActiveOrderKey" },
        { migration_id: 50, name: "ProjectionThreadPullRequests" },
        { migration_id: 51, name: "ProjectionThreadMessageContext" },
        { migration_id: 52, name: "ProjectionThreadTitleState" },
        { migration_id: 53, name: "PullRequestFilesViewed" },
        { migration_id: 54, name: "ProjectionThreadsAutoSettleDisabledAt" },
        { migration_id: 55, name: "OrchestrationV2" },
        { migration_id: 56, name: "RemoveRedundantProjectionIndexes" },
        { migration_id: 57, name: "ScheduledTaskWebhooks" },
        { migration_id: 58, name: "WebhookRelayDeliveries" },
        { migration_id: 59, name: "McpAppModelContext" },
        { migration_id: 60, name: "ThreadSnapshotWindowIndexes" },
        { migration_id: 64, name: "ProjectionThreadSweepIndexes" },
      ]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'orchestration_v2_projection_threads',
            'orchestration_v2_projection_subagents',
            'orchestration_v2_effect_outbox',
            'orchestration_v2_turn_item_positions',
            'orchestration_v2_projection_metadata',
            'orchestration_v2_projection_provider_session_bindings',
            'orchestration_v2_thread_launch_workflows',
            'orchestration_v2_legacy_imports',
            'scheduled_tasks'
          )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map(({ name }) => name),
        [
          "orchestration_v2_effect_outbox",
          "orchestration_v2_legacy_imports",
          "orchestration_v2_projection_metadata",
          "orchestration_v2_projection_provider_session_bindings",
          "orchestration_v2_projection_subagents",
          "orchestration_v2_projection_threads",
          "orchestration_v2_thread_launch_workflows",
          "orchestration_v2_turn_item_positions",
          "scheduled_tasks",
        ],
      );

      const eventColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_events)
      `;
      const receiptColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_command_receipts)
      `;
      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_v2_projection_threads)
      `;
      const subagentColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_v2_projection_subagents)
      `;
      assert.ok(eventColumns.some(({ name }) => name === "application_event_version"));
      assert.ok(receiptColumns.some(({ name }) => name === "command_type"));
      assert.ok(threadColumns.some(({ name }) => name === "provider_instance_id"));
      assert.ok(subagentColumns.some(({ name }) => name === "driver"));
      assert.ok(subagentColumns.some(({ name }) => name === "provider_instance_id"));

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_orchestration_events_application_high_water',
            'orchestration_events_v2_created_threads_idx',
            'orchestration_v2_projection_turn_items_shell_pending_idx'
          )
        ORDER BY name
      `;
      assert.deepStrictEqual(
        indexes.map(({ name }) => name),
        [
          "idx_orchestration_events_application_high_water",
          "orchestration_events_v2_created_threads_idx",
          "orchestration_v2_projection_turn_items_shell_pending_idx",
        ],
      );
    }),
  );

  it.effect("indexes sweep filters for existing threads and later payload-only writes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      const payload = JSON.stringify({
        settledAt: "2026-07-24T00:00:00.000Z",
        settledOverride: "settled",
        pinnedAt: "2026-07-23T00:00:00.000Z",
        autoSettleDisabledAt: "2026-07-22T00:00:00.000Z",
        forkedFrom: { type: "run", threadId: "source-thread" },
        pullRequests: [{ number: 1 }, { number: 2 }],
      });
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, provider_instance_id,
          runtime_mode, interaction_mode, created_at, updated_at, payload_json
        ) VALUES (
          'sweep-thread', 'sweep-project', 'Sweep thread', 'codex', 'codex',
          'full-access', 'default', '2026-07-24T00:00:00.000Z',
          '2026-07-24T00:00:00.000Z', ${payload}
        )
      `;
      yield* runMigrations();
      const sweep = sql<{ readonly thread_id: string; readonly pull_requests: number }>`
        SELECT thread_id, json_array_length(payload_json, '$.pullRequests') AS pull_requests
        FROM orchestration_v2_projection_threads
          INDEXED BY orchestration_v2_projection_threads_active_idx
        WHERE deleted_at IS NULL AND archived_at IS NULL
          AND json_extract(payload_json, '$.settledOverride') IS NULL
          AND json_extract(payload_json, '$.pinnedAt') = '2026-07-23T00:00:00.000Z'
          AND CASE
            WHEN json_extract(payload_json, '$.forkedFrom.type') = 'run'
              THEN json_extract(payload_json, '$.forkedFrom.threadId')
            ELSE NULL
          END = 'source-thread'
      `;
      assert.deepStrictEqual(yield* sweep, []);
      // An older build rewrites the payload alone; the index follows it.
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(
          json_remove(payload_json, '$.settledOverride'),
          '$.pullRequests',
          json('[{"number":1},{"number":2},{"number":3}]')
        )
        WHERE thread_id = 'sweep-thread'
      `;
      assert.deepStrictEqual(yield* sweep, [{ thread_id: "sweep-thread", pull_requests: 3 }]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  // Published previews ran PeerLinks as 61. Earlier builds of this change ran 61 and indexed
  // copied columns under the same index name.
  it.effect.each(["PeerLinks", "ProjectionThreadSweepColumns"])(
    "builds the sweep index over a database that ran %s as 61",
    (recorded) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 60 });
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (61, ${recorded})`;
        if (recorded === "ProjectionThreadSweepColumns") {
          yield* sql`
            CREATE INDEX orchestration_v2_projection_threads_active_idx
            ON orchestration_v2_projection_threads(updated_at, thread_id)
            WHERE deleted_at IS NULL AND archived_at IS NULL
          `;
        }
        assert.deepStrictEqual(yield* runMigrations(), [[64, "ProjectionThreadSweepIndexes"]]);
        const [index] = yield* sql<{ readonly sql: string }>`
          SELECT sql FROM sqlite_master WHERE name = 'orchestration_v2_projection_threads_active_idx'
        `;
        assert.include(index!.sql, "json_extract(payload_json, '$.settledOverride')");
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
