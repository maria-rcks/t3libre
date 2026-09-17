import {
  createUuidV7Mint,
  spawnMspConnection,
  type MspHandshake,
  type SpawnedMspConnection,
} from "@muse-code/sdk";
import {
  EventId,
  MUSE_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnId,
  type MuseSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/hostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { MuseSkillCatalog, museSkillInputParts, museSkillMentions } from "../Drivers/MuseSkills.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import {
  decodeMuseModelSelection,
  MUSE_ROUTED_MODEL_PREFIX,
  MuseModelCatalog,
} from "../muse/MuseModels.ts";
import {
  decodeMuseNotification,
  isMuseNotificationMethod,
  mapMuseNotification,
  MuseItem,
  museApprovalDecision,
  type MuseNotification,
} from "../muse/MuseRuntimeEvents.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import type * as ProviderAdapter from "../Services/ProviderAdapter.ts";

type Adapter = ProviderAdapter.ProviderAdapterShape<ProviderAdapterError>;

const PROVIDER = ProviderDriverKind.make("muse");
const encodePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const ResumeCursor = Schema.Struct({
  sessionId: Schema.String,
  schemaVersion: Schema.Literal(1),
  selectedModel: Schema.optional(Schema.String),
});
const SessionResult = Schema.Struct({
  session: Schema.Struct({
    sessionId: Schema.String,
    workspaceRoot: Schema.String,
    modelId: Schema.NullOr(Schema.String),
    status: Schema.String,
    activeTurnId: Schema.NullOr(Schema.String),
  }),
  history: Schema.optional(
    Schema.Struct({
      mode: Schema.String,
      items: Schema.NullOr(Schema.Array(MuseItem)),
      snapshot: Schema.NullOr(
        Schema.Struct({ state: Schema.Struct({ items: Schema.Array(MuseItem) }) }),
      ),
    }),
  ),
});
const TurnResult = Schema.Struct({ status: Schema.Literal("accepted"), turnId: Schema.String });
const CompactResult = Schema.Struct({
  status: Schema.Literals(["accepted", "noop"]),
  reason: Schema.optional(Schema.String),
});
const decodeResumeCursor = Schema.decodeUnknownEffect(ResumeCursor);
const decodeAnswer = Schema.decodeUnknownEffect(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);
type Approval = Extract<
  MuseNotification,
  { method: "approval/requested" | "approval/updated" }
>["params"];
type UserInput = Extract<MuseNotification, { method: "userInput/requested" }>["params"];
interface SessionContext {
  session: ProviderSession;
  sessionId: string;
  host: SpawnedMspConnection;
  handshake: MspHandshake;
  scope: Scope.Closeable;
  lock: Semaphore.Semaphore;
  items: Map<string, MuseItem>;
  streamed: Map<string, string>;
  deltaCursors: Map<string, Set<string>>;
  approvals: Map<string, Approval>;
  questions: Map<string, UserInput>;
  settledTurns: Set<string>;
  selectedModel: string;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  pendingTokenUsage: Map<string, Extract<MuseNotification, { method: "session/tokenUsage" }>>;
  stopped: boolean;
}

