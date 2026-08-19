import {
  ApprovalRequestId,
  EventId,
  type OpenCodeSettings,
  type ProviderApprovalDecision,
  type ProviderOptionSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
  type UserInputQuestion,
} from "@t3tools/contracts";
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
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import { makeAcpNativeLoggerFactory } from "../acp/AcpNativeLogging.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import { parsePermissionRequest } from "../acp/AcpRuntimeModel.ts";
import {
  applyOpenCode2AcpModelSelection,
  makeOpenCode2AcpRuntime,
  promptOpenCode2Acp,
} from "../acp/OpenCode2AcpSupport.ts";
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("opencode");
const RESUME_VERSION = 1 as const;

export interface OpenCode2AdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface PendingUserInput {
  readonly resolution: Deferred.Deferred<
    | { readonly action: "accept"; readonly answers: ProviderUserInputAnswers }
    | { readonly action: "cancel" }
  >;
}

interface OpenCode2SessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntime.AcpSessionRuntime["Service"];
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly turnSemaphore: Semaphore.Semaphore;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  interruptedTurnId: TurnId | undefined;
  promptsInFlight: number;
  stopped: boolean;
}

function parseResume(raw: unknown): { readonly sessionId: string } | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== RESUME_VERSION) return undefined;
  if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return undefined;
  return { sessionId: value.sessionId.trim() };
}

function permissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: Exclude<ProviderApprovalDecision, "cancel">,
): string | undefined {
  const kind =
    decision === "acceptForSession"
      ? "allow_always"
      : decision === "accept"
        ? "allow_once"
        : "reject_once";
  return request.options.find((option) => option.kind === kind)?.optionId.trim() || undefined;
}

function autoApproveOptionId(request: EffectAcpSchema.RequestPermissionRequest) {
  return permissionOptionId(request, "acceptForSession") ?? permissionOptionId(request, "accept");
}

function elicitationQuestions(
  request: EffectAcpSchema.ElicitationRequest,
): Array<UserInputQuestion> {
  if (request.mode !== "form") return [];
  const properties = request.requestedSchema.properties ?? {};
  const required = new Set(request.requestedSchema.required ?? []);
  const entries = Object.entries(properties).filter(([id]) => required.has(id));
  if (entries.length === 0) {
    return [
      {
        id: "response",
        header: request.requestedSchema.title?.trim() || "OpenCode",
        question: request.message,
        options: [{ label: "Continue", description: "Continue" }],
      },
    ];
  }
  return entries.map(([id, property]) => {
    const record = property as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim() ? record.title.trim() : id;
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : request.message;
    const optionSchema =
      record.type === "array" && typeof record.items === "object" && record.items !== null
        ? (record.items as Record<string, unknown>)
        : record;
    const choices: ReadonlyArray<unknown> = Array.isArray(optionSchema.oneOf)
      ? optionSchema.oneOf
      : Array.isArray(optionSchema.anyOf)
        ? optionSchema.anyOf
        : [];
    const rawOptions: ReadonlyArray<unknown> = Array.isArray(optionSchema.enum)
      ? optionSchema.enum
      : choices.length > 0
        ? choices.map((entry) =>
            typeof entry === "object" && entry !== null && "const" in entry
              ? (entry as { readonly const?: unknown }).const
              : undefined,
          )
        : optionSchema.type === "boolean"
          ? [true, false]
          : [];
    const options = rawOptions.flatMap((entry) =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
        ? [{ label: String(entry), description: String(entry) }]
        : [],
    );
    return {
      id,
      header: title,
      question: description,
      options: options.length > 0 ? options : [],
      ...(record.type === "array" ? { multiSelect: true } : {}),
    } satisfies UserInputQuestion;
  });
}

function firstAnswerValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function elicitationContent(
  request: EffectAcpSchema.ElicitationRequest,
  answers: ProviderUserInputAnswers,
): Record<string, EffectAcpSchema.ElicitationContentValue> | undefined {
  if (request.mode !== "form") return {};
  const required = new Set(request.requestedSchema.required ?? []);
  const content: Record<string, EffectAcpSchema.ElicitationContentValue> = {};
  if (required.size === 0) {
    const response = firstAnswerValue(answers.response);
    if (
      typeof response === "string" ||
      typeof response === "number" ||
      typeof response === "boolean"
    ) {
      content.response = String(response);
    }
  }
  for (const [id, property] of Object.entries(request.requestedSchema.properties ?? {})) {
    const answer = answers[id];
    if (answer === undefined || answer === null) continue;
    const record = property as Record<string, unknown>;
    if (record.type === "array") {
      const values = Array.isArray(answer) ? answer : [answer];
      content[id] = values.flatMap((value) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? [String(value)]
          : [],
      );
      continue;
    }
    const value = firstAnswerValue(answer);
    if (record.type === "boolean") {
      content[id] = typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
    } else if (record.type === "number" || record.type === "integer") {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        if (required.has(id)) return undefined;
        continue;
      }
      content[id] = number;
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      content[id] = String(value);
    }
  }
  return content;
}

function settlePending(ctx: OpenCode2SessionContext): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.forEach(
      ctx.pendingApprovals.values(),
      (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
      { discard: true },
    );
    yield* Effect.forEach(
      ctx.pendingUserInputs.values(),
      (pending) => Deferred.succeed(pending.resolution, { action: "cancel" }).pipe(Effect.ignore),
      { discard: true },
    );
  });
}

