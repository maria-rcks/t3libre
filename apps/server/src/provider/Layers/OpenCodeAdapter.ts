// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";

import {
  EventId,
  type OpenCodeSettings,
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
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import type { ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import * as OpenCodeRuntime from "../opencodeRuntime.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("opencode");
const RESUME_VERSION = 1 as const;

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const UnknownRecordArraySchema = Schema.Array(UnknownRecordSchema);
const SessionResponseSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    location: Schema.optionalKey(
      Schema.Struct({
        directory: Schema.String,
      }),
    ),
  }),
});
const MessagesResponseSchema = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
});

const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecordSchema);
const decodeUnknownRecordArray = Schema.decodeUnknownOption(UnknownRecordArraySchema);
const decodeUnknownJsonString = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

interface OpenCodeTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface OpenCodeToolCallState {
  readonly name: string;
  input?: unknown;
  inputText?: string;
}

interface OpenCodeSessionContext {
  session: ProviderSession;
  readonly providerSessionId: string;
  readonly pendingPermissions: Set<string>;
  readonly pendingForms: Map<string, Readonly<Record<string, unknown>>>;
  readonly toolsByCallId: Map<string, OpenCodeToolCallState>;
  activeTurnId: TurnId | undefined;
  currentModel: string | undefined;
  currentVariant: string | undefined;
  currentAgent: string | undefined;
  regularAgent: string;
}

export interface OpenCodeAdapterLiveOptions {
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
  readonly raw?: OpenCodeRuntime.OpenCodeEvent;
}

interface OpenCodeActiveConnection {
  readonly connection: OpenCodeRuntime.OpenCodeConnection;
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

function eventData(
  event: OpenCodeRuntime.OpenCodeEvent,
): Readonly<Record<string, unknown>> | undefined {
  const outer = recordFromUnknown(event.data);
  return recordFromUnknown(outer?.properties) ?? outer;
}

function eventSessionId(event: OpenCodeRuntime.OpenCodeEvent): string | undefined {
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

export function isSameOpenCodeDirectory(
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  left: string,
  right: string,
): Effect.Effect<boolean> {
  const lexicalLeft = path.resolve(left);
  const lexicalRight = path.resolve(right);
  if (lexicalLeft === lexicalRight) return Effect.succeed(true);
  const canonicalize = (value: string) =>
    fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value));
  return Effect.zipWith(
    canonicalize(lexicalLeft),
    canonicalize(lexicalRight),
    (canonicalLeft, canonicalRight) => canonicalLeft === canonicalRight,
  );
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

/** Human title for the common OpenCode 2 built-in tools; unknown tools keep their raw name. */
function openCodeToolTitle(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized === "read") return "Reading file";
  if (normalized === "grep" || normalized.includes("search")) return "Searching files";
  if (normalized === "glob" || normalized.includes("find")) return "Finding files";
  if (normalized === "shell" || normalized.includes("bash")) return "Running command";
  if (normalized.includes("edit") || normalized.includes("patch")) return "Editing file";
  if (normalized.includes("write")) return "Writing file";
  if (normalized.includes("fetch")) return "Fetching page";
  if (normalized.includes("task") || normalized.includes("agent")) return "Running agent";
  return toolName;
}

/**
 * Short human summary of a tool call's input for the row preview. OpenCode 2
 * streams inputs as raw JSON text; parse out the field a human would scan.
 */
function openCodeToolInputDetail(toolName: string, input: unknown): string | undefined {
  const record = recordFromUnknown(input);
  if (!record) return undefined;
  const firstString = (...keys: ReadonlyArray<string>) => stringField(record, ...keys);
  const normalized = toolName.toLowerCase();
  if (normalized === "grep" || normalized === "glob" || /search|find|list/u.test(normalized)) {
    return firstString("pattern", "query", "include");
  }
  if (/fetch|web/u.test(normalized)) return firstString("url");
  if (/read|edit|write|patch|apply/u.test(normalized)) {
    return firstString("filePath", "path", "file");
  }
  return firstString("command", "script", "url", "pattern", "filePath", "path", "file", "query");
}

/**
 * Shape clients already understand: `toolCallId` keys started/updated/completed
 * merges, and a flattened `command` lets them show live command previews.
 */
