import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  RuntimeTaskId,
  TurnId,
  type DevinSettings,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
  type TurnCompletedPayload,
} from "@t3tools/contracts";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { ServerConfig } from "../../config.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import { parsePermissionRequest, type AcpToolCallState } from "../acp/AcpRuntimeModel.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  devinPermissionMode,
  devinModelOptions,
  applyDevinAcpModelSelection,
  buildDevinPrompt,
  makeDevinAcpRuntime,
  resolveDevinModel,
} from "../acp/DevinAcpSupport.ts";
import {
  devinApprovalOptions,
  devinTokenUsage,
  normalizeDevinToolCall,
  selectDevinPermissionOptionId,
} from "../acp/DevinProtocol.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("devin");
const ResumeCursor = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sessionId: Schema.NonEmptyString,
});
const decodePlanInput = Schema.decodeUnknownOption(Schema.Struct({ content: Schema.String }));
const decodePlanWrite = Schema.decodeUnknownOption(
  Schema.Struct({
    update: Schema.Struct({
      _meta: Schema.Union([
        Schema.Struct({ isPlanFileEdit: Schema.Literal(true) }),
        Schema.Struct({ "cognition.ai/inferenceToolName": Schema.Literal("write_plan") }),
      ]),
    }),
  }),
);
const decodeResumeCursor = Schema.decodeUnknownOption(ResumeCursor);
const decodeSubagentUpdate = Schema.decodeUnknownOption(
  Schema.Struct({
    update: Schema.Struct({
      _meta: Schema.Struct({ "cognition.ai/inferenceToolName": Schema.Literal("run_subagent") }),
    }),
  }),
);
const decodeSubagentInput = Schema.decodeUnknownOption(
  Schema.Struct({
    title: Schema.optional(Schema.String),
    task: Schema.optional(Schema.String),
  }),
);
const isAcpError = Schema.is(EffectAcpErrors.AcpError);

type Adapter = ProviderAdapterShape<ProviderAdapterError>;
type Runtime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  | "handleRequestPermission"
  | "handleReadTextFile"
  | "handleWriteTextFile"
  | "start"
  | "setMode"
  | "setModel"
  | "getConfigOptions"
  | "getEvents"
  | "drainEvents"
  | "prompt"
  | "cancel"
>;
type NativePermission = EffectAcpSchema.RequestPermissionRequest;
type NativePermissionResponse = EffectAcpSchema.RequestPermissionResponse;

function mapDevinError(threadId: ThreadId, method: string, cause: EffectAcpErrors.AcpError) {
  return mapAcpToAdapterError(PROVIDER, threadId, method, cause);
}

