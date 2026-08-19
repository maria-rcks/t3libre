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
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
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