function toolItemData(callId: string, state: OpenCodeToolCallState): Record<string, unknown> {
  const inputRecord = recordFromUnknown(state.input);
  const command =
    typeof inputRecord?.command === "string" && inputRecord.command.trim().length > 0
      ? inputRecord.command
      : undefined;
  return {
    toolCallId: callId,
    tool: state.name,
    ...(state.input !== undefined ? { input: state.input } : {}),
    ...(command ? { command } : {}),
  };
}

/**
 * OpenCode 2's shell tool pads empty output with "(no output)" and always
 * appends an exit-code line; drop the placeholder and the exit-0 line so quiet
 * commands render as quietly succeeding.
 */
function cleanToolOutputText(text: string): string | undefined {
  let cleaned = text.replace(/^\(no output\)\s*/u, "");
  const match = /(?:^|\n)\s*Command exited with code (\d+)\.\s*$/u.exec(cleaned);
  if (match?.[1] === "0") {
    cleaned = cleaned.slice(0, match.index).trimEnd();
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned : undefined;
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

function formFromEvent(
  event: OpenCodeRuntime.OpenCodeEvent,
): Readonly<Record<string, unknown>> | undefined {
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

/**
 * Clients reply with option labels, display indices ("2"), or raw values.
 * OpenCode 2 validates against the field's option `value` ("choose"), so
 * translate through the options captured from form.created before replying.
 */
function normalizeFormAnswers(
  form: Readonly<Record<string, unknown>>,
  answers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fields = recordsFromUnknown(form.fields);
  const toOptionValue =
    (options: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
    (candidate: unknown): unknown => {
      if (typeof candidate !== "string") return candidate;
      const text = candidate.trim();
      if (text.length === 0 || options.some((option) => stringField(option, "value") === text)) {
        return text;
      }
      const byLabel = options.find(
        (option) => stringField(option, "label", "value")?.toLowerCase() === text.toLowerCase(),
      );
      if (byLabel) return stringField(byLabel, "value");
      if (/^\d+$/u.test(text)) {
        const index = Number.parseInt(text, 10);
        const option = index >= 1 && index <= options.length ? options[index - 1] : undefined;
        if (option) return stringField(option, "value");
      }
      return text;
    };
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    const options = recordsFromUnknown(
      fields.find((field) => stringField(field, "key", "id") === key)?.options,
    );
    const translate = toOptionValue(options);
    normalized[key] = Array.isArray(value) ? value.map(translate) : translate(value);
  }
  return normalized;
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
  if (texts.length > 0) return cleanToolOutputText(texts.join("\n"));
  if (typeof data.result === "string" && data.result.trim().length > 0) {
    return cleanToolOutputText(data.result);
  }
  return undefined;
}

function toRequestError(method: string, cause: OpenCodeRuntime.OpenCodeRuntimeFailure) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `OpenCode 2 request failed during '${method}'.`,
    cause,
  });
}

function toProcessError(threadId: ThreadId, cause: OpenCodeRuntime.OpenCodeRuntimeFailure) {
  return new ProviderAdapterProcessError({
    provider: PROVIDER,
    threadId,
    detail: `OpenCode 2 could not attach the requested session during '${cause.operation}'.`,
    cause,
  });
}

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value);
}

function isMissingOpenCodeSession(cause: OpenCodeRuntime.OpenCodeRuntimeFailure): boolean {
  return (
    OpenCodeRuntime.isOpenCodeRuntimeError(cause) &&
    cause.reason === "http-status" &&
    cause.status === 404
  );
}

function shouldInvalidateConnection(cause: OpenCodeRuntime.OpenCodeRuntimeFailure): boolean {
  return (
    OpenCodeRuntime.isOpenCodeRuntimeError(cause) &&
    (cause.reason === "transport" ||
      cause.reason === "connection-ended" ||
      (cause.reason === "http-status" && cause.status === 401))
  );
}

