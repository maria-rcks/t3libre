import {
  NonNegativeInt,
  PositiveInt,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  TurnId,
  type CanonicalItemType,
  type CanonicalRequestType,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { MuseSubscriptionUsage, museSubscriptionUsageToLimits } from "../Layers/museUsageLimits.ts";

const optionalString = Schema.optional(Schema.String);
const identity = { sessionId: Schema.String, viewCursor: Schema.String };
export const MuseItem = Schema.Struct({
  itemId: Schema.String,
  kind: Schema.String,
  revision: PositiveInt,
  status: Schema.String,
  turnId: Schema.optional(Schema.NullOr(Schema.String)),
  text: optionalString,
  summary: Schema.optional(Schema.Array(Schema.String)),
  tool: optionalString,
  args: optionalString,
  visibleOutput: optionalString,
  failureReason: optionalString,
  fallbackText: optionalString,
  commandText: optionalString,
  outcome: optionalString,
  tokensBefore: Schema.optional(NonNegativeInt),
  tokensAfter: Schema.optional(NonNegativeInt),
});
export type MuseItem = typeof MuseItem.Type;

const approvalChoice = Schema.Struct({
  choiceId: Schema.String,
  decision: Schema.String,
  label: Schema.String,
  scope: Schema.String,
  acceptsFeedback: Schema.optional(Schema.Boolean),
});
const approvalSubject = Schema.Struct({
  kind: Schema.String,
  command: optionalString,
  path: optionalString,
  access: optionalString,
  toolName: optionalString,
});
const approval = {
  ...identity,
  approvalId: Schema.String,
  availableChoices: Schema.Array(approvalChoice),
  currentRequirementId: Schema.Struct({ approvalId: Schema.String, sourceIndex: NonNegativeInt }),
  subject: approvalSubject,
};
const tokenUsage = Schema.Struct({
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cachedTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
});

export const MuseNotification = Schema.Union([
  Schema.Struct({ method: Schema.Literal("usage/changed"), params: MuseSubscriptionUsage }),
  Schema.Struct({
    method: Schema.Literals(["item/started", "item/updated", "item/completed"]),
    params: Schema.Struct({ ...identity, item: MuseItem }),
  }),
  Schema.Struct({
    method: Schema.Literal("item/delta"),
    params: Schema.Struct({
      ...identity,
      itemId: Schema.String,
      delta: Schema.String,
      field: optionalString,
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("turn/started"),
    params: Schema.Struct({ ...identity, turnId: Schema.String }),
  }),
  Schema.Struct({
    method: Schema.Literal("turn/retryScheduled"),
    params: Schema.Struct({
      ...identity,
      turnId: Schema.String,
      nextAttempt: PositiveInt,
      maxAttempts: PositiveInt,
      reason: Schema.String,
      retryDelayMs: NonNegativeInt,
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("turn/completed"),
    params: Schema.Struct({
      ...identity,
      turnId: Schema.String,
      terminal: Schema.String,
      reason: optionalString,
      error: Schema.optional(
        Schema.Struct({ kind: Schema.String, message: Schema.String, retryable: Schema.Boolean }),
      ),
      usage: Schema.optional(tokenUsage),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("turn/unqueued"),
    params: Schema.Struct({ ...identity, turnId: Schema.String }),
  }),
  Schema.Struct({
    method: Schema.Literal("approval/requested"),
    params: Schema.Struct({
      ...approval,
      itemId: Schema.String,
      turnId: Schema.String,
      toolName: Schema.String,
      rawArgs: Schema.String,
    }),
  }),
  Schema.Struct({ method: Schema.Literal("approval/updated"), params: Schema.Struct(approval) }),
  Schema.Struct({
    method: Schema.Literal("approval/resolved"),
    params: Schema.Struct({
      ...identity,
      approvalId: Schema.String,
      itemId: Schema.String,
      turnId: Schema.String,
      decision: Schema.String,
      amendment: Schema.optional(Schema.Struct({ durability: Schema.String })),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("userInput/requested"),
    params: Schema.Struct({
      ...identity,
      userInputId: Schema.String,
      itemId: Schema.String,
      turnId: Schema.String,
      questions: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          header: Schema.String,
          question: Schema.String,
          options: Schema.Array(
            Schema.Struct({ label: Schema.String, description: optionalString }),
          ),
          selection: Schema.Struct({
            mode: Schema.Literals(["single", "multiple"]),
            minSelections: Schema.optional(NonNegativeInt),
            maxSelections: Schema.optional(NonNegativeInt),
          }),
        }),
      ),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("userInput/settled"),
    params: Schema.Struct({
      ...identity,
      userInputId: Schema.String,
      answers: Schema.Array(
        Schema.Struct({
          questionId: Schema.String,
          freeText: optionalString,
          selectedLabel: optionalString,
          selectedLabels: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("session/todoListChanged"),
    params: Schema.Struct({
      ...identity,
      items: Schema.Array(Schema.Struct({ text: Schema.String, status: Schema.String })),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("session/tokenUsage"),
    params: Schema.Struct({
      ...identity,
      turnId: Schema.String,
      promptTokens: NonNegativeInt,
      totalTokens: NonNegativeInt,
      usage: tokenUsage,
      cumulative: Schema.Struct({
        promptTokens: NonNegativeInt,
        outputTokens: NonNegativeInt,
        totalTokens: NonNegativeInt,
      }),
    }),
  }),
  Schema.Struct({
    method: Schema.Literal("session/contextUsage"),
    params: Schema.Struct({
      ...identity,
      usedTokens: NonNegativeInt,
      windowTokens: Schema.optional(NonNegativeInt),
    }),
  }),
]);
export type MuseNotification = typeof MuseNotification.Type;
export const decodeMuseNotification = Schema.decodeUnknownSync(MuseNotification);

const notificationMethods: ReadonlySet<string> = new Set([
  "item/started",
  "item/updated",
  "item/completed",
  "item/delta",
  "turn/started",
  "turn/retryScheduled",
  "turn/completed",
  "turn/unqueued",
  "approval/requested",
  "approval/updated",
  "approval/resolved",
  "userInput/requested",
  "userInput/settled",
  "session/todoListChanged",
  "session/tokenUsage",
  "session/contextUsage",
  "usage/changed",
]);
export const isMuseNotificationMethod = (method: string): boolean =>
  notificationMethods.has(method);

export function museApprovalDecision(
  decision: string,
  scope?: string,
): ProviderApprovalDecision | undefined {
  switch (decision) {
    case "approved":
      return "accept";
    case "approvedForSession":
      return "acceptForSession";
    case "approvedPolicyAmendment":
      return scope === "session" ? "acceptForSession" : "acceptAlways";
    case "denied":
    case "deniedPolicyAmendment":
      return "decline";
    case "abort":
      return "cancel";
    default:
      return undefined;
  }
}

function itemType(item: MuseItem): CanonicalItemType {
  switch (item.kind) {
    case "userMessage":
      return "user_message";
    case "agentMessage":
      return "assistant_message";
    case "reasoning":
      return "reasoning";
    case "userShell":
      return "command_execution";
    case "toolCall":
      return "dynamic_tool_call";
    case "subagent":
      return "collab_agent_tool_call";
    case "compaction":
      return "context_compaction";
    default:
      return "unknown";
  }
}

function requestType(subject: typeof approvalSubject.Type): CanonicalRequestType {
  if (subject.kind === "shell") return "command_execution_approval";
  if (subject.kind === "fileAccess")
    return subject.access === "read" ? "file_read_approval" : "file_change_approval";
  return "mcp_elicitation_approval";
}

export interface MuseEventContext {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly createdAt: string;
  readonly nextEventId: () => EventId;
  readonly itemById: (id: string) => MuseItem | undefined;
  readonly streamedText: (itemId: string, field: string) => string;
  readonly activeTurnId?: TurnId;
  readonly contextUsedTokens?: number;
  readonly contextWindowTokens?: number;
  readonly approvalSubjectById?: (id: string) => typeof approvalSubject.Type | undefined;
}

/** Maps validated MSP facts; the adapter owns lifecycle and replay deduplication. */
export function mapMuseNotification(
  event: MuseNotification,
  context: MuseEventContext,
): ProviderRuntimeEvent[] {
  const base = {
    eventId: context.nextEventId(),
    provider: ProviderDriverKind.make("muse"),
    providerInstanceId: context.providerInstanceId,
    threadId: context.threadId,
    createdAt: context.createdAt,
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    raw: { source: "muse.msp.notification" as const, method: event.method, payload: event.params },
  };
  switch (event.method) {
    case "usage/changed": {
      const limits = museSubscriptionUsageToLimits(event.params);
      return [
        {
          ...base,
          type: "account.rate-limits.updated",
          payload: { limits: { windows: limits.windows, checkedAt: limits.checkedAt } },
        },
      ];
    }
    case "item/started":
    case "item/updated":
    case "item/completed": {
      const item = event.params.item;
      const type =
        event.method === "item/started"
          ? "item.started"
          : event.method === "item/updated"
            ? "item.updated"
            : "item.completed";
      const status =
        item.status === "inProgress"
          ? "inProgress"
          : item.status === "completed"
            ? "completed"
            : item.status === "rejected"
              ? "declined"
              : "failed";
      const detail =
        item.text ||
        item.summary?.join("\n") ||
        item.visibleOutput ||
        item.failureReason ||
        item.fallbackText;
      let input: Record<string, unknown> | undefined;
      if (item.args) {
        try {
          const parsed: unknown = JSON.parse(item.args);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          // Partial tool arguments are completed by later item updates.
        }
      }
      const result: ProviderRuntimeEvent[] = [
        {
          ...base,
          type,
          itemId: RuntimeItemId.make(item.itemId),
          ...(item.turnId ? { turnId: TurnId.make(item.turnId) } : {}),
          ...(item.turnId === null ? { turnId: undefined } : {}),
          payload: {
            itemType: itemType(item),
            status,
            ...(item.tool ? { title: item.tool === "read_file" ? "Read file" : item.tool } : {}),
            ...(detail ? { detail } : {}),
            data: {
              ...item,
              ...(input ? { input } : {}),
              ...(item.commandText ? { command: item.commandText } : {}),
              ...(typeof input?.file_path === "string" ? { path: input.file_path } : {}),
              ...(item.visibleOutput ? { rawOutput: item.visibleOutput } : {}),
            },
          },
        },
      ];
      // Single-shot completions can arrive without any streamed deltas.
      const textFields =
        item.kind === "agentMessage" || item.kind === "reasoning"
          ? [
              {
                field: "text",
                text: item.text,
                streamKind:
                  item.kind === "reasoning"
                    ? ("reasoning_text" as const)
                    : ("assistant_text" as const),
              },
              ...(item.summary ?? []).map((text, index) => ({
                field: `summary.${index}`,
                text,
                streamKind: "reasoning_summary_text" as const,
              })),
            ]
          : [];
      const backfill: ProviderRuntimeEvent[] = [];
      for (const { field, text, streamKind } of textFields) {
        const streamed = context.streamedText(item.itemId, field);
        if (!text || !text.startsWith(streamed) || text.length === streamed.length) continue;
        backfill.push({
          ...base,
          eventId: context.nextEventId(),
          type: "content.delta",
          itemId: RuntimeItemId.make(item.itemId),
          ...(item.turnId ? { turnId: TurnId.make(item.turnId) } : {}),
          payload: {
            streamKind,
            delta: text.slice(streamed.length),
            ...(field.startsWith("summary.") ? { summaryIndex: Number(field.slice(8)) } : {}),
          },
        });
      }
      if (item.kind === "compaction" && item.outcome === "compacted" && type === "item.completed") {
        result.push({
          ...base,
          eventId: context.nextEventId(),
          type: "thread.state.changed",
          payload: {
            state: "compacted",
            ...(item.tokensBefore !== undefined ? { beforeTokens: item.tokensBefore } : {}),
            ...(item.tokensAfter !== undefined ? { afterTokens: item.tokensAfter } : {}),
          },
        });
      }
      if (
        item.kind === "compaction" &&
        item.outcome !== "compacted" &&
        item.outcome !== "noop" &&
        type === "item.completed"
      ) {
        result.push({
          ...base,
          eventId: context.nextEventId(),
          type: "runtime.error",
          payload: {
            message: item.failureReason ?? `Muse Code compaction ${item.outcome ?? "failed"}.`,
          },
        });
      }
      return type === "item.started" ? [...result, ...backfill] : [...backfill, ...result];
    }
    case "item/delta": {
      const params = event.params;
      const item = context.itemById(params.itemId);
      const field = params.field ?? "text";
      if (field !== "text" && field !== "output" && !/^summary\.\d+$/.test(field)) return [];
      const streamKind = field.startsWith("summary.")
        ? "reasoning_summary_text"
        : field === "output"
          ? "command_output"
          : item?.kind === "reasoning"
            ? "reasoning_text"
            : item?.kind === "agentMessage"
              ? "assistant_text"
              : "unknown";
      return [
        {
          ...base,
          type: "content.delta",
          itemId: RuntimeItemId.make(params.itemId),
          ...(item?.turnId ? { turnId: TurnId.make(item.turnId) } : {}),
          ...(item?.turnId === null ? { turnId: undefined } : {}),
          payload: {
            streamKind,
            delta: params.delta,
            ...(field.startsWith("summary.") && /^summary\.\d+$/.test(field)
              ? { summaryIndex: Number(field.slice(8)) }
              : {}),
          },
        },
      ];
    }
    case "turn/retryScheduled":
      return [
        {
          ...base,
          type: "runtime.warning",
          turnId: TurnId.make(event.params.turnId),
          payload: {
            message: `Muse Code retry ${event.params.nextAttempt}/${event.params.maxAttempts} in ${event.params.retryDelayMs / 1_000}s: ${event.params.reason}`,
          },
        },
      ];
    case "turn/started":
      return [
        { ...base, type: "turn.started", turnId: TurnId.make(event.params.turnId), payload: {} },
      ];
    case "turn/completed": {
      const params = event.params;
      return [
        {
          ...base,
          type: "turn.completed",
          turnId: TurnId.make(params.turnId),
          payload: {
            state:
              params.terminal === "completed"
                ? "completed"
                : params.terminal === "cancelled"
                  ? "cancelled"
                  : "failed",
            ...(params.reason ? { stopReason: params.reason } : {}),
            ...(params.error?.message ? { errorMessage: params.error.message } : {}),
            ...(params.usage ? { usage: params.usage } : {}),
          },
        },
      ];
    }
    case "turn/unqueued":
      return [
        {
          ...base,
          type: "turn.aborted",
          turnId: TurnId.make(event.params.turnId),
          payload: { reason: "Queued turn removed" },
        },
      ];
    case "approval/requested":
    case "approval/updated": {
      const params = event.params;
      // T3 answers by decision, so each label must describe the first matching native choice.
      const options = params.availableChoices
        .flatMap((choice) => {
          const decision = museApprovalDecision(choice.decision, choice.scope);
          return decision ? [{ decision, label: choice.label }] : [];
        })
        .filter(
          (choice, index, choices) =>
            choices.findIndex((candidate) => candidate.decision === choice.decision) === index,
        );
      return [
        {
          ...base,
          type: "request.opened",
          requestId: RuntimeRequestId.make(params.approvalId),
          ...(event.method === "approval/requested"
            ? {
                turnId: TurnId.make(event.params.turnId),
                itemId: RuntimeItemId.make(event.params.itemId),
              }
            : {}),
          payload: {
            requestType: requestType(params.subject),
            detail:
              params.subject.command ||
              params.subject.path ||
              params.subject.toolName ||
              "Tool approval",
            options,
            args: params,
          },
        },
      ];
    }
    case "approval/resolved": {
      const subject = context.approvalSubjectById?.(event.params.approvalId);
      return [
        {
          ...base,
          type: "request.resolved",
          requestId: RuntimeRequestId.make(event.params.approvalId),
          turnId: TurnId.make(event.params.turnId),
          payload: {
            requestType: subject ? requestType(subject) : "unknown",
            decision:
              museApprovalDecision(event.params.decision, event.params.amendment?.durability) ??
              event.params.decision,
          },
        },
      ];
    }
    case "userInput/requested":
      return [
        {
          ...base,
          type: "user-input.requested",
          requestId: RuntimeRequestId.make(event.params.userInputId),
          itemId: RuntimeItemId.make(event.params.itemId),
          turnId: TurnId.make(event.params.turnId),
          payload: {
            questions: event.params.questions.map((question) => ({
              id: question.id,
              header: question.header,
              question: question.question,
              allowCustomAnswer: true,
              multiSelect: question.selection.mode === "multiple",
              options: question.options.map((option) => ({
                label: option.label,
                description: option.description ?? "",
              })),
            })),
          },
        },
      ];
    case "userInput/settled":
      return [
        {
          ...base,
          type: "user-input.resolved",
          requestId: RuntimeRequestId.make(event.params.userInputId),
          payload: {
            answers: Object.fromEntries(
              event.params.answers.map((answer) => [
                answer.questionId,
                answer.freeText ?? answer.selectedLabels ?? answer.selectedLabel ?? "",
              ]),
            ),
          },
        },
      ];
    case "session/todoListChanged":
      return [
        {
          ...base,
          type: "turn.plan.updated",
          payload: {
            plan: event.params.items
              .filter((item) => item.status !== "cancelled" && item.text.trim())
              .map((item) => ({
                step: item.text,
                status:
                  item.status === "completed"
                    ? "completed"
                    : item.status === "inProgress"
                      ? "inProgress"
                      : "pending",
              })),
          },
        },
      ];
    case "session/tokenUsage":
      if (context.contextUsedTokens === undefined) return [];
      return [
        {
          ...base,
          type: "thread.token-usage.updated",
          turnId: TurnId.make(event.params.turnId),
          payload: {
            usage: {
              usedTokens: context.contextUsedTokens,
              ...(context.contextWindowTokens ? { maxTokens: context.contextWindowTokens } : {}),
              totalProcessedTokens: event.params.cumulative.totalTokens,
              inputTokens: event.params.cumulative.promptTokens,
              outputTokens: event.params.cumulative.outputTokens,
              lastInputTokens: event.params.promptTokens,
              lastOutputTokens: event.params.usage.outputTokens,
              lastCachedInputTokens: event.params.usage.cachedTokens,
            },
          },
        },
      ];
    case "session/contextUsage":
      return [
        {
          ...base,
          type: "thread.token-usage.updated",
          payload: {
            usage: {
              usedTokens: event.params.usedTokens,
              ...(event.params.windowTokens ? { maxTokens: event.params.windowTokens } : {}),
            },
          },
        },
      ];
  }
}
