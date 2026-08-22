import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  OpenCode2Runtime,
  OpenCode2RuntimeError,
  type OpenCode2Connection,
} from "../openCode2Runtime.ts";
import { checkOpenCode2ProviderStatus } from "./OpenCode2Provider.ts";

const settings = {
  enabled: true,
  binaryPath: "opencode2",
  customModels: [],
} as const;

function runtimeLayer(input: {
  readonly responses?: Readonly<Record<string, unknown>>;
  readonly attachError?: OpenCode2RuntimeError;
  readonly paths?: Array<string>;
}) {
  const connection: OpenCode2Connection = {
    url: "http://127.0.0.1:49374/",
    protocol: { promptShape: "flat" },
    request: ((method: string, path: string, _requestInput: { readonly schema: unknown }) => {
      input.paths?.push(`${method} ${path}`);
      return Effect.succeed(input.responses?.[path]);
    }) as OpenCode2Connection["request"],
    globalEvents: Stream.empty,
  };
  return Layer.succeed(
    OpenCode2Runtime,
    OpenCode2Runtime.of({
      attach: () =>
        input.attachError ? Effect.fail(input.attachError) : Effect.succeed(connection),
    }),
  );
}

it.effect("builds model inventory from the attached OpenCode 2 service", () => {
  const paths: Array<string> = [];
  return Effect.gen(function* () {
    const snapshot = yield* checkOpenCode2ProviderStatus(settings);

    NodeAssert.equal(snapshot.status, "ready");
    NodeAssert.equal(snapshot.installed, true);
    NodeAssert.equal(snapshot.version, "0.0.0-beta-17823");
    NodeAssert.equal(snapshot.auth.status, "authenticated");
    NodeAssert.deepEqual(paths.toSorted(), [
      "GET /api/agent",
      "GET /api/health",
      "GET /api/model",
      "GET /api/model/default",
    ]);
    NodeAssert.deepEqual(
      snapshot.models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
      [
        { slug: "anthropic/claude-opus-4-6", isDefault: undefined },
        { slug: "openai/gpt-5.6", isDefault: true },
      ],
    );
    const selected = snapshot.models.find((model) => model.slug === "openai/gpt-5.6");
    NodeAssert.deepEqual(
      selected?.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id) ?? [],
      ["variant", "agent"],
    );
  }).pipe(
    Effect.provide(
      runtimeLayer({
        paths,
        responses: {
          "/api/health": { healthy: true, version: "0.0.0-beta-17823", pid: 42 },
          "/api/model": {
            data: [
              {
                id: "gpt-5.6",
                providerID: "openai",
                name: "GPT-5.6",
                variants: { low: {}, high: {} },
              },
              {
                id: "claude-opus-4-6",
                providerID: "anthropic",
                name: "Claude Opus 4.6",
                variants: [],
              },
            ],
          },
          "/api/model/default": {
            data: {
              id: "gpt-5.6",
              providerID: "openai",
              name: "GPT-5.6",
              variants: { low: {}, high: {} },
            },
          },
          "/api/agent": {
            data: [
              { id: "build", name: "Build" },
              { id: "explore", name: "Explore", mode: "subagent" },
            ],
          },
        },
      }),
    ),
  );
});

it.effect("reports unsupported adjacent preview protocols without hanging", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkOpenCode2ProviderStatus(settings);

    NodeAssert.equal(snapshot.status, "error");
    NodeAssert.match(snapshot.message ?? "", /preview is not supported/i);
  }).pipe(
    Effect.provide(
      runtimeLayer({
        attachError: new OpenCode2RuntimeError({
          operation: "openapi.detect",
          kind: "unsupported-preview",
          detail: "Unsupported prompt response.",
        }),
      }),
    ),
  ),
);

it.effect("does not report an HTTP 404 as a missing CLI", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkOpenCode2ProviderStatus(settings);

    NodeAssert.equal(snapshot.status, "error");
    NodeAssert.equal(snapshot.installed, true);
    NodeAssert.doesNotMatch(snapshot.message ?? "", /not installed/i);
  }).pipe(
    Effect.provide(
      runtimeLayer({
        attachError: new OpenCode2RuntimeError({
          operation: "model.list",
          kind: "request",
          detail: "OpenCode 2 model.list returned HTTP 404 Not Found.",
        }),
      }),
    ),
  ),
);

it.effect("warns when the attached OpenCode 2 service reports unhealthy", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkOpenCode2ProviderStatus(settings);

    NodeAssert.equal(snapshot.status, "warning");
    NodeAssert.match(snapshot.message ?? "", /reported that it is unhealthy/i);
  }).pipe(
    Effect.provide(
      runtimeLayer({
        responses: {
          "/api/health": { healthy: false, version: "0.0.0-beta-17823" },
          "/api/model": {
            data: [
              {
                id: "gpt-5.6",
                providerID: "openai",
                name: "GPT-5.6",
              },
            ],
          },
          "/api/model/default": { data: null },
          "/api/agent": { data: [] },
        },
      }),
    ),
  ),
);

it.effect("describes custom models without counting deprecated upstream providers", () => {
  const customSettings = {
    ...settings,
    customModels: ["custom/local-model"],
  };
  return Effect.gen(function* () {
    const snapshot = yield* checkOpenCode2ProviderStatus(customSettings);

    NodeAssert.equal(snapshot.status, "ready");
    NodeAssert.match(snapshot.message ?? "", /custom models configured/i);
    NodeAssert.doesNotMatch(snapshot.message ?? "", /0 upstream providers/i);
  }).pipe(
    Effect.provide(
      runtimeLayer({
        responses: {
          "/api/health": { healthy: true, version: "0.0.0-beta-17823" },
          "/api/model": {
            data: [
              {
                id: "old-model",
                providerID: "legacy",
                name: "Old Model",
                status: "deprecated",
              },
            ],
          },
          "/api/model/default": { data: null },
          "/api/agent": { data: [] },
        },
      }),
    ),
  );
});

it.effect("finishes the provider check when attachment is wedged", () => {
  const layer = Layer.succeed(
    OpenCode2Runtime,
    OpenCode2Runtime.of({ attach: () => Effect.never }),
  );
  return Effect.gen(function* () {
    const fiber = yield* checkOpenCode2ProviderStatus(settings).pipe(Effect.forkScoped);
    yield* Effect.yieldNow;
    yield* TestClock.adjust("15 seconds");
    const snapshot = yield* Fiber.join(fiber);

    NodeAssert.equal(snapshot.status, "error");
    NodeAssert.match(snapshot.message ?? "", /discovery timed out/i);
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(layer, TestClock.layer())));
});