export interface DevinAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly onSessionStarted?: (
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onAvailableCommands?: (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onConfigOptionsUpdated?: (
    configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  ) => Effect.Effect<void>;
  /** Model the provider default alias selects, when the account offers it. */
  readonly defaultModel?: Effect.Effect<string | undefined>;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingApproval {
  readonly request: NativePermission;
  readonly response: Deferred.Deferred<{
    readonly decision: ProviderApprovalDecision;
    readonly result: NativePermissionResponse;
  }>;
}

interface TurnIntent {
  readonly turnId: TurnId;
  readonly generation: number;
  settled: boolean;
}

interface SessionContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly nativeSessionId: string;
  readonly scope: Scope.Closeable;
  readonly runtime: Runtime;
  readonly promptLock: Semaphore.Semaphore;
  readonly stopLock: Semaphore.Semaphore;
  readonly approvals: Map<ApprovalRequestId, PendingApproval>;
  readonly subagents: Map<
    string,
    {
      readonly turnId: TurnId | undefined;
      readonly title: string;
      readonly description: string;
      status: "pending" | "running";
    }
  >;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly toolCalls: Map<string, AcpToolCallState>;
  planMarkdown: string | undefined;
  lastTokenUsage: string | undefined;
  session: ProviderSession;
  activeTurnId: TurnId | undefined;
  promptFiber: Fiber.Fiber<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError> | undefined;
  generation: number;
  stopped: boolean;
  closed: boolean;
  disconnected: boolean;
}

/** Keeps one official ACP process per thread and drains a cancelled prompt before steering. */
export const makeDevinAdapter = Effect.fn("makeDevinAdapter")(function* (
  settings: DevinSettings,
  options: DevinAdapterOptions,
) {
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;
  const ownerScope = yield* Effect.scope;
  const makeNativeLoggers = yield* makeAcpNativeLoggerFactory();
  const sessions = new Map<ThreadId, SessionContext>();
  const locks = yield* SynchronizedRef.make(new Map<ThreadId, Semaphore.Semaphore>());
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Could not create a Devin event ID.",
          cause,
        }),
    ),
  );
  const stamp = Effect.all({
    eventId: Effect.map(randomId, EventId.make),
    createdAt: nowIso,
  });
  const emit = (event: ProviderRuntimeEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

  const withThreadLock = <A, E, R>(threadId: ThreadId, task: Effect.Effect<A, E, R>) =>
    SynchronizedRef.modifyEffect(locks, (current) => {
      const existing = current.get(threadId);
      if (existing) return Effect.succeed([existing, current] as const);
      return Semaphore.make(1).pipe(
        Effect.map((lock) => [lock, new Map(current).set(threadId, lock)] as const),
      );
    }).pipe(Effect.flatMap((lock) => lock.withPermit(task)));

  const requireSession = (threadId: ThreadId) => {
    const context = sessions.get(threadId);
    return context && !context.stopped
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const cancelRequests = Effect.fn("DevinAdapter.cancelRequests")(function* (
    context: SessionContext,
  ) {
    for (const pending of context.approvals.values()) {
      yield* Deferred.succeed(pending.response, {
        decision: "cancel",
        result: { outcome: { outcome: "cancelled" } },
      });
    }
  });

  const stopContext = (context: SessionContext) =>
    context.stopLock
      .withPermit(
        Effect.gen(function* () {
          if (context.closed) return;
          context.stopped = true;
          yield* Effect.gen(function* () {
            yield* cancelRequests(context);
            if (context.promptFiber && !context.disconnected) {
              yield* Effect.ignore(context.runtime.cancel);
            }
          }).pipe(Effect.ensuring(Scope.close(context.scope, Exit.void)));
          context.closed = true;
          for (const [toolUseId, task] of context.subagents) {
            yield* emit({
              type: "task.completed",
              ...(yield* stamp),
              provider: PROVIDER,
              threadId: context.threadId,
              turnId: task.turnId,
              payload: {
                taskId: RuntimeTaskId.make(toolUseId),
                taskType: "subagent",
                toolUseId,
                title: task.title,
                status: context.disconnected ? "failed" : "stopped",
                summary: "Devin session stopped before the subagent returned.",
              },
            });
          }
          context.subagents.clear();
          if (sessions.get(context.threadId) === context) sessions.delete(context.threadId);
          yield* emit({
            type: "session.exited",
            ...(yield* stamp),
            provider: PROVIDER,
            threadId: context.threadId,
            payload: {
              exitKind: context.disconnected ? "error" : "graceful",
              ...(context.disconnected ? { reason: "Devin process stopped." } : {}),
            },
          });
        }),
      )
      .pipe(Effect.uninterruptible);

  const handlePermission = Effect.fn("DevinAdapter.handlePermission")(function* (
    context: SessionContext,
    request: NativePermission,
  ): Effect.fn.Return<NativePermissionResponse, ProviderAdapterError> {
    if (context.stopped || request.sessionId !== context.nativeSessionId) {
      return { outcome: { outcome: "cancelled" } };
    }
    if (
      request.options.some(
        (option) => option.optionId === "plan_accept_edits" || option.optionId === "plan_bypass",
      ) &&
      context.planMarkdown
    ) {
      yield* emit({
        type: "turn.proposed.completed",
        ...(yield* stamp),
        provider: PROVIDER,
        threadId: context.threadId,
        turnId: context.activeTurnId,
        payload: { planMarkdown: context.planMarkdown },
      });
      return { outcome: { outcome: "cancelled" } };
    }
    const requestId = ApprovalRequestId.make(yield* randomId);
    const runtimeRequestId = RuntimeRequestId.make(requestId);
    const turnId = context.activeTurnId;
    const rawPayload = request;

    const response = yield* Deferred.make<{
      decision: ProviderApprovalDecision;
      result: NativePermissionResponse;
    }>();
    context.approvals.set(requestId, { request, response });
    const parsed = parsePermissionRequest(request);
    const toolCall =
      context.toolCalls.get(request.toolCall.toolCallId) ??
      (parsed.toolCall ? normalizeDevinToolCall(parsed.toolCall) : undefined);
    const permissionRequest = {
      ...parsed,
      ...(toolCall ? { toolCall, kind: toolCall.kind ?? parsed.kind } : {}),
      detail:
        toolCall?.command ?? toolCall?.detail ?? toolCall?.title ?? "Devin requests permission.",
    };
    return yield* Effect.gen(function* () {
      yield* emit(
        makeAcpRequestOpenedEvent({
          stamp: yield* stamp,
          provider: PROVIDER,
          threadId: context.threadId,
          turnId,
          requestId: runtimeRequestId,
          permissionRequest,
          approvalOptions: devinApprovalOptions(request),
          detail: permissionRequest.detail ?? "Devin requests permission.",
          args: rawPayload,
          source: "acp.jsonrpc",
          method: "session/request_permission",
          rawPayload,
        }),
      );
      const answer = yield* Deferred.await(response);
      yield* emit(
        makeAcpRequestResolvedEvent({
          stamp: yield* stamp,
          provider: PROVIDER,
          threadId: context.threadId,
          turnId,
          requestId: runtimeRequestId,
          permissionRequest,
          decision: answer.decision,
        }),
      );
      return answer.result;
    }).pipe(Effect.ensuring(Effect.sync(() => context.approvals.delete(requestId))));
  });

  const handleEvent = Effect.fn("DevinAdapter.handleEvent")(function* (
    context: SessionContext,
    event: AcpSessionRuntime.AcpSessionRuntimeEvent,
  ) {
    if (event._tag === "EventStreamBarrier") {
      yield* Deferred.succeed(event.acknowledge, undefined);
      return;
    }
    if (context.stopped) return;
    switch (event._tag) {
      case "ModeChanged":
        return;
      case "AvailableCommandsUpdated":
        yield* options.onAvailableCommands?.(event.availableCommands, context.cwd) ?? Effect.void;
        return;
      case "ConfigOptionsUpdated":
        yield* options.onConfigOptionsUpdated?.(event.configOptions) ?? Effect.void;
        return;
      case "UsageUpdated": {
        const usage = devinTokenUsage(event.usage);
        if (!usage) return;
        const serialized = Object.values(usage).join(":");
        if (context.lastTokenUsage === serialized) return;
        context.lastTokenUsage = serialized;
        yield* emit({
          type: "thread.token-usage.updated",
          ...(yield* stamp),
          provider: PROVIDER,
          threadId: context.threadId,
          turnId: context.activeTurnId,
          payload: { usage },
        });
        return;
      }
      case "ConnectionTerminated":
        context.stopped = true;
        context.disconnected = true;
        yield* stopContext(context).pipe(Effect.forkIn(ownerScope));
        return;
      case "AssistantItemStarted":
      case "AssistantItemCompleted":
        yield* emit(
          makeAcpAssistantItemEvent({
            stamp: yield* stamp,
            provider: PROVIDER,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            itemId: event.itemId,
            lifecycle: event._tag === "AssistantItemStarted" ? "item.started" : "item.completed",
          }),
        );
        return;
      case "ThoughtDelta":
      case "ContentDelta":
        yield* emit(
          makeAcpContentDeltaEvent({
            stamp: yield* stamp,
            provider: PROVIDER,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            ...(event._tag === "ContentDelta" && event.itemId ? { itemId: event.itemId } : {}),
            ...(event._tag === "ThoughtDelta" ? { streamKind: "reasoning_text" } : {}),
            text: event.text,
            rawPayload: event.rawPayload,
          }),
        );
        return;
      case "PlanUpdated":
        yield* emit(
          makeAcpPlanUpdatedEvent({
            stamp: yield* stamp,
            provider: PROVIDER,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            payload: event.payload,
            source: "acp.jsonrpc",
            method: "session/update",
            rawPayload: event.rawPayload,
          }),
        );
        return;
      case "ToolCallUpdated": {
        const toolCall = normalizeDevinToolCall(event.toolCall);
        context.toolCalls.set(toolCall.toolCallId, toolCall);
        if (Option.isSome(decodePlanWrite(event.rawPayload))) {
          const plan = decodePlanInput(toolCall.data.rawInput);
          if (Option.isSome(plan)) context.planMarkdown = plan.value.content;
        }
        const previous = context.subagents.get(toolCall.toolCallId);
        if (previous || Option.isSome(decodeSubagentUpdate(event.rawPayload))) {
          const input = Option.getOrUndefined(decodeSubagentInput(toolCall.data.rawInput));
          const task = previous ?? {
            turnId: context.activeTurnId,
            title: input?.title?.slice(0, 512) || "Devin subagent",
            description: input?.task?.slice(0, 8000) || "",
            status: "pending" as const,
          };
          const linkage = {
            taskId: RuntimeTaskId.make(toolCall.toolCallId),
            taskType: "subagent",
            toolUseId: toolCall.toolCallId,
            title: task.title,
          };
          if (toolCall.status === "completed" || toolCall.status === "failed") {
            yield* emit({
              type: "task.completed",
              ...(yield* stamp),
              provider: PROVIDER,
              threadId: context.threadId,
              turnId: task.turnId,
              payload: { ...linkage, status: toolCall.status },
            });
            context.subagents.delete(toolCall.toolCallId);
          } else {
            const status = toolCall.status === "pending" ? "pending" : "running";
            if (!previous || previous.status !== status) {
              yield* emit({
                type: "task.progress",
                ...(yield* stamp),
                provider: PROVIDER,
                threadId: context.threadId,
                turnId: task.turnId,
                payload: { ...linkage, status, description: task.description },
              });
            }
            context.subagents.set(toolCall.toolCallId, { ...task, status });
          }
          return;
        }
        yield* emit(
          makeAcpToolCallEvent({
            stamp: yield* stamp,
            provider: PROVIDER,
            threadId: context.threadId,
            turnId: context.activeTurnId,
            toolCall,
            rawPayload: event.rawPayload,
          }),
        );
        return;
      }
    }
  });

  const startSession: Adapter["startSession"] = (input) =>
    withThreadLock(
      input.threadId,
      Effect.gen(function* () {
        if (input.runtimeMode === "approval-required") {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue:
              "Devin ACP does not support supervised file edits. Choose Auto-accept edits, Auto, or Full access.",
          });
        }
        if (!settings.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "Enable Devin in provider settings before starting a thread.",
          });
        }
        if (
          (input.provider !== undefined && input.provider !== PROVIDER) ||
          (input.providerInstanceId !== undefined &&
            input.providerInstanceId !== options.instanceId) ||
          (input.modelSelection !== undefined &&
            input.modelSelection.instanceId !== options.instanceId)
        ) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "The Devin provider instance does not match the requested session.",
          });
        }
        if (!input.cwd?.trim()) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "The session requires a workspace directory.",
          });
        }
        const cursor = decodeResumeCursor(input.resumeCursor);
        if (input.resumeCursor !== undefined && Option.isNone(cursor)) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "The saved Devin session is invalid. Start a new thread.",
          });
        }
        const previous = sessions.get(input.threadId);
        if (previous) yield* stopContext(previous);
        const cwd = path.resolve(input.cwd);
        const sessionScope = yield* Scope.make("sequential");
        let transferred = false;
        let context: SessionContext | undefined;
        yield* Effect.addFinalizer(() => {
          if (transferred) return Effect.void;
          sessions.delete(input.threadId);
          return Scope.close(sessionScope, Exit.void);
        });
        return yield* Effect.gen(function* () {
          const mcp = McpProviderSession.readMcpProviderSession(input.threadId);
          // The attachments dir grant lets the agent read pasted files at
          // the paths ProviderService injects into the turn text. It is a
          // leaf directory holding only uploads.
          const runtime = yield* makeDevinAcpRuntime({
            devinSettings: settings,
            childProcessSpawner: spawner,
            environment: McpProviderSession.withAgentDeviceEnvironment(
              options.environment ?? {},
              mcp,
            ),
            cwd,
            clientInfo: { name: "t3-code", version: "0.0.0" },
            additionalDirectories: [serverConfig.attachmentsDir],
            ...(Option.isSome(cursor) ? { resumeSessionId: cursor.value.sessionId } : {}),
            mcpServers: mcp
              ? [
                  {
                    type: "http",
                    name: "t3-code",
                    url: mcp.endpoint,
                    headers: [{ name: "Authorization", value: mcp.authorizationHeader }],
                  },
                ]
              : [],
            ...makeNativeLoggers({
              nativeEventLogger: options.nativeEventLogger,
              provider: PROVIDER,
              threadId: input.threadId,
            }),
          });
          yield* runtime.handleRequestPermission((request) =>
            context
              ? handlePermission(context, request).pipe(
                  Effect.mapError((cause) =>
                    EffectAcpErrors.AcpRequestError.internalError(
                      "Could not process a Devin permission request.",
                      undefined,
                      { cause },
                    ),
                  ),
                )
              : Effect.succeed({
                  outcome: { outcome: "cancelled" },
                } satisfies NativePermissionResponse),
          );
          const started = yield* runtime.start();
          const model = yield* applyDevinAcpModelSelection({
            runtime,
            model: input.modelSelection?.model,
            defaultModel: yield* options.defaultModel ?? Effect.succeed(undefined),
            mapError: (cause) => cause,
          });
          yield* runtime.setMode(devinPermissionMode(input.runtimeMode));
          yield* options.onSessionStarted?.(started, cwd) ?? Effect.void;
          const createdAt = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: options.instanceId,
            threadId: input.threadId,
            cwd,
            status: "ready",
            runtimeMode: input.runtimeMode,
            ...(model ? { model } : {}),
            resumeCursor: { schemaVersion: 1, sessionId: started.sessionId },
            createdAt,
            updatedAt: createdAt,
          };
          context = {
            threadId: input.threadId,
            cwd,
            nativeSessionId: started.sessionId,
            scope: sessionScope,
            runtime,
            promptLock: yield* Semaphore.make(1),
            stopLock: yield* Semaphore.make(1),
            approvals: new Map(),
            subagents: new Map(),
            turns: [],
            toolCalls: new Map(),
            planMarkdown: undefined,
            lastTokenUsage: undefined,
            session,
            activeTurnId: undefined,
            promptFiber: undefined,
            generation: 0,
            stopped: false,
            closed: false,
            disconnected: false,
          };
          const running = context;
          sessions.set(input.threadId, running);
          yield* Stream.runForEach(runtime.getEvents(), (event) =>
            handleEvent(running, event),
          ).pipe(
            Effect.catchCause(() => Effect.logError("Could not process a Devin runtime event.")),
            Effect.forkIn(sessionScope),
          );
          yield* emit({
            type: "session.started",
            ...(yield* stamp),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* emit({
            type: "session.state.changed",
            ...(yield* stamp),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Devin ACP session ready" },
          });
          yield* emit({
            type: "thread.started",
            ...(yield* stamp),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });
          yield* runtime.drainEvents;
          if (running.stopped) {
            return yield* new ProviderAdapterSessionClosedError({
              provider: PROVIDER,
              threadId: input.threadId,
            });
          }
          transferred = true;
          return session;
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.mapError((cause) =>
            isAcpError(cause)
              ? mapDevinError(input.threadId, "session/start", cause)
              : new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/start",
                  detail: "Could not start Devin. Check the provider setup status.",
                  cause,
                }),
          ),
        );
      }).pipe(Effect.scoped),
    );

  const sendTurn: Adapter["sendTurn"] = Effect.fn("DevinAdapter.sendTurn")(function* (input) {
    const context = yield* requireSession(input.threadId);
    if (input.modelSelection && input.modelSelection.instanceId !== options.instanceId) {
      return yield* new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "sendTurn",
        issue: "The selected model belongs to another provider instance.",
      });
    }
    const prompt = yield* buildDevinPrompt({
      input: input.input,
      attachments: input.attachments,
      attachmentsDir: serverConfig.attachmentsDir,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => mapDevinError(input.threadId, "session/prompt", cause)),
    );
    let intent: TurnIntent | undefined;
    // The caller holds promptLock while it changes or settles the active turn.
    const finishTurn = (turn: TurnIntent, payload: TurnCompletedPayload) =>
      Effect.gen(function* () {
        if (turn.settled || context.stopped || context.generation !== turn.generation) return;
        turn.settled = true;
        context.activeTurnId = undefined;
        context.promptFiber = undefined;
        context.session = {
          ...context.session,
          status: payload.state === "failed" ? "error" : "ready",
          activeTurnId: undefined,
          updatedAt: yield* nowIso,
          ...(payload.errorMessage
            ? { lastError: payload.errorMessage }
            : { lastError: undefined }),
        };
        yield* emit({
          type: "turn.completed",
          ...(yield* stamp),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId: turn.turnId,
          payload,
        });
      }).pipe(Effect.uninterruptible);

    return yield* Effect.gen(function* () {
      const launch = yield* context.promptLock.withPermit(
        Effect.gen(function* () {
          yield* requireSession(input.threadId);
          const requestedModel = input.modelSelection?.model ?? context.session.model;
          const configOptions = yield* context.runtime.getConfigOptions;
          const model = resolveDevinModel({
            configOptions,
            model: requestedModel,
            defaultModel: yield* options.defaultModel ?? Effect.succeed(undefined),
          });
          const availableModels = devinModelOptions(configOptions);
          if (model && !availableModels.some((option) => option.value === model)) {
            return yield* EffectAcpErrors.AcpRequestError.invalidParams(
              `Devin model '${model}' is unavailable for this account. Select an available model.`,
            );
          }
          const turnId = context.activeTurnId ?? TurnId.make(yield* randomId);
          const steering = context.activeTurnId !== undefined;
          if (!steering) {
            context.toolCalls.clear();
            context.planMarkdown = undefined;
          }
          const turn: TurnIntent = { turnId, generation: ++context.generation, settled: false };
          intent = turn;
          context.activeTurnId = turnId;
          if (!steering) {
            yield* emit({
              type: "turn.started",
              ...(yield* stamp),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: model ? { model } : {},
            });
          }
          if (context.promptFiber) {
            yield* cancelRequests(context);
            yield* context.runtime.cancel;
            yield* Fiber.await(context.promptFiber);
          }
          yield* applyDevinAcpModelSelection({
            runtime: context.runtime,
            model,
            mapError: (cause) => cause,
          });
          yield* context.runtime.setMode(
            input.interactionMode === "plan"
              ? "plan"
              : devinPermissionMode(context.session.runtimeMode),
          );
          context.session = {
            ...context.session,
            status: "running",
            activeTurnId: turnId,
            ...(model ? { model } : {}),
            updatedAt: yield* nowIso,
          };
          const dispatched = yield* Deferred.make<void>();
          const fiber = yield* context.runtime
            .prompt(
              {
                prompt: [
                  ...prompt,
                  {
                    type: "text",
                    text: buildRuntimeInstructions({ harness: "Devin", model }),
                  },
                ],
              },
              { dispatched },
            )
            .pipe(Effect.forkIn(context.scope));
          context.promptFiber = fiber;
          // Fiber.join can skip a scope-close waiter when the child is interrupted.
          // Unwrap the Exit after Fiber.await returns.
          yield* Effect.raceFirst(
            Deferred.await(dispatched),
            Fiber.await(fiber).pipe(
              Effect.flatMap((exit) => exit),
              Effect.asVoid,
            ),
          );
          return { turn, fiber };
        }),
      );
      const result = yield* Fiber.await(launch.fiber).pipe(Effect.flatMap((exit) => exit));
      yield* context.runtime.drainEvents;
      if (context.stopped) {
        return yield* new ProviderAdapterSessionClosedError({
          provider: PROVIDER,
          threadId: input.threadId,
        });
      }
      const record = context.turns.find((turn) => turn.id === launch.turn.turnId);
      if (record) record.items.push(result);
      else context.turns.push({ id: launch.turn.turnId, items: [result] });
      yield* context.promptLock.withPermit(
        finishTurn(launch.turn, {
          state: result.stopReason === "cancelled" ? "cancelled" : "completed",
          stopReason: result.stopReason,
        }),
      );
      return {
        threadId: input.threadId,
        turnId: launch.turn.turnId,
        resumeCursor: context.session.resumeCursor,
      };
    }).pipe(
      Effect.mapError((cause) =>
        isAcpError(cause) ? mapDevinError(input.threadId, "session/prompt", cause) : cause,
      ),
      Effect.tapError((cause) =>
        Effect.suspend(() =>
          intent
            ? context.promptLock.withPermit(
                finishTurn(intent, { state: "failed", errorMessage: cause.message }),
              )
            : Effect.void,
        ),
      ),
      Effect.onInterrupt(() =>
        context.promptLock.withPermit(
          Effect.gen(function* () {
            const turn = intent;
            if (!turn || turn.settled || context.stopped || context.generation !== turn.generation)
              return;
            const promptFiber = context.promptFiber;
            yield* cancelRequests(context);
            yield* Effect.ignore(context.runtime.cancel);
            if (promptFiber) yield* Fiber.interrupt(promptFiber);
            yield* finishTurn(turn, { state: "cancelled", stopReason: "cancelled" });
          }),
        ),
      ),
    );
  });

  const interruptTurn: Adapter["interruptTurn"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      yield* context.promptLock
        .withPermit(
          Effect.gen(function* () {
            yield* cancelRequests(context);
            yield* context.runtime.cancel;
          }),
        )
        .pipe(Effect.mapError((cause) => mapDevinError(threadId, "session/cancel", cause)));
    });

  const respondToRequest: Adapter["respondToRequest"] = (threadId, requestId, decision) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.approvals.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "session/request_permission",
          detail: "This approval request is no longer pending.",
        });
      }
      const optionId =
        decision === "cancel"
          ? undefined
          : selectDevinPermissionOptionId(pending.request, decision);
      if (decision !== "cancel" && optionId === undefined) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "respondToRequest",
          issue: "Devin did not offer this permission choice. Select one of the available choices.",
        });
      }
      yield* Deferred.succeed(pending.response, {
        decision,
        result: {
          outcome:
            optionId === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId },
        },
      });
    });

  const respondToUserInput: Adapter["respondToUserInput"] = () =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation: "respondToUserInput",
        issue: "Devin has no pending structured question. Reply in the conversation.",
      }),
    );

  const stopSession: Adapter["stopSession"] = (threadId) =>
    withThreadLock(threadId, Effect.flatMap(requireSession(threadId), stopContext));
  const stopAll: Adapter["stopAll"] = () =>
    Effect.forEach([...sessions.values()], stopContext, { discard: true });
  yield* Effect.addFinalizer(() =>
    stopAll().pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.void
          : Effect.logError("Could not stop a Devin session."),
      ),
      Effect.ensuring(PubSub.shutdown(events)),
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    compaction: { type: "slash-command", command: "/compact" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    stopAll,
    listSessions: () =>
      Effect.sync(() =>
        [...sessions.values()]
          .filter((context) => !context.stopped)
          .map((context) => ({ ...context.session })),
      ),
    hasSession: (threadId) =>
      Effect.sync(() => sessions.has(threadId) && !sessions.get(threadId)?.stopped),
    readThread: (threadId) =>
      Effect.map(requireSession(threadId), (context) => ({ threadId, turns: context.turns })),
    rollbackThread: (_threadId: ThreadId, _numTurns: number) =>
      Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "Devin does not support conversation rewind. Start a new thread instead.",
        }),
      ),
    streamEvents: Stream.fromPubSub(events),
  } satisfies Adapter;
});
