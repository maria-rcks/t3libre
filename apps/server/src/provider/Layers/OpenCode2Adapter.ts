// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";

import {
  EventId,
  type OpenCode2Settings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  type ToolLifecycleItemType,
  TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import {
  type OpenCode2Connection,
  type OpenCode2Event,
  type OpenCode2RequestInput,
  OpenCode2Runtime,
  OpenCode2RuntimeError,
} from "../openCode2Runtime.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("opencode2");
const RESUME_VERSION = 1 as const;

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const UnknownRecordArraySchema = Schema.Array(UnknownRecordSchema);
const SessionResponseSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
  }),
});
const MessagesResponseSchema = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
});

const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodeUnknownRecordArray = Schema.decodeUnknownOption(UnknownRecordArraySchema);

type OpenCode2AdapterError =
  | ProviderAdapterProcessError
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

export type OpenCode2AdapterShape = ProviderAdapterShape<OpenCode2AdapterError>;

interface OpenCode2TurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface OpenCode2SessionContext {
  session: ProviderSession;
  readonly providerSessionId: string;
  readonly pendingPermissions: Set<string>;
  readonly pendingForms: Set<string>;
  readonly toolNameByCallId: Map<string, string>;
  activeTurnId: TurnId | undefined;
  currentModel: string | undefined;
  currentVariant: string | undefined;
  currentAgent: string | undefined;
  regularAgent: string;
}

export interface OpenCode2AdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface ModelRef {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
}

interface EventBaseInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string;
  readonly requestId?: string;
  readonly raw?: OpenCode2Event;
}

interface OpenCode2ActiveConnection {
  readonly connection: OpenCode2Connection;
  readonly interrupt: Effect.Effect<void>;
}

function recordFromUnknown(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return Option.getOrUndefined(decodeUnknownRecord(value));
}

function recordsFromUnknown(value: unknown): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return Option.getOrElse(decodeUnknownRecordArray(value), () => []);
}

function stringField(
  record: Readonly<Record<string, unknown>> | undefined,
  ...keys: ReadonlyArray<string>
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function eventData(event: OpenCode2Event): Readonly<Record<string, unknown>> | undefined {
  const outer = recordFromUnknown(event.data);
  return recordFromUnknown(outer?.properties) ?? outer;
}

function eventSessionId(event: OpenCode2Event): string | undefined {
  const data = eventData(event);
  const form = recordFromUnknown(data?.form) ?? recordFromUnknown(data?.info);
  return (
    stringField(data, "sessionID", "sessionId") ??
    stringField(form, "sessionID", "sessionId") ??
    event.durable?.aggregateID
  );
}

function normalizeEventType(type: string): string {
  const withoutVersion = type.replace(/\.\d+$/u, "");
  return withoutVersion.startsWith("session.next.")
    ? `session.${withoutVersion.slice("session.next.".length)}`
    : withoutVersion;
}

function parseResumeCursor(raw: unknown): string | undefined {
  const record = recordFromUnknown(raw);
  if (record?.schemaVersion !== RESUME_VERSION) return undefined;
  return stringField(record, "sessionId");
}

function parseModelRef(model: string, variant?: string): ModelRef | undefined {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return undefined;
  return {
    providerID: model.slice(0, separator),
    id: model.slice(separator + 1),
    ...(variant ? { variant } : {}),
  };
}

function toToolLifecycleItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("command")
  ) {
    return "command_execution";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return "file_change";
  }
  if (normalized.includes("web")) return "web_search";
  if (normalized.includes("mcp")) return "mcp_tool_call";
  if (normalized.includes("image")) return "image_view";
  if (normalized.includes("task") || normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  return "dynamic_tool_call";
}

function permissionRequestType(
  action: string,
): "command_execution_approval" | "file_read_approval" | "file_change_approval" | "unknown" {
  switch (action) {
    case "bash":
    case "shell":
      return "command_execution_approval";
    case "read":
      return "file_read_approval";
    case "edit":
    case "write":
      return "file_change_approval";
    default:
      return "unknown";
  }
}

function permissionReply(decision: "accept" | "acceptForSession" | "decline" | "cancel") {
  switch (decision) {
    case "accept":
      return "once" as const;
    case "acceptForSession":
      return "always" as const;
    case "decline":
    case "cancel":
      return "reject" as const;
  }
}

