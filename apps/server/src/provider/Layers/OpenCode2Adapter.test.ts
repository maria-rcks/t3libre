import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  ApprovalRequestId,
  OpenCode2Settings,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import {
  type OpenCode2Connection,
  type OpenCode2Event,
  type OpenCode2HttpMethod,
  type OpenCode2RequestInput,
  OpenCode2Runtime,
  type OpenCode2RuntimeShape,
} from "../openCode2Runtime.ts";
import { makeOpenCode2Adapter, type OpenCode2AdapterShape } from "./OpenCode2Adapter.ts";

interface RequestCall {
  readonly method: OpenCode2HttpMethod;
  readonly path: string;
  readonly operation: string;
  readonly body?: unknown;
}

interface Harness {
  readonly adapter: OpenCode2AdapterShape;
  readonly calls: Array<RequestCall>;
  readonly attachCount: () => number;
  readonly publish: (event: OpenCode2Event) => Effect.Effect<void>;
}

const settings = Schema.decodeSync(OpenCode2Settings)({
  enabled: true,
  binaryPath: "fake-opencode2",
  customModels: [],
});

const threadId = ThreadId.make("thread-opencode2-test");

function event(id: string, type: string, data: unknown): OpenCode2Event {
  return { id, type, data };
}

function withHarness<A, E>(
  promptShape: "flat" | "nested",
  run: (harness: Harness) => Effect.Effect<A, E, Scope.Scope>,
  enabled = true,
) {
  return Effect.gen(function* () {
    const events = yield* Queue.unbounded<OpenCode2Event>();
    const calls: Array<RequestCall> = [];
    let attachCalls = 0;
    const request = ((
      method: OpenCode2HttpMethod,
      path: string,
      input: OpenCode2RequestInput<Schema.Top>,
    ) =>
      Effect.sync(() => {
        calls.push({
          method,
          path,
          operation: input.operation,
          ...(input.body !== undefined ? { body: input.body } : {}),
        });
        if (path === "/api/session" || (method === "GET" && path.startsWith("/api/session/"))) {
          const id = path === "/api/session" ? "ses_test" : path.slice("/api/session/".length);
          return { data: { id } };
        }
        if (path.endsWith("/message")) return { data: [], cursor: {} };
        if (path.endsWith("/prompt")) return { data: { id: "msg_user" } };
        return undefined;
      })) as OpenCode2Connection["request"];
    const connection: OpenCode2Connection = {
      url: "http://127.0.0.1:4096",
      protocol: {
        promptShape,
        eventNamespace: promptShape === "flat" ? "session.next" : "session",
      },
      request,
      globalEvents: Stream.make(event("connected", "server.connected", {})).pipe(
        Stream.concat(Stream.fromQueue(events)),
      ),
    };
    const runtime: OpenCode2RuntimeShape = {
      attach: () =>
        Effect.sync(() => {
          attachCalls += 1;
          return connection;
        }),
    };
    const adapter = yield* makeOpenCode2Adapter({ ...settings, enabled }).pipe(
      Effect.provideService(OpenCode2Runtime, runtime),
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-opencode2-adapter-" })),
    );
    yield* Effect.yieldNow;
    return yield* run({
      adapter,
      calls,
      attachCount: () => attachCalls,
      publish: (next) => Queue.offer(events, next).pipe(Effect.asVoid),
    });
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
}

function collectEvents(
  adapter: OpenCode2AdapterShape,
  target: Array<ProviderRuntimeEvent>,
  onEvent?: (event: ProviderRuntimeEvent) => Effect.Effect<void>,
) {
  return adapter.streamEvents.pipe(
    Stream.runForEach((next) =>
      Effect.sync(() => {
        target.push(next);
      }).pipe(Effect.andThen(onEvent?.(next) ?? Effect.void)),
    ),
    Effect.forkScoped,
  );
}

it.effect("attaches once and maps native deltas, tools, and terminal events", () =>
  withHarness("flat", ({ adapter, attachCount, calls, publish }) =>
    Effect.gen(function* () {
      const observed: Array<ProviderRuntimeEvent> = [];
      const firstCompleted = yield* Deferred.make<void>();
      const secondCompleted = yield* Deferred.make<void>();
      const publicDelta = yield* Deferred.make<void>();
      let completedCount = 0;
      yield* collectEvents(adapter, observed, (next) =>
        Effect.gen(function* () {
          if (next.type === "turn.completed") {
            completedCount += 1;
            yield* Deferred.succeed(
              completedCount === 1 ? firstCompleted : secondCompleted,
              undefined,
            ).pipe(Effect.ignore);
          }
          if (next.type === "content.delta" && next.payload.delta === "public") {
            yield* Deferred.succeed(publicDelta, undefined).pipe(Effect.ignore);
          }
        }),
      );
      NodeAssert.equal(attachCount(), 0);
      const session = yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        cwd: "/tmp/opencode2-project",
      });
      NodeAssert.equal(attachCount(), 1);
      const turn = yield* adapter.sendTurn({ threadId, input: "hello" });

      const promptCall = calls.find((call) => call.operation === "session.prompt");
      NodeAssert.deepEqual(promptCall?.body, { text: "hello", delivery: "steer" });
      NodeAssert.equal(session.resumeCursor !== undefined, true);

      yield* publish(
        event("foreign", "session.next.text.delta", {
          sessionID: "ses_foreign",
          textID: "txt_foreign",
          delta: "ignore me",
        }),
      );
      yield* publish(
        event("reasoning-started", "session.next.reasoning.started", {
          sessionID: "ses_test",
          reasoningID: "reasoning-1",
        }),
      );
      yield* publish(
        event("reasoning", "session.next.reasoning.delta", {
          sessionID: "ses_test",
          reasoningID: "reasoning-1",
          delta: "thinking",
        }),
      );
      yield* publish(
        event("reasoning-ended", "session.next.reasoning.ended", {
          sessionID: "ses_test",
          reasoningID: "reasoning-1",
          text: "thinking",
        }),
      );
      yield* publish(
        event("text-started", "session.next.text.started", {
          sessionID: "ses_test",
          textID: "text-1",
        }),
      );
      yield* publish(
        event("text", "session.next.text.delta", {
          sessionID: "ses_test",
          textID: "text-1",
          delta: "answer",
        }),
      );
      yield* publish(
        event("tool-input-started", "session.next.tool.input.started", {
          sessionID: "ses_test",
          callID: "call-1",
          name: "shell",
        }),
      );
      yield* publish(
        event("tool-input-delta", "session.next.tool.input.delta", {
          sessionID: "ses_test",
          callID: "call-1",
          delta: '{"command":',
        }),
      );
      yield* publish(
        event("tool-input-ended", "session.next.tool.input.ended", {
          sessionID: "ses_test",
          callID: "call-1",
          text: '{"command":"pwd"}',
        }),
      );
      yield* publish(
        event("tool-called", "session.next.tool.called", {
          sessionID: "ses_test",
          callID: "call-1",
          tool: "shell",
          input: { command: "pwd" },
        }),
      );
      yield* publish(
        event("tool-progress", "session.next.tool.progress", {
          sessionID: "ses_test",
          callID: "call-1",
          content: [{ type: "text", text: "/tmp" }],
        }),
      );
      yield* publish(
        event("tool-success", "session.next.tool.success", {
          sessionID: "ses_test",
          callID: "call-1",
          content: [{ type: "text", text: "done" }],
        }),
      );
      yield* publish(
        event("settled", "session.next.execution.settled", {
          sessionID: "ses_test",
          outcome: "success",
        }),
      );
      yield* Deferred.await(firstCompleted);

      const deltas = observed.filter((next) => next.type === "content.delta");
      NodeAssert.deepEqual(
        deltas.map((next) => next.payload),
        [
          { streamKind: "reasoning_text", delta: "thinking" },
          { streamKind: "assistant_text", delta: "answer" },
        ],
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "item.started"),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "item.updated"),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "item.completed"),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "turn.completed" && next.turnId === turn.turnId),
        true,
      );

      yield* adapter.sendTurn({ threadId, input: "public dev alias" });
      NodeAssert.equal(attachCount(), 1);
      yield* publish(
        event("public-text", "session.text.delta", {
          sessionID: "ses_test",
          assistantMessageID: "msg_public",
          ordinal: 0,
          delta: "public",
        }),
      );
      yield* publish(
        event("public-terminal", "session.execution.succeeded", {
          sessionID: "ses_test",
        }),
      );
      yield* Deferred.await(publicDelta);
      yield* Deferred.await(secondCompleted);
      NodeAssert.equal(
        observed.some((next) => next.type === "content.delta" && next.payload.delta === "public"),
        true,
      );
      NodeAssert.equal(observed.filter((next) => next.type === "turn.completed").length, 2);
    }),
  ),
);

