import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Background sweeps (settlement, pull request sync, the shell reads behind pull request
 * discovery) filtered every thread with `json_extract` on its payload, which holds every linked
 * pull request's snapshot: tens of KB parsed per thread per sweep. These columns copy the
 * fields they filter on out of the payload. ProjectionStore's thread upsert keeps them current.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(orchestration_v2_projection_threads)
  `;
  const existing = new Set(columns.map((column) => column.name));
  for (const [name, definition] of [
    ["settled_at", "TEXT"],
    ["settled_override", "TEXT"],
    ["pinned_at", "TEXT"],
    ["auto_settle_disabled_at", "TEXT"],
    ["forked_from_run_thread_id", "TEXT"],
    ["pull_request_count", "INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (!existing.has(name)) {
      yield* sql.unsafe(
        `ALTER TABLE orchestration_v2_projection_threads ADD COLUMN ${name} ${definition}`,
      ).unprepared;
    }
  }
  yield* sql`
    UPDATE orchestration_v2_projection_threads
    SET
      settled_at = json_extract(payload_json, '$.settledAt'),
      settled_override = json_extract(payload_json, '$.settledOverride'),
      pinned_at = json_extract(payload_json, '$.pinnedAt'),
      auto_settle_disabled_at = json_extract(payload_json, '$.autoSettleDisabledAt'),
      forked_from_run_thread_id = CASE
        WHEN json_extract(payload_json, '$.forkedFrom.type') = 'run'
          THEN json_extract(payload_json, '$.forkedFrom.threadId')
        ELSE NULL
      END,
      pull_request_count = COALESCE(json_array_length(payload_json, '$.pullRequests'), 0)
  `;
  // Covers the sweeps' filters and order without touching the payload. Columns added by
  // ALTER TABLE sit after the payload in each row, so reading them from the table walks the
  // payload's overflow pages.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_threads_active_idx
    ON orchestration_v2_projection_threads(
      updated_at,
      thread_id,
      settled_at,
      settled_override,
      pinned_at,
      auto_settle_disabled_at,
      pull_request_count,
      forked_from_run_thread_id,
      provider_instance_id
    )
    WHERE deleted_at IS NULL AND archived_at IS NULL
  `;
  // Usage-limit recovery only concerns threads whose latest run failed; this finds the few
  // threads with any failed run without reading the rest.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_projection_runs_failed_idx
    ON orchestration_v2_projection_runs(thread_id)
    WHERE status = 'failed'
  `;
});