function permissionDecision(reply: string): string {
  switch (reply) {
    case "once":
      return "accept";
    case "always":
      return "acceptForSession";
    default:
      return "decline";
  }
}

function formFromEvent(event: OpenCode2Event): Readonly<Record<string, unknown>> | undefined {
  const data = eventData(event);
  return recordFromUnknown(data?.form) ?? recordFromUnknown(data?.info) ?? data;
}

function formQuestions(form: Readonly<Record<string, unknown>>): ReadonlyArray<UserInputQuestion> {
  return recordsFromUnknown(form.fields).map((field) => {
    const id = stringField(field, "key", "id") ?? "answer";
    const title = stringField(field, "title", "label") ?? id;
    const description = stringField(field, "description") ?? title;
    const type = stringField(field, "type");
    const options = recordsFromUnknown(field.options).map((option) => {
      const label = stringField(option, "label", "value") ?? "Option";
      return {
        label,
        description: stringField(option, "description") ?? label,
      };
    });
    if (type === "boolean" && options.length === 0) {
      options.push({ label: "Yes", description: "Yes" }, { label: "No", description: "No" });
    }
    return {
      id,
      header: title,
      question: description,
      options,
      ...(type === "multiselect" ? { multiSelect: true } : {}),
    };
  });
}

function contentItemId(
  data: Readonly<Record<string, unknown>>,
  kind: "text" | "reasoning",
): string {
  const explicit = stringField(data, kind === "text" ? "textID" : "reasoningID", "id");
  if (explicit) return explicit;
  const messageId = stringField(data, "assistantMessageID", "messageID") ?? "message";
  const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0;
  return `${messageId}-${kind}-${ordinal}`;
}

function toolDetail(data: Readonly<Record<string, unknown>>): string | undefined {
  const error = recordFromUnknown(data.error);
  const errorMessage = stringField(error, "message", "detail");
  if (errorMessage) return errorMessage;
  if (typeof data.error === "string" && data.error.trim().length > 0) return data.error;
  const texts = recordsFromUnknown(data.content)
    .map((item) => stringField(item, "text"))
    .filter((value): value is string => value !== undefined);
  if (texts.length > 0) return texts.join("\n");
  if (typeof data.result === "string" && data.result.trim().length > 0) return data.result;
  return undefined;
}

function toRequestError(method: string, cause: OpenCode2RuntimeError) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: cause.detail,
    cause,
  });
}

