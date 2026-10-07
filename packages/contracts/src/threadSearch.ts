import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  MessageId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const OrchestrationThreadSearchSource = Schema.Literals(["user", "assistant"]);
export type OrchestrationThreadSearchSource = typeof OrchestrationThreadSearchSource.Type;

// The server's SQLite client is synchronous and single-connection. Bound both
// scan input and response size so a search cannot monopolize that connection.
export const OrchestrationSearchThreadsInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type OrchestrationSearchThreadsInput = typeof OrchestrationSearchThreadsInput.Type;

export const OrchestrationThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String.check(Schema.isMaxLength(240)),
  messageCreatedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationThreadSearchMatch = typeof OrchestrationThreadSearchMatch.Type;

export const OrchestrationSearchThreadsResult = Schema.Struct({
  matches: Schema.Array(OrchestrationThreadSearchMatch),
});
export type OrchestrationSearchThreadsResult = typeof OrchestrationSearchThreadsResult.Type;

export class OrchestrationSearchThreadsError extends Schema.TaggedError<OrchestrationSearchThreadsError>()(
  "OrchestrationSearchThreadsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** One occurrence at a time keeps navigation bounded even in very long threads. */
export const OrchestrationFindThreadInput = Schema.Struct({
  threadId: ThreadId,
  query: TrimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  index: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type OrchestrationFindThreadInput = typeof OrchestrationFindThreadInput.Type;

export const OrchestrationFindThreadResult = Schema.Struct({
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  match: Schema.NullOr(
    Schema.Struct({
      messageId: MessageId,
      occurrence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type OrchestrationFindThreadResult = typeof OrchestrationFindThreadResult.Type;
