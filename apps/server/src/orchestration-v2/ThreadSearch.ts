import {
  IsoDateTime,
  MessageId,
  type OrchestrationFindThreadInput,
  type OrchestrationFindThreadResult,
  OrchestrationThreadSearchSource,
  type OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

/** Carries no query text: search input is user content. */
export class ThreadSearchError extends Schema.TaggedError<ThreadSearchError>()(
  "ThreadSearchError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread search ${this.operation} failed.`;
  }
}

const SearchRequest = Schema.Struct({ pattern: Schema.String, limit: Schema.Int });
const SearchRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  matchText: Schema.String,
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});

function escapeLikePattern(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

/** At most 240 characters, centred near the first match. */
function buildSearchSnippet(text: string, query: string): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= 240) {
    return normalizedText;
  }
  const normalizedQuery = foldAsciiCase(query.replace(/\s+/g, " ").trim());
  const matchIndex = foldAsciiCase(normalizedText).indexOf(normalizedQuery);
  const bodyLength = 236;
  const idealStart = Math.max(0, matchIndex - 72);
  const start = Math.min(idealStart, normalizedText.length - bodyLength);
  const end = Math.min(normalizedText.length, start + bodyLength);
  return `${start > 0 ? "…" : ""}${normalizedText.slice(start, end)}${
    end < normalizedText.length ? "…" : ""
  }`;
}

/**
 * Searches the finished user and assistant messages of active V2 threads in
 * active projects. Legacy V1 transcripts that have not been imported yet are
 * not searched.
 */
export class ThreadSearch extends Context.Service<
  ThreadSearch,
  {
    readonly find: (
      input: OrchestrationFindThreadInput,
    ) => Effect.Effect<OrchestrationFindThreadResult, ThreadSearchError>;
    readonly search: (
      input: OrchestrationSearchThreadsInput,
    ) => Effect.Effect<OrchestrationSearchThreadsResult, ThreadSearchError>;
  }