it.effect("replies to permissions and forms and interrupts through native routes", () =>
  withHarness("nested", ({ adapter, calls, publish }) =>
    Effect.gen(function* () {
      const observed: Array<ProviderRuntimeEvent> = [];
      const permissionOpened = yield* Deferred.make<void>();
      const formOpened = yield* Deferred.make<void>();
      const turnAborted = yield* Deferred.make<void>();
      yield* collectEvents(adapter, observed, (next) => {
        if (next.type === "request.opened") {
          return Deferred.succeed(permissionOpened, undefined).pipe(Effect.ignore);
        }
        if (next.type === "user-input.requested") {
          return Deferred.succeed(formOpened, undefined).pipe(Effect.ignore);
        }
        if (next.type === "turn.aborted") {
          return Deferred.succeed(turnAborted, undefined).pipe(Effect.ignore);
        }
        return Effect.void;
      });
      yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
      yield* adapter.sendTurn({ threadId, input: "inspect" });

      const promptCall = calls.find((call) => call.operation === "session.prompt");
      NodeAssert.deepEqual(promptCall?.body, {
        prompt: { text: "inspect" },
        delivery: "steer",
      });

      yield* publish(
        event("permission", "permission.asked", {
          id: "per_test",
          sessionID: "ses_test",
          action: "read",
          resources: [".env"],
        }),
      );
      yield* publish(
        event("form", "form.created", {
          form: {
            id: "frm_test",
            sessionID: "ses_test",
            title: "Choose",
            fields: [
              {
                key: "choice",
                type: "string",
                title: "Choice",
                description: "Pick one",
                options: [{ value: "one", label: "One" }],
              },
            ],
          },
        }),
      );
      yield* Deferred.await(permissionOpened);
      yield* Deferred.await(formOpened);

      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make("per_test"),
        "acceptForSession",
      );
      yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make("frm_test"), {
        choice: "one",
      });
      yield* adapter.interruptTurn(threadId);
      yield* Deferred.await(turnAborted);

      NodeAssert.deepEqual(
        calls.find((call) => call.operation === "permission.reply"),
        {
          method: "POST",
          path: "/api/session/ses_test/permission/per_test/reply",
          operation: "permission.reply",
          body: { reply: "always" },
        },
      );
      NodeAssert.deepEqual(
        calls.find((call) => call.operation === "form.reply"),
        {
          method: "POST",
          path: "/api/session/ses_test/form/frm_test/reply",
          operation: "form.reply",
          body: { answer: { choice: "one" } },
        },
      );
      NodeAssert.equal(
        calls.some(
          (call) =>
            call.operation === "session.interrupt" &&
            call.path === "/api/session/ses_test/interrupt",
        ),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "request.opened"),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "user-input.requested"),
        true,
      );
      NodeAssert.equal(
        observed.some((next) => next.type === "turn.aborted"),
        true,
      );
    }),
  ),
);

