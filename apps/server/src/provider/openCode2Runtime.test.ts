import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  detectOpenCode2Protocol,
  makeOpenCode2Runtime,
  type OpenCode2CommandInput,
  type OpenCode2CommandResult,
} from "./openCode2Runtime.ts";

function openApi(
  promptProperty: "text" | "prompt",
  operationId: string | null = "v2.session.prompt",
) {
  return {
    paths: {
      "/api/session/{sessionID}/prompt": {
        post: {
          ...(operationId === null ? {} : { operationId }),
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionPrompt" },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        SessionPrompt: {
          type: "object",
          properties: { [promptProperty]: { type: "string" } },
        },
      },
    },
  };
}

function fakeRuntime(input?: {
  readonly document?: unknown;
  readonly onRequest?: (request: HttpClientRequest.HttpClientRequest) => Response;
}) {
  const commands: OpenCode2CommandInput[] = [];
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const runCommand = (command: OpenCode2CommandInput) => {
    commands.push(command);
    const result: OpenCode2CommandResult =
      command.args.join(" ") === "service start"
        ? { stdout: "http://127.0.0.1:49374\n", stderr: "", code: 0 }
        : { stdout: "private-password\n", stderr: "", code: 0 };
    return Effect.succeed(result);
  };
  const httpClient = HttpClient.make((request) => {
    requests.push(request);
    const pathname = new URL(request.url).pathname;
    const response =
      pathname === "/openapi.json"
        ? Response.json(input?.document ?? openApi("text"))
        : (input?.onRequest?.(request) ?? Response.json({ ok: true }));
    return Effect.succeed(HttpClientResponse.fromWeb(request, response));
  });
  return {
    commands,
    requests,
    runtime: makeOpenCode2Runtime({ runCommand, httpClient }),
  };
}

it.effect("memoizes one service attachment per binary and environment", () => {
  const fake = fakeRuntime();
  return Effect.gen(function* () {
    const runtime = yield* fake.runtime;
    const first = yield* runtime.attach({
      binaryPath: "opencode2",
      environment: { PATH: "/one" },
    });
    const second = yield* runtime.attach({
      binaryPath: "opencode2",
      environment: { PATH: "/one" },
    });

    NodeAssert.equal(first, second);
    NodeAssert.deepEqual(
      fake.commands.map((command) => command.args),
      [
        ["service", "start"],
        ["service", "get", "password"],
      ],
    );
    NodeAssert.equal(
      fake.requests.filter((request) => request.url.endsWith("/openapi.json")).length,
      1,
    );

    yield* runtime.attach({
      binaryPath: "opencode2",
      environment: { PATH: "/two" },
    });
    NodeAssert.equal(fake.commands.length, 4);
  });
});

it.effect("refreshes a cached attachment when the shared service is no longer healthy", () => {
  let healthFails = false;
  const fake = fakeRuntime({
    onRequest: (request) => {
      if (new URL(request.url).pathname === "/api/health" && healthFails) {
        return Response.json({ healthy: false }, { status: 503 });
      }
      return Response.json({ healthy: true });
    },
  });
  return Effect.gen(function* () {
    const runtime = yield* fake.runtime;
    const first = yield* runtime.attach({ binaryPath: "opencode2" });
    healthFails = true;
    const second = yield* runtime.attach({ binaryPath: "opencode2" });

    NodeAssert.notEqual(first, second);
    NodeAssert.deepEqual(
      fake.commands.map((command) => command.args),
      [
        ["service", "start"],
        ["service", "get", "password"],
        ["service", "start"],
        ["service", "get", "password"],
      ],
    );
  });
});

it.effect("uses private Basic auth for typed JSON and global SSE requests", () => {
  const fake = fakeRuntime({
    onRequest: (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/event") {
        return new Response(
          'data: {"id":"evt_1",\n' +
            'data: "type":"server.connected","data":{}}\n\n' +
            'data: {"id":"evt_2","type":"session.text.delta","data":{"delta":"hi"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return Response.json({ value: "accepted" });
    },
  });
  return Effect.gen(function* () {
    const runtime = yield* fake.runtime;
    const connection = yield* runtime.attach({ binaryPath: "opencode2" });
    const response = yield* connection.request("POST", "/api/example", {
      operation: "example.post",
      schema: Schema.Struct({ value: Schema.String }),
      query: { count: 2 },
      body: { text: "hello" },
    });
    const events = yield* connection.globalEvents.pipe(Stream.runCollect);

    NodeAssert.deepEqual(response, { value: "accepted" });
    NodeAssert.deepEqual(
      Array.from(events).map((event) => event.type),
      ["server.connected", "session.text.delta"],
    );
    const authenticated = fake.requests.filter(
      (request) => new URL(request.url).pathname !== "/openapi.json",
    );
    NodeAssert.ok(authenticated.length >= 2);
    for (const request of authenticated) {
      NodeAssert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from("opencode:private-password").toString("base64")}`,
      );
    }
    NodeAssert.equal(new URL(authenticated[0]!.url).searchParams.get("count"), "2");
  });
});

it.effect("decodes empty 204 responses against the requested schema", () => {
  const fake = fakeRuntime({
    onRequest: () => new Response(null, { status: 204 }),
  });
  return Effect.gen(function* () {
    const runtime = yield* fake.runtime;
    const connection = yield* runtime.attach({ binaryPath: "opencode2" });
    const response = yield* connection.request("POST", "/api/session/ses_1/interrupt", {
      operation: "session.interrupt",
      schema: Schema.Undefined,
    });

    NodeAssert.equal(response, undefined);
  });
});

it.effect("fails explicitly when the preview OpenAPI shape is unknown", () => {
  const fake = fakeRuntime({ document: { openapi: "3.1.0", paths: {} } });
  return Effect.gen(function* () {
    const runtime = yield* fake.runtime;
    const error = yield* Effect.flip(runtime.attach({ binaryPath: "opencode2" }));

    NodeAssert.equal(error.kind, "unsupported-preview");
    NodeAssert.match(error.detail, /unsupported prompt protocol/i);
  });
});

it.effect("times out a wedged service command", () => {
  const httpClient = HttpClient.make(() => Effect.die("HTTP should not be reached"));
  return Effect.gen(function* () {
    const runtime = yield* makeOpenCode2Runtime({
      runCommand: () => Effect.never,
      httpClient,
    });
    const fiber = yield* runtime.attach({ binaryPath: "opencode2" }).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("10 seconds");
    const error = yield* Fiber.join(fiber).pipe(Effect.flip);

    NodeAssert.equal(error.kind, "command");
    NodeAssert.match(error.detail, /service start.*timed out/i);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()));
});

it("detects both adjacent preview prompt shapes", () => {
  NodeAssert.deepEqual(detectOpenCode2Protocol(openApi("text")), {
    promptShape: "flat",
  });
  NodeAssert.deepEqual(detectOpenCode2Protocol(openApi("prompt")), {
    promptShape: "nested",
  });
  NodeAssert.deepEqual(detectOpenCode2Protocol(openApi("prompt", "session.prompt")), {
    promptShape: "nested",
  });
  NodeAssert.deepEqual(detectOpenCode2Protocol(openApi("prompt", null)), {
    promptShape: "nested",
  });
});