function toProcessError(threadId: ThreadId, cause: OpenCode2RuntimeError) {
  return new ProviderAdapterProcessError({
    provider: PROVIDER,
    threadId,
    detail: cause.detail,
    cause,
  });
}

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function makeOpenCode2Adapter(
  settings: OpenCode2Settings,
  options?: OpenCode2AdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const runtime = yield* OpenCode2Runtime;
    const serverConfig = yield* ServerConfig;
    const scope = yield* Effect.scope;
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("opencode2");
    const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, OpenCode2SessionContext>();
    const sessionByProviderId = new Map<string, OpenCode2SessionContext>();
    const connectionLock = yield* Semaphore.make(1);
    let activeConnection: OpenCode2ActiveConnection | undefined;
    let eventCounter = 0;

    const buildEventBase = Effect.fn("OpenCode2Adapter.buildEventBase")(function* (
      input: EventBaseInput,
    ) {
      eventCounter += 1;
      return {
        eventId: EventId.make(`opencode2-event-${eventCounter}`),
        provider: PROVIDER,
        providerInstanceId: instanceId,
        threadId: input.threadId,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
        ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
        ...(input.raw
          ? {
              raw: {
                source: "opencode2.api.event" as const,
                payload: input.raw,
              },
            }
          : {}),
      };
    });

    const emit = (event: ProviderRuntimeEvent) => Queue.offer(events, event).pipe(Effect.asVoid);

    const ensureSession = Effect.fn("OpenCode2Adapter.ensureSession")(function* (
      threadId: ThreadId,
    ) {
      const context = sessions.get(threadId);
      if (!context) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId,
        });
      }
      return context;
    });

    const updateSession = Effect.fn("OpenCode2Adapter.updateSession")(function* (
      context: OpenCode2SessionContext,
      patch: Partial<ProviderSession>,
      clear?: "activeTurnId" | "lastError",
    ) {
      const next = {
        ...context.session,
        ...patch,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      } as ProviderSession & Record<string, unknown>;
      if (clear) delete next[clear];
      context.session = next;
      return next;
    });

    const completeTurn = Effect.fn("OpenCode2Adapter.completeTurn")(function* (
      context: OpenCode2SessionContext,
      state: "completed" | "failed" | "interrupted",
      raw: OpenCode2Event,
      errorMessage?: string,
    ) {
      const turnId = context.activeTurnId;
      if (!turnId) return;
      context.activeTurnId = undefined;
      yield* updateSession(
        context,
        {
          status: state === "failed" ? "error" : "ready",
          ...(errorMessage ? { lastError: errorMessage } : {}),
        },
        "activeTurnId",
      );
      yield* emit({
        ...(yield* buildEventBase({ threadId: context.session.threadId, turnId, raw })),
        type: "turn.completed",
        payload: {
          state,
          ...(errorMessage ? { errorMessage } : {}),
        },
      });
    });

    const writeNativeEvent = (
      context: OpenCode2SessionContext,
      event: OpenCode2Event,
      observedAt: string,
    ) =>
      options?.nativeEventLogger
        ? options.nativeEventLogger
            .write(
              {
                observedAt,
                event: {
                  provider: PROVIDER,
                  threadId: context.session.threadId,
                  providerThreadId: context.providerSessionId,
                  type: event.type,
                  payload: event,
                },
              },
              context.session.threadId,
            )
            .pipe(Effect.catchCause(() => Effect.void))
        : Effect.void;

    const handleEvent = Effect.fn("OpenCode2Adapter.handleEvent")(function* (
      event: OpenCode2Event,
    ) {
      if (normalizeEventType(event.type) === "server.connected") {
        return;
      }
      const providerSessionId = eventSessionId(event);
      if (!providerSessionId) return;
      const context = sessionByProviderId.get(providerSessionId);
      if (!context) return;
      const data = eventData(event);
      if (!data) return;
      const type = normalizeEventType(event.type);
      const turnId = context.activeTurnId;
      yield* writeNativeEvent(context, event, DateTime.formatIso(yield* DateTime.now));

      switch (type) {
        case "session.text.started": {
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: contentItemId(data, "text"),
              raw: event,
            })),
            type: "item.started",
            payload: {
              itemType: "assistant_message",
              status: "inProgress",
              title: "Assistant message",
            },
          });
          break;
        }

        case "session.reasoning.started": {
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: contentItemId(data, "reasoning"),
              raw: event,
            })),
            type: "item.started",
            payload: {
              itemType: "reasoning",
              status: "inProgress",
              title: "Reasoning",
            },
          });
          break;
        }

        case "session.text.delta":
        case "session.reasoning.delta": {
          const delta = stringField(data, "delta");
          if (!delta) break;
          const kind = type === "session.text.delta" ? "text" : "reasoning";
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: contentItemId(data, kind),
              raw: event,
            })),
            type: "content.delta",
            payload: {
              streamKind: kind === "text" ? "assistant_text" : "reasoning_text",
              delta,
            },
          });
          break;
        }

        case "session.reasoning.ended": {
          const text = stringField(data, "text");
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: contentItemId(data, "reasoning"),
              raw: event,
            })),
            type: "item.completed",
            payload: {
              itemType: "reasoning",
              status: "completed",
              title: "Reasoning",
              ...(text ? { detail: text } : {}),
            },
          });
          break;
        }

        case "session.text.ended": {
          const text = stringField(data, "text");
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: contentItemId(data, "text"),
              raw: event,
            })),
            type: "item.completed",
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              ...(text ? { detail: text } : {}),
            },
          });
          break;
        }

        case "session.tool.input.started": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const tool = stringField(data, "tool", "name") ?? "tool";
          context.toolNameByCallId.set(callId, tool);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: "item.started",
            payload: {
              itemType: toToolLifecycleItemType(tool),
              status: "inProgress",
              title: tool,
            },
          });
          break;
        }

        case "session.tool.input.delta":
        case "session.tool.input.ended": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const tool = context.toolNameByCallId.get(callId) ?? "tool";
          const detail = stringField(data, "delta", "text");
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: "item.updated",
            payload: {
              itemType: toToolLifecycleItemType(tool),
              status: "inProgress",
              title: tool,
              ...(detail ? { detail } : {}),
              data,
            },
          });
          break;
        }

        case "session.tool.called": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const tool = stringField(data, "tool", "name") ?? "tool";
          const inputStarted = context.toolNameByCallId.has(callId);
          context.toolNameByCallId.set(callId, tool);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: inputStarted ? "item.updated" : "item.started",
            payload: {
              itemType: toToolLifecycleItemType(tool),
              status: "inProgress",
              title: tool,
              data: {
                tool,
                input: data.input,
              },
            },
          });
          break;
        }

        case "session.tool.progress":
        case "session.tool.success":
        case "session.tool.failed": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const tool = context.toolNameByCallId.get(callId) ?? "tool";
          const terminal = type !== "session.tool.progress";
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: terminal ? "item.completed" : "item.updated",
            payload: {
              itemType: toToolLifecycleItemType(tool),
              status:
                type === "session.tool.failed" ? "failed" : terminal ? "completed" : "inProgress",
              title: tool,
              ...(toolDetail(data) ? { detail: toolDetail(data) } : {}),
              data,
            },
          });
          if (terminal) context.toolNameByCallId.delete(callId);
          break;
        }

        case "permission.asked": {
          const requestId = stringField(data, "id", "requestID");
          if (!requestId) break;
          const action = stringField(data, "action", "permission") ?? "unknown";
          const resources = Array.isArray(data.resources)
            ? data.resources.filter((value): value is string => typeof value === "string")
            : Array.isArray(data.patterns)
              ? data.patterns.filter((value): value is string => typeof value === "string")
              : [];
          context.pendingPermissions.add(requestId);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              requestId,
              raw: event,
            })),
            type: "request.opened",
            payload: {
              requestType: permissionRequestType(action),
              detail: resources.length > 0 ? resources.join("\n") : action,
              args: data.metadata ?? data.source,
            },
          });
          break;
        }

        case "permission.replied": {
          const requestId = stringField(data, "requestID", "id");
          if (!requestId) break;
          context.pendingPermissions.delete(requestId);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              requestId,
              raw: event,
            })),
            type: "request.resolved",
            payload: {
              requestType: "unknown",
              decision: permissionDecision(stringField(data, "reply") ?? "reject"),
            },
          });
          break;
        }

        case "form.created": {
          const form = formFromEvent(event);
          if (!form) break;
          const formId = stringField(form, "id", "formID");
          if (!formId) break;
          context.pendingForms.add(formId);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              requestId: formId,
              raw: event,
            })),
            type: "user-input.requested",
            payload: {
              questions: formQuestions(form),
            },
          });
          break;
        }

        case "form.replied":
        case "form.cancelled": {
          const form = formFromEvent(event);
          const formId = form ? stringField(form, "id", "formID") : undefined;
          if (!formId) break;
          context.pendingForms.delete(formId);
          const answer = recordFromUnknown(data.answer) ?? recordFromUnknown(data.answers) ?? {};
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              requestId: formId,
              raw: event,
            })),
            type: "user-input.resolved",
            payload: {
              answers: type === "form.cancelled" ? {} : answer,
            },
          });
          break;
        }

        case "session.execution.settled": {
          const outcome = stringField(data, "outcome", "state") ?? "success";
          const error = recordFromUnknown(data.error);
          const message = stringField(error, "message", "detail") ?? stringField(data, "message");
          yield* completeTurn(
            context,
            outcome === "failure" || outcome === "failed"
              ? "failed"
              : outcome === "interrupted" || outcome === "cancelled"
                ? "interrupted"
                : "completed",
            event,
            message,
          );
          break;
        }

        case "session.execution.succeeded":
        case "session.idle":
          yield* completeTurn(context, "completed", event);
          break;

        case "session.execution.interrupted":
          yield* completeTurn(context, "interrupted", event);
          break;

        case "session.execution.failed":
        case "session.error": {
          const error = recordFromUnknown(data.error);
          const message =
            stringField(error, "message", "detail") ??
            stringField(data, "message") ??
            "OpenCode 2 session failed.";
          yield* completeTurn(context, "failed", event, message);
          break;
        }

        default:
          break;
      }
    });

    const reportConnectionFailure = (cause: OpenCode2RuntimeError) =>
      Effect.forEach(
        sessions.values(),
        (context) =>
          Effect.gen(function* () {
            yield* updateSession(context, {
              status: "error",
              lastError: cause.detail,
            });
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.session.threadId })),
              type: "runtime.error",
              payload: {
                message: cause.detail,
                class: "transport_error",
              },
            });
          }),
        { discard: true },
      );

    const invalidateConnection = (entry: OpenCode2ActiveConnection) =>
      Effect.gen(function* () {
        if (activeConnection !== entry) return;
        activeConnection = undefined;
        yield* entry.interrupt;
      });

    const ensureConnection = connectionLock.withPermit(
      Effect.gen(function* () {
        if (activeConnection) return activeConnection;

        const connection = yield* runtime.attach({
          binaryPath: settings.binaryPath,
          ...(options?.environment ? { environment: options.environment } : {}),
        });
        const connected = yield* Deferred.make<void, OpenCode2RuntimeError>();
        const streamFailure = yield* Ref.make<Option.Option<OpenCode2RuntimeError>>(Option.none());
        const eventFiber = yield* connection.globalEvents.pipe(
          Stream.runForEach((event) =>
            normalizeEventType(event.type) === "server.connected"
              ? Deferred.succeed(connected, undefined).pipe(Effect.ignore)
              : handleEvent(event),
          ),
          Effect.flatMap(() =>
            Effect.fail(
              new OpenCode2RuntimeError({
                operation: "event.subscribe",
                kind: "connection",
                detail: "OpenCode 2 event stream ended before the adapter detached.",
              }),
            ),
          ),
          Effect.catchTag("OpenCode2RuntimeError", (cause) =>
            Effect.gen(function* () {
              yield* Ref.set(streamFailure, Option.some(cause));
              yield* Deferred.fail(connected, cause).pipe(Effect.ignore);
              if (activeConnection?.connection === connection) activeConnection = undefined;
              yield* reportConnectionFailure(cause);
            }),
          ),
          Effect.forkIn(scope),
        );
        const interrupt = Fiber.interrupt(eventFiber).pipe(Effect.asVoid);
        const handshake = yield* Deferred.await(connected).pipe(Effect.timeoutOption("10 seconds"));
        if (Option.isNone(handshake)) {
          yield* interrupt;
          return yield* new OpenCode2RuntimeError({
            operation: "event.subscribe",
            kind: "connection",
            detail: "Timed out waiting for OpenCode 2 server.connected.",
          });
        }

        const entry = { connection, interrupt } satisfies OpenCode2ActiveConnection;
        const failedBeforeActivation = yield* Ref.get(streamFailure);
        if (Option.isSome(failedBeforeActivation)) {
          yield* interrupt;
          return yield* failedBeforeActivation.value;
        }
        activeConnection = entry;
        const failedDuringActivation = yield* Ref.get(streamFailure);
        if (Option.isSome(failedDuringActivation)) {
          activeConnection = undefined;
          yield* interrupt;
          return yield* failedDuringActivation.value;
        }
        return entry;
      }),
    );

    const request = <S extends Schema.Top>(
      method: "GET" | "POST",
      path: string,
      input: OpenCode2RequestInput<S>,
    ) =>
      ensureConnection.pipe(
        Effect.flatMap((entry) =>
          entry.connection
            .request(method, path, input)
            .pipe(Effect.tapError(() => invalidateConnection(entry))),
        ),
      );

    const interruptContext = Effect.fn("OpenCode2Adapter.interruptContext")(function* (
      context: OpenCode2SessionContext,
      turnId?: TurnId,
    ) {
      yield* request(
        "POST",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/interrupt`,
        {
          operation: "session.interrupt",
          schema: Schema.Void,
        },
      ).pipe(Effect.mapError((cause) => toRequestError("session.interrupt", cause)));
      const interruptedTurnId = turnId ?? context.activeTurnId;
      context.activeTurnId = undefined;
      yield* updateSession(context, { status: "ready" }, "activeTurnId");
      if (interruptedTurnId) {
        yield* emit({
          ...(yield* buildEventBase({
            threadId: context.session.threadId,
            turnId: interruptedTurnId,
          })),
          type: "turn.aborted",
          payload: { reason: "Interrupted by user." },
        });
      }
    });

    const detachContext = Effect.fn("OpenCode2Adapter.detachContext")(function* (
      context: OpenCode2SessionContext,
    ) {
      if (context.activeTurnId) {
        yield* interruptContext(context, context.activeTurnId);
      }
      sessions.delete(context.session.threadId);
      sessionByProviderId.delete(context.providerSessionId);
      yield* emit({
        ...(yield* buildEventBase({ threadId: context.session.threadId })),
        type: "session.exited",
        payload: {
          reason: "Session detached.",
          recoverable: true,
          exitKind: "graceful",
        },
      });
    });

    const startSession: OpenCode2AdapterShape["startSession"] = Effect.fn(
      "OpenCode2Adapter.startSession",
    )(function* (input) {
      if (!settings.enabled) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "OpenCode 2 is disabled in provider settings.",
        });
      }
      const directory = input.cwd ?? serverConfig.cwd;
      const selectedModel = input.modelSelection?.model;
      if (input.modelSelection && input.modelSelection.instanceId !== instanceId) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `OpenCode 2 model selection is bound to instance '${input.modelSelection.instanceId}', expected '${instanceId}'.`,
        });
      }
      const variant = getModelSelectionStringOptionValue(input.modelSelection, "variant");
      const modelRef = selectedModel ? parseModelRef(selectedModel, variant) : undefined;
      if (selectedModel && !modelRef) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: "OpenCode 2 model selection must use the 'provider/model' format.",
        });
      }
      const agent = getModelSelectionStringOptionValue(input.modelSelection, "agent");
      const resumeSessionId = parseResumeCursor(input.resumeCursor);
      const resolved = resumeSessionId
        ? yield* request("GET", `/api/session/${encodedPathSegment(resumeSessionId)}`, {
            operation: "session.get",
            schema: SessionResponseSchema,
          }).pipe(Effect.mapError((cause) => toProcessError(input.threadId, cause)))
        : yield* request("POST", "/api/session", {
            operation: "session.create",
            schema: SessionResponseSchema,
            body: {
              ...(input.title ? { title: input.title } : {}),
              location: { directory },
              ...(modelRef ? { model: modelRef } : {}),
              ...(agent ? { agent } : {}),
            },
          }).pipe(Effect.mapError((cause) => toProcessError(input.threadId, cause)));
      const providerSessionId = resolved.data.id;
      const staleContexts = new Set<OpenCode2SessionContext>();
      const previousForThread = sessions.get(input.threadId);
      const previousForProvider = sessionByProviderId.get(providerSessionId);
      if (previousForThread) staleContexts.add(previousForThread);
      if (previousForProvider) staleContexts.add(previousForProvider);
      for (const stale of staleContexts) {
        yield* detachContext(stale);
      }
      if (resumeSessionId && modelRef) {
        yield* request("POST", `/api/session/${encodedPathSegment(providerSessionId)}/model`, {
          operation: "session.switchModel",
          schema: Schema.Void,
          body: { model: modelRef },
        }).pipe(Effect.mapError((cause) => toProcessError(input.threadId, cause)));
      }
      if (resumeSessionId && agent) {
        yield* request("POST", `/api/session/${encodedPathSegment(providerSessionId)}/agent`, {
          operation: "session.switchAgent",
          schema: Schema.Void,
          body: { agent },
        }).pipe(Effect.mapError((cause) => toProcessError(input.threadId, cause)));
      }
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: instanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        cwd: directory,
        ...(selectedModel ? { model: selectedModel } : {}),
        threadId: input.threadId,
        resumeCursor: {
          schemaVersion: RESUME_VERSION,
          sessionId: providerSessionId,
        },
        createdAt,
        updatedAt: createdAt,
      };
      const context: OpenCode2SessionContext = {
        session,
        providerSessionId,
        pendingPermissions: new Set(),
        pendingForms: new Set(),
        toolNameByCallId: new Map(),
        activeTurnId: undefined,
        currentModel: selectedModel,
        currentVariant: variant,
        currentAgent: agent ?? "build",
        regularAgent: agent ?? "build",
      };
      sessions.set(input.threadId, context);
      sessionByProviderId.set(providerSessionId, context);
      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "session.started",
        payload: {
          message: "OpenCode 2 session attached",
          resume: session.resumeCursor,
        },
      });
      yield* emit({
        ...(yield* buildEventBase({ threadId: input.threadId })),
        type: "thread.started",
        payload: {
          providerThreadId: providerSessionId,
        },
      });
      return session;
    });

    const sendTurn: OpenCode2AdapterShape["sendTurn"] = Effect.fn("OpenCode2Adapter.sendTurn")(
      function* (input) {
        const context = yield* ensureSession(input.threadId);
        const connection = yield* ensureConnection.pipe(
          Effect.map((entry) => entry.connection),
          Effect.mapError((cause) => toRequestError("connection.attach", cause)),
        );
        if (input.modelSelection && input.modelSelection.instanceId !== instanceId) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: `OpenCode 2 model selection is bound to instance '${input.modelSelection.instanceId}', expected '${instanceId}'.`,
          });
        }
        const text = input.input?.trim() ?? "";
        const attachments = input.attachments ?? [];
        if (text.length === 0 && attachments.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "OpenCode 2 turns require text input or at least one attachment.",
          });
        }
        const files: Array<{ readonly uri: string; readonly name: string }> = [];
        for (const attachment of attachments) {
          const path = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          });
          if (!path) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: `OpenCode 2 attachment '${attachment.name}' is unavailable.`,
            });
          }
          files.push({
            uri: NodeURL.pathToFileURL(path).href,
            name: attachment.name,
          });
        }

        const selectedModel = input.modelSelection?.model ?? context.session.model;
        const variant = input.modelSelection
          ? getModelSelectionStringOptionValue(input.modelSelection, "variant")
          : context.currentVariant;
        const modelRef = selectedModel ? parseModelRef(selectedModel, variant) : undefined;
        if (selectedModel && !modelRef) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "OpenCode 2 model selection must use the 'provider/model' format.",
          });
        }
        if (
          modelRef &&
          (selectedModel !== context.currentModel || variant !== context.currentVariant)
        ) {
          yield* request(
            "POST",
            `/api/session/${encodedPathSegment(context.providerSessionId)}/model`,
            {
              operation: "session.switchModel",
              schema: Schema.Void,
              body: { model: modelRef },
            },
          ).pipe(Effect.mapError((cause) => toRequestError("session.switchModel", cause)));
          context.currentModel = selectedModel;
          context.currentVariant = variant;
        }

        const explicitAgent = getModelSelectionStringOptionValue(input.modelSelection, "agent");
        const selectedAgent =
          input.interactionMode === "plan" ? "plan" : (explicitAgent ?? context.regularAgent);
        if (input.interactionMode !== "plan" && explicitAgent) {
          context.regularAgent = explicitAgent;
        }
        if (selectedAgent && selectedAgent !== context.currentAgent) {
          yield* request(
            "POST",
            `/api/session/${encodedPathSegment(context.providerSessionId)}/agent`,
            {
              operation: "session.switchAgent",
              schema: Schema.Void,
              body: { agent: selectedAgent },
            },
          ).pipe(Effect.mapError((cause) => toRequestError("session.switchAgent", cause)));
          context.currentAgent = selectedAgent;
        }

        const steeringTurnId = context.activeTurnId;
        eventCounter += 1;
        const turnId = steeringTurnId ?? TurnId.make(`opencode2-turn-${eventCounter}`);
        context.activeTurnId = turnId;
        yield* updateSession(
          context,
          {
            status: "running",
            activeTurnId: turnId,
            ...(selectedModel ? { model: selectedModel } : {}),
          },
          "lastError",
        );
        if (!steeringTurnId) {
          yield* emit({
            ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
            type: "turn.started",
            payload: {
              ...(selectedModel ? { model: selectedModel } : {}),
              ...(variant ? { effort: variant } : {}),
            },
          });
        }

        const prompt = {
          text,
          ...(files.length > 0 ? { files } : {}),
        };
        const body =
          connection.protocol.promptShape === "flat"
            ? { ...prompt, delivery: "steer" as const }
            : { prompt, delivery: "steer" as const };
        yield* request(
          "POST",
          `/api/session/${encodedPathSegment(context.providerSessionId)}/prompt`,
          {
            operation: "session.prompt",
            schema: Schema.Unknown,
            body,
          },
        ).pipe(
          Effect.mapError((cause) => toRequestError("session.prompt", cause)),
          Effect.tapError((cause) =>
            steeringTurnId
              ? Effect.void
              : Effect.gen(function* () {
                  context.activeTurnId = undefined;
                  yield* updateSession(
                    context,
                    { status: "ready", lastError: cause.detail },
                    "activeTurnId",
                  );
                  yield* emit({
                    ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                    type: "turn.aborted",
                    payload: { reason: cause.detail },
                  });
                }),
          ),
        );
        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: context.session.resumeCursor,
        };
      },
    );

    const interruptTurn: OpenCode2AdapterShape["interruptTurn"] = Effect.fn(
      "OpenCode2Adapter.interruptTurn",
    )(function* (threadId, turnId) {
      const context = yield* ensureSession(threadId);
      yield* interruptContext(context, turnId);
    });

    const respondToRequest: OpenCode2AdapterShape["respondToRequest"] = Effect.fn(
      "OpenCode2Adapter.respondToRequest",
    )(function* (threadId, requestId, decision) {
      const context = yield* ensureSession(threadId);
      if (!context.pendingPermissions.has(requestId)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "permission.reply",
          detail: `Unknown pending permission request: ${requestId}`,
        });
      }
      yield* request(
        "POST",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/permission/${encodedPathSegment(requestId)}/reply`,
        {
          operation: "permission.reply",
          schema: Schema.Void,
          body: { reply: permissionReply(decision) },
        },
      ).pipe(Effect.mapError((cause) => toRequestError("permission.reply", cause)));
    });

    const respondToUserInput: OpenCode2AdapterShape["respondToUserInput"] = Effect.fn(
      "OpenCode2Adapter.respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const context = yield* ensureSession(threadId);
      if (!context.pendingForms.has(requestId)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "form.reply",
          detail: `Unknown pending form request: ${requestId}`,
        });
      }
      yield* request(
        "POST",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/form/${encodedPathSegment(requestId)}/reply`,
        {
          operation: "form.reply",
          schema: Schema.Void,
          body: { answer: answers },
        },
      ).pipe(Effect.mapError((cause) => toRequestError("form.reply", cause)));
    });

    const detachSession = Effect.fn("OpenCode2Adapter.detachSession")(function* (
      threadId: ThreadId,
    ) {
      const context = yield* ensureSession(threadId);
      yield* detachContext(context);
    });

    const readThread: OpenCode2AdapterShape["readThread"] = Effect.fn(
      "OpenCode2Adapter.readThread",
    )(function* (threadId) {
      const context = yield* ensureSession(threadId);
      const response = yield* request(
        "GET",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/message`,
        {
          operation: "message.list",
          schema: MessagesResponseSchema,
          query: { order: "asc" },
        },
      ).pipe(Effect.mapError((cause) => toRequestError("message.list", cause)));
      const turns: Array<OpenCode2TurnSnapshot> = [];
      for (const message of response.data) {
        const record = recordFromUnknown(message);
        if (!record || stringField(record, "type", "role") !== "assistant") continue;
        const id = stringField(record, "id");
        if (!id) continue;
        turns.push({
          id: TurnId.make(id),
          items: Array.isArray(record.content) ? [...record.content] : [record],
        });
      }
      return { threadId, turns } satisfies ProviderThreadSnapshot;
    });

    const rollbackThread: OpenCode2AdapterShape["rollbackThread"] = Effect.fn(
      "OpenCode2Adapter.rollbackThread",
    )(function* (threadId, numTurns) {
      const context = yield* ensureSession(threadId);
      const snapshot = yield* readThread(threadId);
      if (numTurns <= 0) return snapshot;
      const target = snapshot.turns[snapshot.turns.length - numTurns];
      if (!target) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: `Cannot roll back ${numTurns} OpenCode 2 turns from a thread with ${snapshot.turns.length} turns.`,
        });
      }
      yield* request(
        "POST",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/revert/stage`,
        {
          operation: "session.revert.stage",
          schema: Schema.Unknown,
          body: { messageID: target.id },
        },
      ).pipe(Effect.mapError((cause) => toRequestError("session.revert.stage", cause)));
      yield* request(
        "POST",
        `/api/session/${encodedPathSegment(context.providerSessionId)}/revert/commit`,
        {
          operation: "session.revert.commit",
          schema: Schema.Void,
        },
      ).pipe(Effect.mapError((cause) => toRequestError("session.revert.commit", cause)));
      return yield* readThread(threadId);
    });

    const stopAll: OpenCode2AdapterShape["stopAll"] = () =>
      Effect.forEach([...sessions.keys()], detachSession, {
        concurrency: "unbounded",
        discard: true,
      });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.ignoreCause,
        Effect.ensuring(
          Effect.sync(() => {
            sessions.clear();
            sessionByProviderId.clear();
          }),
        ),
        Effect.ensuring(Queue.shutdown(events)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession: detachSession,
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((context) => context.session)),
      hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
      readThread,
      rollbackThread,
      stopAll,
      get streamEvents() {
        return Stream.fromQueue(events);
      },
    } satisfies OpenCode2AdapterShape;
  });
}
