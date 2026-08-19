// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  OpenCodeSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { attachmentRelativePath } from "../../attachmentStore.ts";
import { makeOpenCode2Adapter } from "./OpenCode2Adapter.ts";

const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);
const mockAgentPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../scripts/acp-mock-agent.ts",
);

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-opencode2-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const makeMockWrapper = Effect.fn("makeMockWrapper")(function* (
  extraEnv: Readonly<Record<string, string>> = {},
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "opencode2-acp-mock-"))),
    (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
  );
  const wrapperPath = NodePath.join(directory, "opencode2");
  const env = Object.entries(extraEnv)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${env}
exec ${shellQuote(process.execPath)} ${shellQuote(mockAgentPath)} "$@"
`;
  yield* Effect.promise(() => NodeFSP.writeFile(wrapperPath, script, { mode: 0o755 }));
  return wrapperPath;
});

const makeTestAdapter = (binaryPath: string) =>
  makeOpenCode2Adapter(decodeOpenCodeSettings({ binaryPath })).pipe(Effect.orDie);

it.layer(testLayer)("OpenCode2Adapter", (it) => {
  it.effect("returns the session to ready after a completed turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(yield* makeMockWrapper());
        const threadId = ThreadId.make("opencode2-complete");
        const events: ProviderRuntimeEvent[] = [];
        const completed = yield* Deferred.make<void>();
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)).pipe(
            Effect.andThen(
              event.type === "turn.completed"
                ? Deferred.succeed(completed, undefined)
                : Effect.void,
            ),
          ),
        ).pipe(Effect.forkChild);

        const started = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("opencode"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        assert.strictEqual(started.status, "ready");

        yield* adapter.sendTurn({ threadId, input: "hello" });
        yield* Deferred.await(completed);

        const [session] = yield* adapter.listSessions();
        assert.strictEqual(session?.status, "ready");
        assert.isUndefined(session?.activeTurnId);
        assert.isTrue(events.some((event) => event.type === "turn.started"));
        assert.isTrue(events.some((event) => event.type === "turn.completed"));
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("keeps attachment references without retaining encoded image data", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(yield* makeMockWrapper());
        const { attachmentsDir } = yield* ServerConfig;
        const threadId = ThreadId.make("opencode2-attachment");
        const attachment = {
          type: "image" as const,
          id: "opencode2-attachment-12345678-1234-1234-1234-123456789abc",
          name: "diagram.png",
          mimeType: "image/png",
          sizeBytes: 4,
        };
        const attachmentPath = NodePath.join(attachmentsDir, attachmentRelativePath(attachment));
        yield* Effect.promise(() =>
          NodeFSP.mkdir(NodePath.dirname(attachmentPath), { recursive: true }),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(attachmentPath, Uint8Array.from([1, 2, 3, 4])),
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        yield* adapter.sendTurn({ threadId, input: "inspect", attachments: [attachment] });
        const history = yield* adapter.readThread(threadId);
        const item = history.turns[0]?.items[0] as
          | { prompt?: Array<{ type?: string; data?: string; attachmentId?: string }> }
          | undefined;
        const image = item?.prompt?.find((block) => block.type === "image");

        assert.strictEqual(image?.attachmentId, attachment.id);
        assert.isUndefined(image?.data);
      }),
    ),
  );

  it.effect("answers elicitation while the session is starting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({ T3_ACP_ELICIT_DURING_CREATE_SESSION: "1" }),
        );
        const threadId = ThreadId.make("opencode2-startup-elicitation");
        const requestId = yield* Deferred.make<ApprovalRequestId>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "user-input.requested" && event.requestId
              ? Deferred.succeed(requestId, ApprovalRequestId.make(event.requestId))
              : Effect.void,
          ),
          Effect.forkChild,
        );
        const startFiber = yield* adapter
          .startSession({
            threadId,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          })
          .pipe(Effect.forkChild);

        yield* adapter.respondToUserInput(threadId, yield* Deferred.await(requestId), {
          mode: ["plan"],
        });
        const session = yield* Fiber.join(startFiber);

        assert.strictEqual(session.status, "ready");
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("offers explicit boolean elicitation choices", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({ T3_ACP_ELICIT_BOOLEAN_DURING_CREATE_SESSION: "1" }),
        );
        const threadId = ThreadId.make("opencode2-boolean-elicitation");
        const requested =
          yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "user-input.requested" }>>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "user-input.requested"
              ? Deferred.succeed(requested, event)
              : Effect.void,
          ),
          Effect.forkChild,
        );
        const startFiber = yield* adapter
          .startSession({
            threadId,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          })
          .pipe(Effect.forkChild);

        const event = yield* Deferred.await(requested);
        assert.deepStrictEqual(
          event.payload.questions[0]?.options.map((option) => option.label),
          ["true", "false"],
        );
        yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make(event.requestId ?? ""), {
          enabled: ["true"],
        });
        const session = yield* Fiber.join(startFiber);

        assert.strictEqual(session.status, "ready");
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("uses array item choices and omits optional elicitation fields", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({ T3_ACP_ELICIT_COMPLEX_DURING_CREATE_SESSION: "1" }),
        );
        const threadId = ThreadId.make("opencode2-complex-elicitation");
        const requested =
          yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "user-input.requested" }>>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "user-input.requested"
              ? Deferred.succeed(requested, event)
              : Effect.void,
          ),
          Effect.forkChild,
        );
        const startFiber = yield* adapter
          .startSession({
            threadId,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          })
          .pipe(Effect.forkChild);

        const event = yield* Deferred.await(requested);
        assert.strictEqual(event.payload.questions.length, 1);
        assert.strictEqual(event.payload.questions[0]?.id, "targets");
        assert.isTrue(event.payload.questions[0]?.multiSelect);
        assert.deepStrictEqual(
          event.payload.questions[0]?.options.map((option) => option.label),
          ["web", "mobile"],
        );
        yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make(event.requestId ?? ""), {
          targets: ["web", "mobile"],
        });
        assert.strictEqual((yield* Fiber.join(startFiber)).status, "ready");
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("cancels unsupported URL elicitations without blocking startup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({ T3_ACP_ELICIT_URL_DURING_CREATE_SESSION: "1" }),
        );
        const session = yield* adapter.startSession({
          threadId: ThreadId.make("opencode2-url-elicitation"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        assert.strictEqual(session.status, "ready");
      }),
    ),
  );

  it.effect("cancels pending elicitation when a turn is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "opencode2-elicitation-response-")),
          ),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const responseLogPath = NodePath.join(directory, "responses.ndjson");
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({
            T3_ACP_ELICIT_DURING_PROMPT: "1",
            T3_ACP_ELICITATION_RESPONSE_LOG_PATH: responseLogPath,
          }),
        );
        const threadId = ThreadId.make("opencode2-interrupt-elicitation");
        const requested = yield* Deferred.make<void>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "user-input.requested"
              ? Deferred.succeed(requested, undefined)
              : Effect.void,
          ),
          Effect.forkChild,
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "ask first" })
          .pipe(Effect.forkChild);

        yield* Deferred.await(requested);
        yield* adapter.interruptTurn(threadId);
        yield* Fiber.join(turnFiber);

        const response = yield* Effect.promise(() => NodeFSP.readFile(responseLogPath, "utf8"));
        assert.strictEqual(response.trim(), "cancel");
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("aborts a turn when its queued follow-up fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const configured = yield* Deferred.make<void>();
        const adapter = yield* makeOpenCode2Adapter(
          decodeOpenCodeSettings({
            binaryPath: yield* makeMockWrapper({
              T3_ACP_ELICIT_DURING_PROMPT: "1",
              T3_ACP_FAIL_PROMPT_NUMBER: "2",
            }),
          }),
          {
            nativeEventLogger: {
              filePath: "memory://native-events",
              close: () => Effect.void,
              write: (record) => {
                const value = record as {
                  event?: { kind?: string; payload?: { method?: string; status?: string } };
                };
                return value.event?.kind === "request" &&
                  value.event.payload?.method === "session/set_config_option" &&
                  value.event.payload.status === "succeeded"
                  ? Deferred.succeed(configured, undefined)
                  : Effect.void;
              },
            },
          },
        ).pipe(Effect.orDie);
        const threadId = ThreadId.make("opencode2-failed-follow-up");
        const inputRequested = yield* Deferred.make<ApprovalRequestId>();
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => events.push(event)).pipe(
              Effect.andThen(
                event.type === "user-input.requested" && event.requestId
                  ? Deferred.succeed(inputRequested, ApprovalRequestId.make(event.requestId))
                  : Effect.void,
              ),
            ),
          ),
          Effect.forkChild,
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        const first = yield* adapter.sendTurn({ threadId, input: "first" }).pipe(Effect.forkChild);
        const requestId = yield* Deferred.await(inputRequested);
        const second = yield* adapter
          .sendTurn({
            threadId,
            input: "follow up",
            modelSelection: {
              instanceId: ProviderInstanceId.make("opencode"),
              model: "composer-2",
            },
          })
          .pipe(Effect.forkChild);

        yield* Deferred.await(configured);
        yield* adapter.respondToUserInput(threadId, requestId, { mode: ["build"] });
        yield* Fiber.join(first);
        const secondExit = yield* Fiber.await(second);

        assert.strictEqual(secondExit._tag, "Failure");
        assert.strictEqual(events.filter((event) => event.type === "turn.started").length, 1);
        assert.strictEqual(events.filter((event) => event.type === "turn.completed").length, 0);
        assert.strictEqual(events.filter((event) => event.type === "turn.aborted").length, 1);
        const [session] = yield* adapter.listSessions();
        assert.strictEqual(session?.status, "ready");
        assert.isUndefined(session?.activeTurnId);
        assert.isString(session?.lastError);
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("merges concurrent sends into one active turn", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(yield* makeMockWrapper());
        const threadId = ThreadId.make("opencode2-concurrent-turn");
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild,
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const [first, second] = yield* Effect.all(
          [
            adapter.sendTurn({ threadId, input: "first" }),
            adapter.sendTurn({ threadId, input: "second" }),
          ],
          { concurrency: "unbounded" },
        );

        assert.strictEqual(first.turnId, second.turnId);
        assert.strictEqual(events.filter((event) => event.type === "turn.started").length, 1);
        assert.strictEqual(events.filter((event) => event.type === "turn.completed").length, 1);
        assert.strictEqual((yield* adapter.readThread(threadId)).turns.length, 1);
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("aborts a failed turn and leaves the session usable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(yield* makeMockWrapper({ T3_ACP_FAIL_PROMPT: "1" }));
        const threadId = ThreadId.make("opencode2-failure");
        const aborted = yield* Deferred.make<void>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "turn.aborted" ? Deferred.succeed(aborted, undefined) : Effect.void,
          ),
          Effect.forkChild,
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const result = yield* Effect.exit(adapter.sendTurn({ threadId, input: "fail" }));
        assert.strictEqual(result._tag, "Failure");
        yield* Deferred.await(aborted);

        const [session] = yield* adapter.listSessions();
        assert.strictEqual(session?.status, "ready");
        assert.isUndefined(session?.activeTurnId);
        assert.isString(session?.lastError);
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("removes a session when active-prompt recovery cannot reload it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(
          yield* makeMockWrapper({
            T3_ACP_ACTIVE_PROMPT_ERROR_NUMBER: "1",
            T3_ACP_FAIL_FIRST_LOAD_SESSION: "1",
          }),
        );
        const threadId = ThreadId.make("opencode2-reload-failure");
        const exited = yield* Deferred.make<void>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            event.type === "session.exited" ? Deferred.succeed(exited, undefined) : Effect.void,
          ),
          Effect.forkChild,
        );
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const result = yield* Effect.exit(adapter.sendTurn({ threadId, input: "recover" }));

        assert.strictEqual(result._tag, "Failure");
        yield* Deferred.await(exited);
        assert.isFalse(yield* adapter.hasSession(threadId));
        assert.deepStrictEqual(yield* adapter.listSessions(), []);
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("rejects rollback that ACP cannot apply", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeTestAdapter(yield* makeMockWrapper());
        const threadId = ThreadId.make("opencode2-rollback");
        yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });

        const result = yield* Effect.exit(adapter.rollbackThread(threadId, 1));
        assert.strictEqual(result._tag, "Failure");
      }),
    ),
  );
});
