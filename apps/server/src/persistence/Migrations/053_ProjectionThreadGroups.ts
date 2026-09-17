import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_groups (
      group_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon_json TEXT,
      name_generation_request_id TEXT,
      name_generation_started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_groups_project_id
    ON projection_thread_groups(project_id)
  `;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "group_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN group_id TEXT`;
  }
});