export function makeOpenCode2Adapter(
  settings: OpenCodeSettings,
  options?: OpenCode2AdapterOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("opencode");
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, { stream: "native" })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
    const makeAcpNativeLoggers = yield* makeAcpNativeLoggerFactory();
    const sessions = new Map<ThreadId, OpenCode2SessionContext>();
    const locks = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUID = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate OpenCode runtime identifier.",
            cause,
          }),
      ),
    );
    const nextEventId = randomUUID.pipe(Effect.map(EventId.make));
    const stamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
    const emit = (event: ProviderRuntimeEvent) => PubSub.publish(events, event).pipe(Effect.asVoid);

    const getLock = (threadId: string) =>
      SynchronizedRef.modifyEffect(locks, (current) =>
        Option.match(Option.fromNullishOr(current.get(threadId)), {
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
        }),
      );
    const withLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getLock(threadId), (semaphore) => semaphore.withPermit(effect));
    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return ctx && !ctx.stopped
        ? Effect.succeed(ctx)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };

    const stopInternal = (ctx: OpenCode2SessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePending(ctx);
        yield* ctx.acp.cancelAndWait.pipe(Effect.ignore);
        if (ctx.notificationFiber) yield* Fiber.interrupt(ctx.notificationFiber);
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
        sessions.delete(ctx.threadId);
        yield* emit({
          type: "session.exited",
          ...(yield* stamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      }).pipe(Effect.uninterruptible);

    const configureSession = (input: {
      readonly ctx: OpenCode2SessionContext;
      readonly model: string | undefined;
      readonly options: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      readonly interactionMode: "plan" | "default" | undefined;
    }) =>
      applyOpenCode2AcpModelSelection({
        runtime: input.ctx.acp,
        model: input.model,
        selections: input.options,
        interactionMode: input.interactionMode,
        mapError: ({ cause, configId }) =>
          mapAcpToAdapterError(
            PROVIDER,
            input.ctx.threadId,
            `session/set_config_option:${configId}`,
            cause,
          ),
      });

    const startSession: OpenCodeAdapterShape["startSession"] = (input) =>
      withLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (input.modelSelection && input.modelSelection.instanceId !== boundInstanceId) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Model selection belongs to provider instance '${input.modelSelection.instanceId}', not '${boundInstanceId}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }
          const cwd = path.resolve(input.cwd.trim());
          const modelSelection = input.modelSelection;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) yield* stopInternal(existing);

          const sessionScope = yield* Scope.make("sequential");
          let transferred = false;
          yield* Effect.addFinalizer(() =>
            transferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );
          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          const resumeSessionId = parseResume(input.resumeCursor)?.sessionId;
          const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
          const acpNativeLoggers = makeAcpNativeLoggers({
            nativeEventLogger,
            provider: PROVIDER,
            threadId: input.threadId,
          });
          const acp = yield* makeOpenCode2AcpRuntime({
            settings,
            childProcessSpawner,
            cwd,
            ...(options?.environment ? { environment: options.environment } : {}),
            ...(resumeSessionId ? { resumeSessionId } : {}),
            clientInfo: { name: "t3-code", version: "0.0.0" },
            ...(mcpSession
              ? {
                  mcpServers: [
                    {
                      type: "http" as const,
                      name: "t3-code",
                      url: mcpSession.endpoint,
                      headers: [{ name: "Authorization", value: mcpSession.authorizationHeader }],
                    },
                  ],
                }
              : {}),
            ...acpNativeLoggers,
          }).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: "Failed to start the OpenCode 2.0 ACP session.",
                  cause,
                }),
            ),
          );

          const now = yield* nowIso;
          const turnSemaphore = yield* Semaphore.make(1);
          const ctx: OpenCode2SessionContext = {
            threadId: input.threadId,
            session: {
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              status: "connecting",
              runtimeMode: input.runtimeMode,
              cwd,
              model: modelSelection?.model,
              threadId: input.threadId,
              ...(resumeSessionId ? { resumeCursor: input.resumeCursor } : {}),
              createdAt: now,
              updatedAt: now,
            },
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            turnSemaphore,
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            interruptedTurnId: undefined,
            promptsInFlight: 0,
            stopped: false,
          };
          sessions.set(input.threadId, ctx);
          yield* Effect.addFinalizer(() =>
            !transferred && sessions.get(input.threadId) === ctx
              ? Effect.sync(() => sessions.delete(input.threadId))
              : Effect.void,
          );

          const started = yield* Effect.gen(function* () {
            yield* acp.handleRequestPermission((request) =>
              Effect.gen(function* () {
                if (input.runtimeMode === "full-access") {
                  const optionId = autoApproveOptionId(request);
                  if (optionId) {
                    return { outcome: { outcome: "selected" as const, optionId } };
                  }
                }
                const permissionRequest = parsePermissionRequest(request);
                const requestId = ApprovalRequestId.make(yield* randomUUID);
                const runtimeRequestId = RuntimeRequestId.make(requestId);
                const decision = yield* Deferred.make<ProviderApprovalDecision>();
                pendingApprovals.set(requestId, { decision });
                yield* emit(
                  makeAcpRequestOpenedEvent({
                    stamp: yield* stamp(),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctx.activeTurnId,
                    requestId: runtimeRequestId,
                    permissionRequest,
                    detail: permissionRequest.detail ?? "OpenCode requested permission.",
                    args: request,
                    source: "acp.jsonrpc",
                    method: "session/request_permission",
                    rawPayload: request,
                  }),
                );
                const resolved = yield* Deferred.await(decision);
                pendingApprovals.delete(requestId);
                yield* emit(
                  makeAcpRequestResolvedEvent({
                    stamp: yield* stamp(),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId: ctx.activeTurnId,
                    requestId: runtimeRequestId,
                    permissionRequest,
                    decision: resolved,
                  }),
                );
                if (resolved === "cancel") return { outcome: { outcome: "cancelled" as const } };
                const optionId = permissionOptionId(request, resolved);
                return optionId
                  ? { outcome: { outcome: "selected" as const, optionId } }
                  : { outcome: { outcome: "cancelled" as const } };
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new EffectAcpErrors.AcpTransportError({
                      detail: "Failed to process OpenCode permission request.",
                      cause,
                    }),
                ),
              ),
            );
            yield* acp.handleElicitation((request) =>
              Effect.gen(function* () {
                if (request.mode === "url") {
                  return { action: { action: "cancel" as const } };
                }
                const requestId = ApprovalRequestId.make(yield* randomUUID);
                const runtimeRequestId = RuntimeRequestId.make(requestId);
                const resolution = yield* Deferred.make<
                  | { readonly action: "accept"; readonly answers: ProviderUserInputAnswers }
                  | { readonly action: "cancel" }
                >();
                pendingUserInputs.set(requestId, { resolution });
                yield* emit({
                  type: "user-input.requested",
                  ...(yield* stamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctx.activeTurnId,
                  requestId: runtimeRequestId,
                  payload: { questions: elicitationQuestions(request) },
                  raw: { source: "acp.jsonrpc", method: "session/elicitation", payload: request },
                });
                const resolved = yield* Deferred.await(resolution);
                pendingUserInputs.delete(requestId);
                yield* emit({
                  type: "user-input.resolved",
                  ...(yield* stamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId: ctx.activeTurnId,
                  requestId: runtimeRequestId,
                  payload: {
                    answers: resolved.action === "accept" ? resolved.answers : {},
                  },
                });
                if (resolved.action === "cancel") {
                  return { action: { action: "cancel" as const } };
                }
                const content = elicitationContent(request, resolved.answers);
                if (content === undefined) {
                  return { action: { action: "cancel" as const } };
                }
                return {
                  action: {
                    action: "accept" as const,
                    content,
                  },
                };
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new EffectAcpErrors.AcpTransportError({
                      detail: "Failed to process OpenCode elicitation.",
                      cause,
                    }),
                ),
              ),
            );
            return yield* acp.start();
          }).pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", cause),
            ),
          );

          ctx.session = {
            ...ctx.session,
            status: "ready",
            resumeCursor: { schemaVersion: RESUME_VERSION, sessionId: started.sessionId },
            updatedAt: yield* nowIso,
          };
          yield* configureSession({
            ctx,
            model: modelSelection?.model,
            options: modelSelection?.options,
            interactionMode: undefined,
          });

          const notificationFiber = yield* Stream.runForEach(acp.getEvents(), (event) =>
            Effect.gen(function* () {
              switch (event._tag) {
                case "EventStreamBarrier":
                  yield* Deferred.succeed(event.acknowledge, undefined);
                  return;
                case "ModeChanged":
                  return;
                case "AssistantItemStarted":
                  yield* emit(
                    makeAcpAssistantItemEvent({
                      stamp: yield* stamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      itemId: event.itemId,
                      lifecycle: "item.started",
                    }),
                  );
                  return;
                case "AssistantItemCompleted":
                  yield* emit(
                    makeAcpAssistantItemEvent({
                      stamp: yield* stamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      itemId: event.itemId,
                      lifecycle: "item.completed",
                    }),
                  );
                  return;
                case "ContentDelta":
                  yield* emit(
                    makeAcpContentDeltaEvent({
                      stamp: yield* stamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      ...(event.itemId ? { itemId: event.itemId } : {}),
                      text: event.text,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "ToolCallUpdated":
                  yield* emit(
                    makeAcpToolCallEvent({
                      stamp: yield* stamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      toolCall: event.toolCall,
                      rawPayload: event.rawPayload,
                    }),
                  );
                  return;
                case "PlanUpdated": {
                  const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${event.payload.explanation ?? ""}:${event.payload.plan.map((step) => `${step.status}:${step.step}`).join("|")}`;
                  if (ctx.lastPlanFingerprint === fingerprint) return;
                  ctx.lastPlanFingerprint = fingerprint;
                  yield* emit(
                    makeAcpPlanUpdatedEvent({
                      stamp: yield* stamp(),
                      provider: PROVIDER,
                      threadId: ctx.threadId,
                      turnId: ctx.activeTurnId,
                      payload: event.payload,
                      source: "acp.jsonrpc",
                      method: "session/update",
                      rawPayload: event.rawPayload,
                    }),
                  );
                }
              }
            }),
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError("Failed to process OpenCode2 ACP notification.", { cause }),
            ),
            Effect.forkIn(sessionScope),
          );
          ctx.notificationFiber = notificationFiber;
          transferred = true;
          yield* emit({
            type: "session.started",
            ...(yield* stamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* emit({
            type: "session.state.changed",
            ...(yield* stamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "OpenCode2 ACP session ready" },
          });
          yield* emit({
            type: "thread.started",
            ...(yield* stamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });
          return ctx.session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: OpenCodeAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const { ctx, steeringTurnId, turnId } = yield* withLock(
          input.threadId,
          Effect.gen(function* () {
            const ctx = yield* requireSession(input.threadId);
            if (input.modelSelection && input.modelSelection.instanceId !== boundInstanceId) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Model selection belongs to provider instance '${input.modelSelection.instanceId}', not '${boundInstanceId}'.`,
              });
            }
            const steeringTurnId = ctx.activeTurnId;
            const turnId = steeringTurnId ?? TurnId.make(yield* randomUUID);
            if (!steeringTurnId) ctx.interruptedTurnId = undefined;
            ctx.promptsInFlight += 1;
            ctx.activeTurnId = turnId;
            return { ctx, steeringTurnId, turnId };
          }),
        );
        const abortActiveTurn = (reason: string) =>
          Effect.gen(function* () {
            const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
            ctx.activeTurnId = undefined;
            ctx.session = {
              ...readySession,
              status: "ready",
              updatedAt: yield* nowIso,
              lastError: reason,
            };
            yield* emit({
              type: "turn.aborted",
              ...(yield* stamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: { reason },
            });
          });
        return yield* Effect.gen(function* () {
          const selection = input.modelSelection;
          const requestedModel = selection?.model;

          if (!steeringTurnId) ctx.lastPlanFingerprint = undefined;
          ctx.session = {
            ...ctx.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };
          if (!steeringTurnId) {
            yield* emit({
              type: "turn.started",
              ...(yield* stamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              turnId,
              payload: { model: requestedModel ?? ctx.session.model ?? "default" },
            });
          }

          const prompt: Array<EffectAcpSchema.ContentBlock> = [];
          if (input.input?.trim()) prompt.push({ type: "text", text: input.input.trim() });
          for (const attachment of input.attachments ?? []) {
            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!attachmentPath) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: `Invalid attachment id '${attachment.id}'.`,
              });
            }
            const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "session/prompt",
                    detail: `Failed to read attachment '${attachment.id}'.`,
                    cause,
                  }),
              ),
            );
            prompt.push({
              type: "image",
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType,
            });
          }
          if (prompt.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }

          const result = yield* ctx.turnSemaphore.withPermit(
            Effect.gen(function* () {
              if (ctx.interruptedTurnId === turnId) {
                return { stopReason: "cancelled" as const };
              }
              const model = requestedModel ?? ctx.session.model;
              yield* configureSession({
                ctx,
                model,
                options: selection?.options,
                interactionMode: input.interactionMode,
              });
              ctx.session = { ...ctx.session, model };
              return yield* promptOpenCode2Acp(
                ctx.acp,
                { prompt },
                {
                  shouldRetry: () => ctx.interruptedTurnId !== turnId,
                  beforeRetry: applyOpenCode2AcpModelSelection({
                    runtime: ctx.acp,
                    model,
                    selections: selection?.options,
                    interactionMode: input.interactionMode,
                    mapError: ({ cause }) => cause,
                  }),
                },
              ).pipe(
                Effect.catchTags({
                  OpenCode2ReloadError: (error) =>
                    Effect.gen(function* () {
                      yield* abortActiveTurn(error.message);
                      yield* stopInternal(ctx);
                      return yield* new ProviderAdapterRequestError({
                        provider: PROVIDER,
                        method: error.method,
                        detail: "OpenCode 2.0 ACP session reload failed.",
                        cause: error,
                      });
                    }),
                }),
                Effect.mapError((cause) =>
                  cause._tag === "ProviderAdapterRequestError"
                    ? cause
                    : mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", cause),
                ),
              );
            }),
          );
          return yield* withLock(
            input.threadId,
            Effect.gen(function* () {
              yield* requireSession(input.threadId);
              yield* ctx.acp.drainEvents;
              let attachmentIndex = 0;
              const recordedPrompt = prompt.map((block) => {
                if (block.type !== "image") return block;
                const attachment = input.attachments?.[attachmentIndex++];
                return {
                  type: "image",
                  mimeType: block.mimeType,
                  ...(attachment ? { attachmentId: attachment.id } : {}),
                };
              });
              const turn = ctx.turns.find((candidate) => candidate.id === turnId);
              if (turn) turn.items.push({ prompt: recordedPrompt, result });
              else ctx.turns.push({ id: turnId, items: [{ prompt: recordedPrompt, result }] });
              if (ctx.promptsInFlight === 1) {
                const {
                  activeTurnId: _activeTurnId,
                  lastError: _lastError,
                  ...readySession
                } = ctx.session;
                ctx.activeTurnId = undefined;
                ctx.session = {
                  ...readySession,
                  status: "ready",
                  updatedAt: yield* nowIso,
                };
                yield* emit({
                  type: "turn.completed",
                  ...(yield* stamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: {
                    state: result.stopReason === "cancelled" ? "cancelled" : "completed",
                    stopReason: result.stopReason ?? null,
                  },
                });
              }
              return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
            }),
          );
        }).pipe(
          Effect.tapError((error) => {
            const abortTurn =
              !ctx.stopped && ctx.activeTurnId === turnId && ctx.promptsInFlight === 1
                ? abortActiveTurn(error.message)
                : Effect.void;
            return abortTurn;
          }),
          Effect.ensuring(
            Effect.gen(function* () {
              ctx.promptsInFlight = Math.max(0, ctx.promptsInFlight - 1);
              if (!ctx.stopped && ctx.promptsInFlight === 0 && ctx.activeTurnId === turnId) {
                yield* ctx.acp.cancelAndWait.pipe(Effect.ignore);
                yield* abortActiveTurn("Turn interrupted").pipe(Effect.ignore);
              }
            }),
          ),
        );
      });

    const interruptTurn: OpenCodeAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        ctx.interruptedTurnId = ctx.activeTurnId;
        yield* settlePending(ctx);
        yield* Effect.ignore(
          ctx.acp.cancelAndWait.pipe(
            Effect.mapError((cause) =>
              mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", cause),
            ),
          ),
        );
      });

    const respondToRequest: OpenCodeAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: OpenCodeAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/elicitation",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.resolution, { action: "accept", answers });
      });

    const readThread: OpenCodeAdapterShape["readThread"] = (threadId) =>
      Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));

    const rollbackThread: OpenCodeAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "thread/rollback",
          detail: "OpenCode 2.0 ACP sessions do not support provider-side rollback yet.",
        });
      });

    const stopSession: OpenCodeAdapterShape["stopSession"] = (threadId) =>
      withLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stopInternal(ctx);
        }),
      );
    const listSessions: OpenCodeAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));
    const hasSession: OpenCodeAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return ctx !== undefined && !ctx.stopped;
      });
    const stopAll: OpenCodeAdapterShape["stopAll"] = () =>
      Effect.forEach(
        Array.from(sessions.values()),
        (ctx) => withLock(ctx.threadId, stopInternal(ctx)),
        { discard: true },
      );

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to stop OpenCode2 ACP sessions.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(events)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      readThread,
      rollbackThread,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromPubSub(events),
    } satisfies OpenCodeAdapterShape;
  });
}