export function make(
  settings: MuseSettings,
  options?: {
    environment?: NodeJS.ProcessEnv;
    instanceId?: ProviderInstanceId;
  },
) {
  return Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const clock = yield* Clock.Clock;
    const nowIso = () => DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("muse");
    const environment = options?.environment ?? (yield* HostProcess.HostProcessEnvironment);
    const sessions = new Map<ThreadId, SessionContext>();
    const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const lifecycle = yield* Semaphore.make(1);
    const mintEventId = createUuidV7Mint();
    const nextEventId = () => EventId.make(mintEventId());
    const requestError = (method: string, cause: unknown) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail:
          typeof cause === "string"
            ? cause
            : "Muse Code rejected the request or its response was invalid.",
        ...(typeof cause === "string" ? {} : { cause }),
      });
    const attempt = <A>(method: string, run: () => Promise<A>) =>
      Effect.tryPromise({ try: run, catch: (cause) => requestError(method, cause) }).pipe(
        Effect.timeoutOrElse({
          duration: "60 seconds",
          orElse: () => Effect.fail(requestError(method, `${method} timed out`)),
        }),
      );
    const resolveModelSelection = Effect.fn("MuseAdapter.resolveModelSelection")(function* (
      host: SpawnedMspConnection,
      model: string,
    ) {
      const catalog = yield* attempt("model/list", () =>
        host.connection.request("model/list", {}),
      ).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MuseModelCatalog)),
        Effect.mapError((cause) => requestError("model/list", cause)),
      );
      const routing = decodeMuseModelSelection(model);
      const matches = catalog.models.filter((entry) =>
        routing
          ? entry.modelId === routing.modelId &&
            entry.providerId === routing.providerId &&
            entry.profileId === routing.profileId
          : model === MUSE_DEFAULT_MODEL
            ? entry.isDefault
            : entry.modelId === model,
      );
      const match = matches[0];
      if (
        match &&
        matches.some(
          (entry) =>
            entry.modelId !== match.modelId ||
            entry.providerId !== match.providerId ||
            entry.profileId !== match.profileId,
        )
      )
        return yield* requestError(
          "session/setModel",
          "Muse Code reported ambiguous model routing. Select a model with a unique provider profile.",
        );
      if (match)
        return {
          modelId: match.modelId,
          providerId: match.providerId,
          profileId: match.profileId,
          displayLabel: match.displayLabel,
        };
      if (model === MUSE_DEFAULT_MODEL)
        return yield* requestError(
          "session/setModel",
          "Muse Code did not report its default model. Select an explicit model or start a new thread to use its startup default.",
        );
      if (model.startsWith(MUSE_ROUTED_MODEL_PREFIX))
        return yield* requestError(
          "session/setModel",
          "The selected Muse model profile is no longer available. Select a model from the current catalog.",
        );
      return { modelId: model };
    });
    const base = (ctx: SessionContext) => ({
      eventId: nextEventId(),
      provider: PROVIDER,
      providerInstanceId: instanceId,
      threadId: ctx.session.threadId,
      createdAt: nowIso(),
    });
    const emit = (event: ProviderRuntimeEvent) => {
      Queue.offerUnsafe(events, event);
    };
    const requireSession = Effect.fn("MuseAdapter.requireSession")(function* (threadId: ThreadId) {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped)
        return yield* new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
      return ctx;
    });
    const failSession = (ctx: SessionContext, message: string) => {
      if (ctx.stopped) return;
      ctx.stopped = true;
      const turnId = ctx.session.activeTurnId;
      ctx.session = { ...ctx.session, status: "error", lastError: message, updatedAt: nowIso() };
      if (turnId && !ctx.settledTurns.has(turnId)) {
        ctx.settledTurns.add(turnId);
        emit({
          ...base(ctx),
          type: "turn.completed",
          turnId,
          payload: { state: "failed", errorMessage: message },
        });
      }
      emit({
        ...base(ctx),
        type: "runtime.error",
        ...(turnId ? { turnId } : {}),
        payload: { message },
      });
      emit({
        ...base(ctx),
        type: "session.exited",
        payload: { reason: message, recoverable: true },
      });
      // MSP invokes this at its native callback boundary, outside an Effect fiber.
      void Effect.runPromise(
        lifecycle.withPermit(
          Effect.gen(function* () {
            yield* Scope.close(ctx.scope, Exit.void);
            if (sessions.get(ctx.session.threadId) === ctx) sessions.delete(ctx.session.threadId);
          }),
        ),
      ).catch(() => undefined);
    };
    const receive = (ctx: SessionContext, input: { method: string; params?: unknown }) => {
      if (ctx.stopped) return;
      if (input.method === "view/gap") {
        failSession(
          ctx,
          "Muse Code dropped session events. Send another message to resume the session.",
        );
        return;
      }
      if (!isMuseNotificationMethod(input.method)) return;
      const event = decodeMuseNotification(input);
      if (event.method !== "usage/changed" && event.params.sessionId !== ctx.sessionId) return;
      if (event.method === "session/tokenUsage" && ctx.contextUsedTokens === undefined) {
        // Canonical usage is a per-turn snapshot; keep only each turn's latest notification.
        ctx.pendingTokenUsage.delete(event.params.turnId);
        ctx.pendingTokenUsage.set(event.params.turnId, event);
        return;
      }
      if (event.method === "item/delta") {
        const item = ctx.items.get(event.params.itemId);
        if (item && item.status !== "inProgress") return;
        const cursors = ctx.deltaCursors.get(event.params.itemId) ?? new Set<string>();
        if (cursors.has(event.params.viewCursor)) return;
        cursors.add(event.params.viewCursor);
        ctx.deltaCursors.set(event.params.itemId, cursors);
      }
      if (event.method === "session/contextUsage") {
        ctx.contextUsedTokens = event.params.usedTokens;
        if (event.params.windowTokens === undefined) delete ctx.contextWindowTokens;
        else ctx.contextWindowTokens = event.params.windowTokens;
      }
      if (
        event.method === "item/started" ||
        event.method === "item/updated" ||
        event.method === "item/completed"
      ) {
        const prior = ctx.items.get(event.params.item.itemId);
        if (prior && prior.revision >= event.params.item.revision) return;
      }
      if (event.method === "approval/requested" || event.method === "approval/updated") {
        const prior = ctx.approvals.get(event.params.approvalId);
        if (prior?.viewCursor === event.params.viewCursor) return;
        ctx.approvals.set(event.params.approvalId, event.params);
      }
      if (event.method === "userInput/requested") {
        if (ctx.questions.get(event.params.userInputId)?.viewCursor === event.params.viewCursor)
          return;
        ctx.questions.set(event.params.userInputId, event.params);
      }
      if (event.method === "userInput/settled") ctx.questions.delete(event.params.userInputId);
      if (event.method === "turn/started") {
        if (ctx.settledTurns.has(event.params.turnId)) return;
        ctx.session = {
          ...ctx.session,
          status: "running",
          activeTurnId: TurnId.make(event.params.turnId),
        };
      }
      if (event.method === "turn/completed" || event.method === "turn/unqueued") {
        if (ctx.settledTurns.has(event.params.turnId)) return;
        ctx.settledTurns.add(event.params.turnId);
      }
      for (const mapped of mapMuseNotification(event, {
        threadId: ctx.session.threadId,
        providerInstanceId: instanceId,
        createdAt: nowIso(),
        nextEventId,
        itemById: (id) => ctx.items.get(id),
        streamedText: (id, field) => ctx.streamed.get(`${id}:${field}`) ?? "",
        approvalSubjectById: (id) => ctx.approvals.get(id)?.subject,
        ...(ctx.contextUsedTokens !== undefined
          ? { contextUsedTokens: ctx.contextUsedTokens }
          : {}),
        ...(ctx.contextWindowTokens !== undefined
          ? { contextWindowTokens: ctx.contextWindowTokens }
          : {}),
        ...(ctx.session.activeTurnId ? { activeTurnId: ctx.session.activeTurnId } : {}),
      })) {
        if (mapped.type === "content.delta" && mapped.itemId) {
          const field =
            mapped.payload.summaryIndex !== undefined
              ? `summary.${mapped.payload.summaryIndex}`
              : mapped.payload.streamKind === "command_output"
                ? "output"
                : "text";
          const key = `${mapped.itemId}:${field}`;
          ctx.streamed.set(key, (ctx.streamed.get(key) ?? "") + mapped.payload.delta);
        }
        emit(mapped);
      }
      if (event.method === "approval/resolved") ctx.approvals.delete(event.params.approvalId);
      if (
        event.method === "item/started" ||
        event.method === "item/updated" ||
        event.method === "item/completed"
      ) {
        ctx.items.set(event.params.item.itemId, event.params.item);
        if (event.params.item.status !== "inProgress")
          ctx.deltaCursors.delete(event.params.item.itemId);
      }
      if (
        (event.method === "turn/completed" || event.method === "turn/unqueued") &&
        ctx.session.activeTurnId === event.params.turnId
      ) {
        const { activeTurnId: _, ...rest } = ctx.session;
        ctx.session = { ...rest, status: "ready", updatedAt: nowIso() };
      }
      if (event.method === "session/contextUsage" && ctx.pendingTokenUsage.size > 0) {
        const pending = [...ctx.pendingTokenUsage.values()];
        ctx.pendingTokenUsage.clear();
        for (const usage of pending) receive(ctx, usage);
      }
    };
    const stopContext = Effect.fn("MuseAdapter.stopContext")(function* (ctx: SessionContext) {
      ctx.stopped = true;
      yield* Scope.close(ctx.scope, Exit.void);
      if (sessions.get(ctx.session.threadId) === ctx) sessions.delete(ctx.session.threadId);
      emit({
        ...base(ctx),
        type: "session.exited",
        payload: { reason: "Session stopped", recoverable: true },
      });
    });
    const startSession: Adapter["startSession"] = (input) =>
      lifecycle.withPermit(
        Effect.gen(function* () {
          const existing = sessions.get(input.threadId);
          if (existing) yield* stopContext(existing);
          const scope = yield* Scope.make();
          const start = Effect.gen(function* () {
            const cwd = input.cwd ?? config.cwd;
            const mcp = McpProviderSession.readMcpProviderSession(input.threadId);
            const args = ["serve", "--trust-workspace"];
            if (
              input.sandboxMode === "danger-full-access" ||
              (input.sandboxMode === undefined && input.runtimeMode === "full-access")
            )
              args.push("--disable-sandbox");
            if (input.sandboxMode === "read-only") args.push("--disable-write", "--disable-shell");
            const handshake = yield* Effect.acquireRelease(
              Effect.try({
                try: () =>
                  spawnMspConnection({
                    command: settings.binaryPath || "muse",
                    args,
                    cwd,
                    env: McpProviderSession.withAgentDeviceEnvironment(environment, mcp),
                    shutdownTimeoutMs: 2_000,
                  }),
                catch: (cause) => requestError("spawn", cause),
              }),
              (child) => Effect.tryPromise(() => child.close()).pipe(Effect.ignore),
            );
            const host = yield* attempt("initialize", () =>
              handshake.initialize({
                clientInfo: { name: "t3_code", version: "0.0.0" },
                capabilities: { requestedCapabilities: mcp ? ["sessionMcp"] : [] },
              }),
            );
            const cursor =
              input.resumeCursor === undefined
                ? undefined
                : yield* decodeResumeCursor(input.resumeCursor).pipe(
                    Effect.mapError((cause) => requestError("resume", cause)),
                  );
            const sessionId = cursor?.sessionId ?? host.connection.mintCommandId();
            const selectedModel =
              cursor?.selectedModel ?? input.modelSelection?.model ?? MUSE_DEFAULT_MODEL;
            const now = nowIso();
            const ctx: SessionContext = {
              session: {
                provider: PROVIDER,
                providerInstanceId: instanceId,
                threadId: input.threadId,
                runtimeMode: input.runtimeMode,
                cwd,
                status: "connecting",
                createdAt: now,
                updatedAt: now,
                resumeCursor: { schemaVersion: 1, sessionId, selectedModel },
              },
              sessionId,
              host,
              handshake,
              scope,
              lock: yield* Semaphore.make(1),
              items: new Map(),
              streamed: new Map(),
              deltaCursors: new Map(),
              approvals: new Map(),
              questions: new Map(),
              settledTurns: new Set(),
              pendingTokenUsage: new Map(),
              selectedModel,
              stopped: false,
            };
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                ctx.stopped = true;
              }),
            );
            host.connection.onNotification((notification) => {
              try {
                receive(ctx, notification);
              } catch {
                failSession(ctx, "Muse Code sent an invalid notification.");
              }
            });
            host.connection.onProtocolError(() =>
              failSession(ctx, "Muse Code sent an invalid protocol frame."),
            );
            host.connection.onServerRequest(async (request) => {
              const method =
                request.method === "approval/request"
                  ? "approval/requested"
                  : request.method === "userInput/request"
                    ? "userInput/requested"
                    : undefined;
              if (!method) throw new Error(`Unsupported Muse Code request: ${request.method}`);
              try {
                receive(ctx, { method, params: request.params });
              } catch (cause) {
                failSession(ctx, "Muse Code sent an invalid server request.");
                throw cause;
              }
              return {};
            });
            void host.connection.closed.then(() => {
              if (!ctx.stopped)
                failSession(
                  ctx,
                  "Muse Code closed its connection. Resume the thread to reconnect.",
                );
            });
            void host.child.exit.then((exit) => {
              if (!ctx.stopped)
                failSession(
                  ctx,
                  `Muse Code exited (${exit.kind}). Resume the thread to reconnect.`,
                );
            });
            const mode =
              input.approvalPolicy === "never" ||
              (input.approvalPolicy === undefined && input.runtimeMode === "full-access")
                ? "allowAll"
                : input.approvalPolicy === "untrusted" || input.runtimeMode === "approval-required"
                  ? "promptUnmatched"
                  : "onRequest";
            const model = input.modelSelection?.model;
            const initialSelection =
              !cursor && model && model !== MUSE_DEFAULT_MODEL
                ? yield* resolveModelSelection(host, model)
                : undefined;
            const sessionConfig = mcp
              ? {
                  mcpServers: {
                    "t3-code": {
                      transport: "streamableHttp",
                      url: mcp.endpoint,
                      headers: { Authorization: mcp.authorizationHeader },
                      mode: "required",
                    },
                  },
                }
              : undefined;
            const result = yield* attempt(cursor ? "session/resume" : "session/start", () =>
              host.connection.command(cursor ? "session/resume" : "session/start", {
                sessionId,
                ...(sessionConfig ? { config: sessionConfig } : {}),
                ...(cursor
                  ? { history: "inline" }
                  : {
                      workspaceRoot: cwd,
                      approvalMode: mode,
                      ...(initialSelection
                        ? {
                            modelId: initialSelection.modelId,
                            ...("providerId" in initialSelection
                              ? { providerId: initialSelection.providerId }
                              : {}),
                          }
                        : {}),
                    }),
              }),
            ).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(SessionResult)),
              Effect.mapError((cause) => requestError("session/start", cause)),
            );
            if (result.session.workspaceRoot !== cwd)
              return yield* requestError(
                "session/resume",
                "Muse session belongs to a different workspace.",
              );
            if (ctx.stopped)
              return yield* requestError(
                "session/start",
                ctx.session.lastError ?? "Muse Code exited during session startup.",
              );
            // session/start accepts a provider, but only setModel carries its profile.
            if (initialSelection && "profileId" in initialSelection)
              yield* attempt("session/setModel", () =>
                host.connection.command("session/setModel", {
                  sessionId,
                  model: initialSelection,
                }),
              );
            for (const item of result.history?.items ??
              result.history?.snapshot?.state.items ??
              []) {
              if ((ctx.items.get(item.itemId)?.revision ?? -1) < item.revision)
                ctx.items.set(item.itemId, item);
              if (item.text) ctx.streamed.set(`${item.itemId}:text`, item.text);
              item.summary?.forEach((text, index) =>
                ctx.streamed.set(`${item.itemId}:summary.${index}`, text),
              );
            }
            if (ctx.session.status === "connecting") {
              const activeTurnId = result.session.activeTurnId;
              ctx.session = {
                ...ctx.session,
                status: activeTurnId && !ctx.settledTurns.has(activeTurnId) ? "running" : "ready",
                ...(activeTurnId && !ctx.settledTurns.has(activeTurnId)
                  ? { activeTurnId: TurnId.make(activeTurnId) }
                  : {}),
              };
            }
            if (cursor)
              yield* attempt("session/setApprovalMode", () =>
                host.connection.command("session/setApprovalMode", { sessionId, mode }),
              );
            ctx.session = {
              ...ctx.session,
              ...(result.session.modelId ? { model: result.session.modelId } : {}),
            };
            if (ctx.stopped)
              return yield* requestError(
                "session/resume",
                ctx.session.lastError ?? "Muse Code disconnected.",
              );
            sessions.set(input.threadId, ctx);
            emit({
              ...base(ctx),
              type: "session.started",
              payload: { resume: ctx.session.resumeCursor },
            });
            emit({
              ...base(ctx),
              type: "thread.started",
              payload: { providerThreadId: sessionId },
            });
            return ctx.session;
          }).pipe(Effect.provideService(Scope.Scope, scope));
          return yield* start.pipe(
            Effect.onError(() => Scope.close(scope, Exit.void)),
            Effect.onInterrupt(() => Scope.close(scope, Exit.void)),
          );
        }),
      );
    const sendTurn: Adapter["sendTurn"] = Effect.fn("MuseAdapter.sendTurn")(function* (input) {
      const ctx = yield* requireSession(input.threadId);
      return yield* ctx.lock.withPermit(
        Effect.gen(function* () {
          if (ctx.stopped)
            return yield* requestError(
              "turn/start",
              "Muse Code session has closed. Resume the thread to reconnect.",
            );
          if (input.interactionMode === "plan")
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Muse Code does not expose a plan mode through MSP.",
            });
          const parts: Array<Record<string, unknown>> = [];
          if (input.input?.trim()) {
            const prompt = input.input;
            if (museSkillMentions(prompt).length > 0) {
              const catalog = yield* attempt("skill/list", () =>
                ctx.host.connection.request("skill/list", { sessionId: ctx.sessionId }),
              ).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(MuseSkillCatalog)),
                Effect.mapError((cause) => requestError("skill/list", cause)),
              );
              parts.push(
                { type: "text", text: buildRuntimeInstructions({ harness: "Muse Code" }) },
                ...museSkillInputParts(
                  prompt,
                  new Set(catalog.skills.map((skill) => skill.selector)),
                ),
              );
            } else {
              parts.push({
                type: "text",
                text: `${buildRuntimeInstructions({ harness: "Muse Code" })}\n\n${prompt}`,
              });
            }
          }
          for (const attachment of input.attachments ?? []) {
            const filePath = resolveAttachmentPath({
              attachmentsDir: config.attachmentsDir,
              attachment,
            });
            if (!filePath)
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: "Muse Code could not resolve the attachment.",
              });
            if (attachment.type === "image") {
              const bytes = yield* fs
                .readFile(filePath)
                .pipe(Effect.mapError((cause) => requestError("attachment", cause)));
              parts.push({
                type: "image",
                mediaType: attachment.mimeType,
                base64Data: Buffer.from(bytes).toString("base64"),
              });
            } else if (attachment.type === "file") {
              parts.push({
                type: "text",
                text: `Attached file: ${encodePath(filePath)}`,
              });
            } else {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "sendTurn",
                issue: `Unsupported attachment type: ${attachment.type}`,
              });
            }
          }
          if (!parts.length)
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Muse Code requires text or an image.",
            });
          const model = input.modelSelection?.model;
          if (
            model &&
            (model !== ctx.selectedModel ||
              (model !== MUSE_DEFAULT_MODEL &&
                (decodeMuseModelSelection(model)?.modelId ?? model) !== ctx.session.model))
          ) {
            const selection = yield* resolveModelSelection(ctx.host, model);
            yield* attempt("session/setModel", () =>
              ctx.host.connection.command("session/setModel", {
                sessionId: ctx.sessionId,
                model: selection,
              }),
            );
            ctx.session = { ...ctx.session, model: selection.modelId };
          }
          if (input.modelSelection) {
            ctx.selectedModel = input.modelSelection.model;
            ctx.session = {
              ...ctx.session,
              resumeCursor: {
                schemaVersion: 1,
                sessionId: ctx.sessionId,
                selectedModel: ctx.selectedModel,
              },
            };
          }
          const effort = input.modelSelection
            ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
            : undefined;
          const result = yield* attempt("turn/start", () =>
            ctx.host.connection.command("turn/start", {
              sessionId: ctx.sessionId,
              input: parts,
              ifBusy: "steer",
              ...(effort ? { reasoningEffort: effort } : {}),
            }),
          ).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(TurnResult)),
            Effect.mapError((cause) => requestError("turn/start", cause)),
          );
          if (ctx.stopped)
            return yield* requestError(
              "turn/start",
              ctx.session.lastError ?? "Muse Code disconnected.",
            );
          if (!ctx.settledTurns.has(result.turnId))
            ctx.session = {
              ...ctx.session,
              status: "running",
              activeTurnId: TurnId.make(result.turnId),
              updatedAt: nowIso(),
            };
          return {
            threadId: input.threadId,
            turnId: TurnId.make(result.turnId),
            resumeCursor: ctx.session.resumeCursor,
          };
        }),
      );
    });
    const interruptTurn: Adapter["interruptTurn"] = Effect.fn("MuseAdapter.interruptTurn")(
      function* (threadId, turnId) {
        const ctx = yield* requireSession(threadId);
        const target = turnId ?? ctx.session.activeTurnId;
        if (!target || (turnId && ctx.session.activeTurnId !== turnId)) return;
        yield* attempt("turn/interrupt", () =>
          ctx.host.connection.command("turn/interrupt", {
            sessionId: ctx.sessionId,
            turnId: target,
          }),
        );
      },
    );
    const respondToRequest: Adapter["respondToRequest"] = Effect.fn("MuseAdapter.respondToRequest")(
      function* (threadId, requestId, decision) {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.approvals.get(requestId);
        if (!pending)
          return yield* requestError("approval/decide", "Approval is no longer pending.");
        const choice = pending.availableChoices.find(
          (choice) => museApprovalDecision(choice.decision, choice.scope) === decision,
        );
        if (!choice)
          return yield* requestError(
            "approval/decide",
            `Muse Code does not offer the ${decision} decision for this request.`,
          );
        yield* attempt("approval/decide", () =>
          ctx.host.connection.command("approval/decide", {
            sessionId: ctx.sessionId,
            approvalId: requestId,
            requirementId: pending.currentRequirementId,
            choiceId: choice.choiceId,
          }),
        );
      },
    );
    const respondToUserInput: Adapter["respondToUserInput"] = Effect.fn(
      "MuseAdapter.respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const ctx = yield* requireSession(threadId);
      const pending = ctx.questions.get(requestId);
      if (!pending)
        return yield* requestError("userInput/answer", "Question is no longer pending.");
      const entries = yield* Effect.forEach(pending.questions, (question) =>
        Effect.gen(function* () {
          const values = yield* decodeAnswer(answers[question.id]).pipe(
            Effect.mapError((cause) => requestError("userInput/answer", cause)),
          );
          const selected = typeof values === "string" ? [values] : [...values];
          const allOptions = selected.every((value) =>
            question.options.some((option) => option.label === value),
          );
          if (allOptions) {
            const count = new Set(selected).size;
            const min =
              question.selection.mode === "single" ? 1 : (question.selection.minSelections ?? 0);
            const max = question.selection.mode === "single" ? 1 : question.selection.maxSelections;
            if (count !== selected.length || count < min || (max !== undefined && count > max))
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "respondToUserInput",
                issue: `Select ${min}${max === undefined ? " or more" : ` to ${max}`} distinct options for this question.`,
              });
          }
          return {
            questionId: question.id,
            ...(allOptions && (selected.length || question.selection.mode === "multiple")
              ? question.selection.mode === "multiple"
                ? { selectedLabels: selected }
                : { selectedLabel: selected[0] }
              : { freeText: selected.join("\n") }),
          };
        }),
      );
      yield* attempt("userInput/answer", () =>
        ctx.host.connection.command("userInput/answer", {
          sessionId: ctx.sessionId,
          userInputId: requestId,
          answers: entries,
        }),
      );
    });
    const readThread: Adapter["readThread"] = Effect.fn("MuseAdapter.readThread")(
      function* (threadId) {
        const ctx = yield* requireSession(threadId);
        const turns = new Map<TurnId, MuseItem[]>();
        for (const item of ctx.items.values())
          if (item.turnId) {
            const id = TurnId.make(item.turnId);
            const items = turns.get(id) ?? [];
            items.push(item);
            turns.set(id, items);
          }
        return { threadId, turns: Array.from(turns, ([id, items]) => ({ id, items })) };
      },
    );
    const stopSession: Adapter["stopSession"] = (threadId) =>
      lifecycle.withPermit(
        Effect.gen(function* () {
          const ctx = sessions.get(threadId);
          if (ctx) yield* stopContext(ctx);
        }),
      );
    const stopAll = () => Effect.forEach([...sessions.values()], stopContext, { discard: true });
    const compactThread = Effect.fn("MuseAdapter.compactThread")(function* (threadId: ThreadId) {
      const ctx = yield* requireSession(threadId);
      yield* ctx.lock.withPermit(
        Effect.gen(function* () {
          const result = yield* attempt("session/compact", () =>
            ctx.host.connection.command("session/compact", { sessionId: ctx.sessionId }),
          ).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(CompactResult)),
            Effect.mapError((cause) => requestError("session/compact", cause)),
          );
          if (result.status === "noop")
            yield* Queue.offer(events, {
              ...base(ctx),
              eventId: nextEventId(),
              type: "item.completed",
              payload: {
                itemType: "context_compaction",
                status: "completed",
                title: "Compaction skipped",
                detail: result.reason ?? "Muse Code has no context to compact.",
                data: { outcome: "noop" },
              },
            });
        }),
      );
    });
    yield* Effect.addFinalizer(() => stopAll().pipe(Effect.ensuring(Queue.shutdown(events))));
    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
      compaction: { type: "native", start: compactThread },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      readThread,
      rollbackThread: () =>
        Effect.fail(
          requestError("rollbackThread", "Muse Code conversation rollback is not supported."),
        ),
      stopSession,
      stopAll,
      listSessions: () =>
        Effect.sync(() => [...sessions.values()].map((ctx) => ({ ...ctx.session }))),
      hasSession: (threadId) =>
        Effect.sync(() => {
          const ctx = sessions.get(threadId);
          return ctx !== undefined && !ctx.stopped;
        }),
      streamEvents: Stream.fromQueue(events),
    } satisfies Adapter;
  });
}