>()("t3/orchestration-v2/ThreadSearch") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One best match per thread: user messages outrank assistant ones, then the
  // newest message wins. Threads order by match kind, then recency.
  const searchRows = SqlSchema.findAll({
    Request: SearchRequest,
    Result: SearchRow,
    execute: ({ pattern, limit }) => sql`
      WITH candidate AS (
        SELECT
          threads.thread_id,
          threads.project_id,
          messages.role,
          json_extract(messages.payload_json, '$.text') AS match_text,
          messages.created_at AS message_created_at,
          messages.message_id,
          threads.updated_at AS thread_updated_at
        FROM orchestration_v2_projection_messages AS messages
        INNER JOIN orchestration_v2_projection_threads AS threads
          ON threads.thread_id = messages.thread_id
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.deleted_at IS NULL
          AND threads.archived_at IS NULL
          AND projects.deleted_at IS NULL
          AND messages.streaming = 0
          AND messages.role IN ('user', 'assistant')
          AND json_extract(messages.payload_json, '$.text') LIKE ${pattern} ESCAPE '!'
      ),
      ranked AS (
        SELECT
          thread_id,
          project_id,
          role AS source,
          match_text,
          message_created_at,
          CASE role WHEN 'user' THEN 0 ELSE 1 END AS match_rank,
          thread_updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY thread_id
            ORDER BY
              CASE role WHEN 'user' THEN 0 ELSE 1 END ASC,
              message_created_at DESC,
              message_id ASC
          ) AS thread_match_rank
        FROM candidate
      )
      SELECT
        thread_id AS "threadId",
        project_id AS "projectId",
        source,
        match_text AS "matchText",
        message_created_at AS "messageCreatedAt"
      FROM ranked
      WHERE thread_match_rank = 1
      ORDER BY match_rank ASC, thread_updated_at DESC, thread_id ASC
      LIMIT ${limit}
    `,
  });

  const search: ThreadSearch["Service"]["search"] = Effect.fn("ThreadSearch.search")(
    function* (input) {
      const rows = yield* searchRows({
        pattern: `%${escapeLikePattern(input.query)}%`,
        limit: input.limit ?? 50,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ThreadSearchError({
              operation: Schema.isSchemaError(cause) ? "decode" : "query",
              cause,
            }),
        ),
      );
      return {
        matches: rows.map((row) => ({
          threadId: row.threadId,
          projectId: row.projectId,
          source: row.source,
          snippet: buildSearchSnippet(row.matchText, input.query),
          messageCreatedAt: row.messageCreatedAt,
        })),
      };
    },
  );

  // Inherited items are a fork snapshot: later source rollbacks do not hide them.
  // Only the requested thread applies live visibility; ancestors stop at their fork run.
  const findRow = SqlSchema.findAll({
    Request: Schema.Struct({ threadId: ThreadId, query: Schema.String, index: Schema.Int }),
    Result: Schema.Struct({
      total: Schema.Int,
      messageId: Schema.NullOr(MessageId),
      occurrence: Schema.NullOr(Schema.Int),
    }),
    execute: ({ threadId, query, index }) => sql`
      WITH RECURSIVE history(thread_id, payload_json, cutoff, depth, visited) AS (
        SELECT threads.thread_id, threads.payload_json, NULL, 0, json_array()
        FROM orchestration_v2_projection_threads AS threads
        INNER JOIN projection_projects AS projects ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL AND projects.deleted_at IS NULL
        UNION ALL
        SELECT source.thread_id, source.payload_json, fork_run.ordinal, history.depth + 1,
          json_insert(history.visited, '$[#]', history.thread_id)
        FROM history
        INNER JOIN orchestration_v2_projection_threads AS source
          ON source.thread_id = json_extract(history.payload_json, '$.forkedFrom.threadId')
        INNER JOIN orchestration_v2_projection_runs AS fork_run
          ON fork_run.thread_id = source.thread_id
          AND fork_run.run_id = json_extract(history.payload_json, '$.forkedFrom.runId')
        WHERE json_extract(history.payload_json, '$.forkedFrom.type') = 'run'
          AND NOT EXISTS (SELECT 1 FROM json_each(history.visited) WHERE value = source.thread_id)
      ), visible_items AS (
        SELECT item.payload_json, item.type, history.depth, item.ordinal, item.turn_item_id
        FROM history
        INNER JOIN orchestration_v2_projection_turn_items AS item ON item.thread_id = history.thread_id
        LEFT JOIN orchestration_v2_projection_runs AS run
          ON run.run_id = item.run_id AND run.thread_id = item.thread_id
        WHERE item.type IN ('user_message', 'assistant_message', 'user_input_request')
          AND (
            (history.depth = 0
              AND (run.status IS NULL OR run.status <> 'rolled_back')
              AND NOT (item.type = 'user_message'
                AND json_extract(item.payload_json, '$.inputIntent') IS 'queued_turn'
                AND run.status IS 'cancelled'))
            OR (history.depth > 0 AND (
              run.ordinal <= history.cutoff
              OR (item.run_id IS NULL AND json_extract(history.payload_json, '$.historyOrigin') = 'v1_import')
            ))
          )
      ), messages AS (
        SELECT json_extract(item.payload_json, '$.messageId') AS message_id,
          item.depth, item.ordinal, item.turn_item_id,
          lower(json_extract(item.payload_json, '$.text')) AS text
        FROM visible_items AS item
        WHERE item.type IN ('user_message', 'assistant_message')
          AND NOT (item.type = 'user_message' AND json_extract(item.payload_json, '$.messageId') IN (
            SELECT 'async-answer:' || json_extract(request.payload_json, '$.questionAnswer.requestId')
            FROM visible_items AS request
            WHERE request.type = 'user_input_request'
              AND json_extract(request.payload_json, '$.questionAnswer.requestId') IS NOT NULL
          ))
      ), counts AS (
        SELECT message_id, depth, ordinal, turn_item_id,
          (length(text) - length(replace(text, lower(${query}), ''))) / length(${query}) AS count
        FROM messages
      ), positions AS (
        SELECT message_id, count,
          sum(count) OVER (ORDER BY depth DESC, ordinal, turn_item_id ROWS UNBOUNDED PRECEDING) AS end_index
        FROM counts WHERE count > 0
      ), total AS (
        SELECT coalesce(sum(count), 0) AS count FROM counts
      )
      SELECT total.count AS total, positions.message_id AS "messageId",
        ${index} - (positions.end_index - positions.count) AS occurrence
      FROM total LEFT JOIN positions
        ON ${index} >= positions.end_index - positions.count AND ${index} < positions.end_index
    `,
  });

  const find: ThreadSearch["Service"]["find"] = Effect.fn("ThreadSearch.find")(function* (input) {
    const rows = yield* findRow({
      threadId: input.threadId,
      query: input.query,
      index: input.index ?? 0,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ThreadSearchError({
            operation: Schema.isSchemaError(cause) ? "decode" : "query",
            cause,
          }),
      ),
    );
    const row = rows[0];
    return {
      total: row?.total ?? 0,
      match:
        row?.messageId != null && row.occurrence !== null
          ? { messageId: row.messageId, occurrence: row.occurrence }
          : null,
    };
  });

  return ThreadSearch.of({ search, find });
});

export const layer = Layer.effect(ThreadSearch, make);