export function makeOpenCodeAdapter(
  settings: OpenCodeSettings,
  options?: OpenCodeAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scope = yield* Effect.scope;
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("opencode");
    const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, OpenCodeSessionContext>();
    const sessionByProviderId = new Map<string, OpenCodeSessionContext>();
    const connectionLock = yield* Semaphore.make(1);
    const sessionStartLock = yield* Semaphore.make(1);
    let activeConnection: OpenCodeActiveConnection | undefined;
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate an OpenCode runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = Effect.map(randomUUIDv4, EventId.make);
    const nextTurnId = Effect.map(randomUUIDv4, TurnId.make);

    const buildEventBase = Effect.fn("OpenCodeAdapter.buildEventBase")(function* (
      input: EventBaseInput,
    ) {
      return {
        eventId: yield* nextEventId,
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
                source: "opencode.api.event" as const,
                payload: input.raw,
              },
            }
          : {}),
      };
    });

    const emit = (event: ProviderRuntimeEvent) => Queue.offer(events, event).pipe(Effect.asVoid);

    const ensureSession = Effect.fn("OpenCodeAdapter.ensureSession")(function* (
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

    const updateSession = Effect.fn("OpenCodeAdapter.updateSession")(function* (
      context: OpenCodeSessionContext,
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

    const completeTurn = Effect.fn("OpenCodeAdapter.completeTurn")(function* (
      context: OpenCodeSessionContext,
      state: "completed" | "failed" | "interrupted",
      raw: OpenCodeRuntime.OpenCodeEvent | undefined,
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
        ...(yield* buildEventBase({
          threadId: context.session.threadId,
          turnId,
          ...(raw ? { raw } : {}),
        })),
        type: "turn.completed",
        payload: {
          state,
          ...(errorMessage ? { errorMessage } : {}),
        },
      });
    });

    const writeNativeEvent = (
      context: OpenCodeSessionContext,
      event: OpenCodeRuntime.OpenCodeEvent,
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

    const handleEvent = Effect.fn("OpenCodeAdapter.handleEvent")(function* (
      event: OpenCodeRuntime.OpenCodeEvent,
      connection: OpenCodeRuntime.OpenCodeConnection,
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
          context.toolsByCallId.set(callId, { name: tool });
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
              title: openCodeToolTitle(tool),
            },
          });
          break;
        }

        case "session.tool.input.delta":
        case "session.tool.input.ended": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const state = context.toolsByCallId.get(callId);
          if (!state) break;
          if (type === "session.tool.input.delta") {
            const delta = stringField(data, "delta", "text");
            if (delta) state.inputText = `${state.inputText ?? ""}${delta}`;
          } else if (state.input === undefined) {
            // input.ended normally carries the full JSON text. Fall back to
            // accumulated deltas for compatible servers that omit it.
            const rawInput = stringField(data, "text") ?? state.inputText;
            if (rawInput) {
              state.input = Option.getOrElse(decodeUnknownJsonString(rawInput), () => rawInput);
            }
          }
          const detail = openCodeToolInputDetail(state.name, state.input);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: "item.updated",
            payload: {
              itemType: toToolLifecycleItemType(state.name),
              status: "inProgress",
              title: openCodeToolTitle(state.name),
              ...(detail ? { detail } : {}),
              data: toolItemData(callId, state),
            },
          });
          break;
        }

        case "session.tool.called": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const tool = stringField(data, "tool", "name") ?? "tool";
          const state = context.toolsByCallId.get(callId);
          if (state && data.input !== undefined) {
            state.input = data.input;
          } else if (!state) {
            context.toolsByCallId.set(callId, { name: tool, input: data.input });
          }
          const resolved = context.toolsByCallId.get(callId)!;
          const detail = openCodeToolInputDetail(resolved.name, resolved.input);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId,
              itemId: callId,
              raw: event,
            })),
            type: state ? "item.updated" : "item.started",
            payload: {
              itemType: toToolLifecycleItemType(resolved.name),
              status: "inProgress",
              title: openCodeToolTitle(resolved.name),
              ...(detail ? { detail } : {}),
              data: toolItemData(callId, resolved),
            },
          });
          break;
        }

        case "session.tool.progress":
        case "session.tool.success":
        case "session.tool.failed": {
          const callId = stringField(data, "callID", "id");
          if (!callId) break;
          const state = context.toolsByCallId.get(callId);
          const tool = state?.name ?? stringField(data, "tool", "name") ?? "tool";
          const terminal = type !== "session.tool.progress";
          const output = terminal ? toolDetail(data) : undefined;
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
              title: openCodeToolTitle(tool),
              ...(output ? { detail: output } : {}),
              data: {
                ...toolItemData(callId, state ?? { name: tool }),
                ...(output ? { output } : {}),
              },
            },
          });
          if (terminal) context.toolsByCallId.delete(callId);
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
          if (context.session.runtimeMode === "full-access") {
            const replied = yield* connection
              .request(
                "POST",
                `/api/session/${encodedPathSegment(context.providerSessionId)}/permission/${encodedPathSegment(requestId)}/reply`,
                {
                  operation: "permission.reply",
                  schema: Schema.Void,
                  body: { reply: "once" },
                },
              )
              .pipe(
                Effect.as(true),
                Effect.catchCause(() => Effect.succeed(false)),
              );
            if (replied) break;
          }
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
          context.pendingForms.set(formId, form);
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

    const reportConnectionFailure = (cause: OpenCodeRuntime.OpenCodeRuntimeFailure) =>
      Effect.forEach(
        sessions.values(),
        (context) =>
          Effect.gen(function* () {
            if (context.activeTurnId) {
              yield* completeTurn(context, "failed", undefined, cause.message);
            } else {
              yield* updateSession(context, {
                status: "error",
                lastError: cause.message,
              });
            }
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.session.threadId })),
              type: "runtime.error",
              payload: {
                message: cause.message,
                class: "transport_error",
              },
            });
          }),
        { discard: true },
      );

    const invalidateConnection = (entry: OpenCodeActiveConnection) =>
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
        const connected = yield* Deferred.make<void, OpenCodeRuntime.OpenCodeRuntimeFailure>();
        const streamFailure = yield* Ref.make<
          Option.Option<OpenCodeRuntime.OpenCodeRuntimeFailure>
        >(Option.none());
        const handleStreamFailure = (cause: OpenCodeRuntime.OpenCodeRuntimeFailure) =>
          Effect.gen(function* () {
            yield* Ref.set(streamFailure, Option.some(cause));
            yield* Deferred.fail(connected, cause).pipe(Effect.ignore);
            if (activeConnection?.connection === connection) activeConnection = undefined;
            yield* reportConnectionFailure(cause);
          });
        const eventFiber = yield* connection.globalEvents.pipe(
          Stream.runForEach((event) =>
            normalizeEventType(event.type) === "server.connected"
              ? Deferred.succeed(connected, undefined).pipe(Effect.ignore)
              : handleEvent(event, connection).pipe(
                  Effect.mapError(
                    (cause) =>
                      new OpenCodeRuntime.OpenCodeRuntimeError({
                        operation: "event.process",
                        reason: "transport",
                        cause,
                      }),
                  ),
                ),
          ),
          Effect.flatMap(() =>
            Effect.fail(
              new OpenCodeRuntime.OpenCodeRuntimeError({
                operation: "event.subscribe",
                reason: "connection-ended",
              }),
            ),
          ),
          Effect.catchTags({
            OpenCodeRuntimeError: handleStreamFailure,
            OpenCodeUnsupportedPreviewError: handleStreamFailure,
            OpenCodeCommandNotFoundError: handleStreamFailure,
            OpenCodeTimeoutError: handleStreamFailure,
          }),
          Effect.forkIn(scope),
        );
        const interrupt = Fiber.interrupt(eventFiber).pipe(Effect.asVoid);
        const handshake = yield* Deferred.await(connected).pipe(Effect.timeoutOption("10 seconds"));
        if (Option.isNone(handshake)) {
          yield* interrupt;
          return yield* new OpenCodeRuntime.OpenCodeTimeoutError({
            operation: "event.subscribe",
          });
        }

        const entry = { connection, interrupt } satisfies OpenCodeActiveConnection;
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
      input: OpenCodeRuntime.OpenCodeRequestInput<S>,
    ) =>
      ensureConnection.pipe(
        Effect.flatMap((entry) =>
          entry.connection
            .request(method, path, input)
            .pipe(
              Effect.tapError((cause) =>
                shouldInvalidateConnection(cause) ? invalidateConnection(entry) : Effect.void,
              ),
            ),
        ),
      );

    const interruptContext = Effect.fn("OpenCodeAdapter.interruptContext")(function* (
      context: OpenCodeSessionContext,
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

    const detachContext = Effect.fn("OpenCodeAdapter.detachContext")(function* (
      context: OpenCodeSessionContext,
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

    const startSessionUnlocked: OpenCodeAdapterShape["startSession"] = Effect.fn(
      "OpenCodeAdapter.startSession",
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
      const createSession = request("POST", "/api/session", {
        operation: "session.create",
        schema: SessionResponseSchema,
        body: {
          ...(input.title ? { title: input.title } : {}),
          location: { directory },
          ...(modelRef ? { model: modelRef } : {}),
          ...(agent ? { agent } : {}),
        },
      }).pipe(Effect.map((resolved) => ({ resolved, resumedExistingSession: false })));
      const resolution = yield* (
        resumeSessionId
          ? request("GET", `/api/session/${encodedPathSegment(resumeSessionId)}`, {
              operation: "session.get",
              schema: SessionResponseSchema,
            }).pipe(
              Effect.flatMap((resolved) =>
                resolved.data.location === undefined
                  ? Effect.succeed({ resolved, resumedExistingSession: true })
                  : isSameOpenCodeDirectory(
                      fileSystem,
                      path,
                      resolved.data.location.directory,
                      directory,
                    ).pipe(
                      Effect.flatMap((sameDirectory) =>
                        sameDirectory
                          ? Effect.succeed({ resolved, resumedExistingSession: true })
                          : createSession,
                      ),
                    ),
              ),
              Effect.catchIf(isMissingOpenCodeSession, () => createSession),
            )
          : createSession
      ).pipe(Effect.mapError((cause) => toProcessError(input.threadId, cause)));
      const providerSessionId = resolution.resolved.data.id;
      const staleContexts = new Set<OpenCodeSessionContext>();
      const previousForThread = sessions.get(input.threadId);
      const previousForProvider = sessionByProviderId.get(providerSessionId);
      if (previousForThread) staleContexts.add(previousForThread);
      if (previousForProvider) staleContexts.add(previousForProvider);
      if (resolution.resumedExistingSession && modelRef) {
        yield* request("POST", `/api/session/${encodedPathSegment(providerSessionId)}/model`, {
          operation: "session.switchModel",
          schema: Schema.Void,
          body: { model: modelRef },
        }).pipe(Effect.mapError((cause) => toRequestError("session.switchModel", cause)));
      }
      if (resolution.resumedExistingSession && agent) {
        yield* request("POST", `/api/session/${encodedPathSegment(providerSessionId)}/agent`, {
          operation: "session.switchAgent",
          schema: Schema.Void,
          body: { agent },
        }).pipe(Effect.mapError((cause) => toRequestError("session.switchAgent", cause)));
      }
      for (const stale of staleContexts) {
        yield* detachContext(stale);
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
      const context: OpenCodeSessionContext = {
        session,
        providerSessionId,
        pendingPermissions: new Set(),
        pendingForms: new Map(),
        toolsByCallId: new Map(),
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
    const startSession: OpenCodeAdapterShape["startSession"] = (input) =>
      sessionStartLock.withPermit(startSessionUnlocked(input));

    const sendTurn: OpenCodeAdapterShape["sendTurn"] = Effect.fn("OpenCodeAdapter.sendTurn")(
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
        const turnId = steeringTurnId ?? (yield* nextTurnId);
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

    const interruptTurn: OpenCodeAdapterShape["interruptTurn"] = Effect.fn(
      "OpenCodeAdapter.interruptTurn",
    )(function* (threadId, turnId) {
      const context = yield* ensureSession(threadId);
      yield* interruptContext(context, turnId);
    });

    const respondToRequest: OpenCodeAdapterShape["respondToRequest"] = Effect.fn(
      "OpenCodeAdapter.respondToRequest",
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

    const respondToUserInput: OpenCodeAdapterShape["respondToUserInput"] = Effect.fn(
      "OpenCodeAdapter.respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const context = yield* ensureSession(threadId);
      const form = context.pendingForms.get(requestId);
      if (!form) {
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
          body: { answer: normalizeFormAnswers(form, answers) },
        },
      ).pipe(Effect.mapError((cause) => toRequestError("form.reply", cause)));
    });

    const detachSession = Effect.fn("OpenCodeAdapter.detachSession")(function* (
      threadId: ThreadId,
    ) {
      const context = yield* ensureSession(threadId);
      yield* detachContext(context);
    });

    const readThread: OpenCodeAdapterShape["readThread"] = Effect.fn("OpenCodeAdapter.readThread")(
      function* (threadId) {
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
        const turns: Array<OpenCodeTurnSnapshot> = [];
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
      },
    );

    const rollbackThread: OpenCodeAdapterShape["rollbackThread"] = Effect.fn(
      "OpenCodeAdapter.rollbackThread",
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

    const stopAll: OpenCodeAdapterShape["stopAll"] = () =>
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
    } satisfies OpenCodeAdapterShape;
  });
}
