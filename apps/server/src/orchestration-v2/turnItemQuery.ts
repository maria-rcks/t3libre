/**
 * Reads one persisted turn item for the timeline's expanded tool rows. The
 * thread stream withholds tool output to keep it small; clients fetch it here
 * only when the user opens a row.
 */
import { OrchestrationV2TurnItemJson, type ThreadId, type TurnItemId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { projectTurnItemForDetail } from "./WireProjection.ts";

const decodeTurnItem = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2TurnItemJson),
);

export const readTurnItem = Effect.fn("orchestration.readTurnItem")(function* (input: {
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly payload_json: string }>`
    SELECT payload_json FROM orchestration_v2_projection_turn_items
    WHERE turn_item_id = ${input.itemId} AND thread_id = ${input.threadId}
  `;
  const row = rows[0];
  if (row === undefined) return { item: null };
  const item = yield* decodeTurnItem(row.payload_json);
  return { item: projectTurnItemForDetail(item) };
});