it.effect("resumes existing sessions and detaches without stop or delete requests", () =>
  withHarness("flat", ({ adapter, calls }) =>
    Effect.gen(function* () {
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        resumeCursor: { schemaVersion: 1, sessionId: "ses_existing" },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("opencode2"),
          "anthropic/claude-sonnet",
          [{ id: "variant", value: "low" }],
        ),
      });
      NodeAssert.equal(
        calls.some((call) => call.method === "GET" && call.path === "/api/session/ses_existing"),
        true,
      );
      yield* adapter.sendTurn({
        threadId,
        input: "change effort",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("opencode2"),
          "anthropic/claude-sonnet",
          [{ id: "variant", value: "high" }],
        ),
      });
      NodeAssert.deepEqual(
        calls.findLast((call) => call.operation === "session.switchModel")?.body,
        {
          model: {
            providerID: "anthropic",
            id: "claude-sonnet",
            variant: "high",
          },
        },
      );
      yield* adapter.stopSession(threadId);
      yield* adapter.startSession({
        threadId: ThreadId.make("thread-opencode2-second"),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: ThreadId.make("thread-opencode2-second"),
        input: "active",
      });
      yield* adapter.stopAll();

      NodeAssert.equal(
        calls.some((call) => call.method === "DELETE"),
        false,
      );
      NodeAssert.equal(
        calls.some((call) => call.path.includes("/service/stop")),
        false,
      );
      NodeAssert.equal(calls.filter((call) => call.operation === "session.interrupt").length, 2);
      NodeAssert.deepEqual(yield* adapter.listSessions(), []);
    }),
  ),
);

it.effect("does not attach when OpenCode 2 is disabled", () =>
  withHarness(
    "flat",
    ({ adapter, attachCount }) =>
      Effect.gen(function* () {
        const result = yield* adapter
          .startSession({ threadId, runtimeMode: "full-access" })
          .pipe(Effect.exit);
        NodeAssert.equal(Exit.isFailure(result), true);
        NodeAssert.equal(attachCount(), 0);
      }),
    false,
  ),
);
