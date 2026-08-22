import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import * as OpenCodeRuntime from "../provider/opencodeRuntime.ts";
import { makeOpenCodeTextGeneration } from "./OpenCodeTextGeneration.ts";

interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: unknown;
  readonly body: unknown;
}

function runtimeLayer(response: unknown, requests: Array<CapturedRequest>) {
  const connection: OpenCodeRuntime.OpenCodeConnection = {
    url: "http://127.0.0.1:49374/",
    protocol: { promptShape: "flat" },
    request: ((
      method: string,
      path: string,
      input: { readonly query?: unknown; readonly body?: unknown },
    ) => {
      requests.push({ method, path, query: input.query, body: input.body });
      return Effect.succeed(response);
    }) as OpenCodeRuntime.OpenCodeConnection["request"],
    globalEvents: Stream.empty,
  };
  return Layer.succeed(
    OpenCodeRuntime.OpenCodeRuntime,
    OpenCodeRuntime.OpenCodeRuntime.of({ attach: () => Effect.succeed(connection) }),
  );
}

it.effect("generates structured text through the attached OpenCode 2 service", () => {
  const requests: Array<CapturedRequest> = [];
  return Effect.gen(function* () {
    const textGeneration = yield* makeOpenCodeTextGeneration({ binaryPath: "opencode2" });
    const generated = yield* textGeneration.generateCommitMessage({
      cwd: "/work/project",
      branch: "feat/opencode2",
      stagedSummary: "M apps/server/src/provider/opencodeRuntime.ts",
      stagedPatch: "diff --git a/runtime.ts b/runtime.ts",
      modelSelection: createModelSelection(ProviderInstanceId.make("opencode"), "openai/gpt-5.6", [
        { id: "variant", value: "high" },
      ]),
    });

    NodeAssert.deepEqual(generated, {
      subject: "Add OpenCode 2 runtime",
      body: "Attach to the shared service.",
    });
    NodeAssert.equal(requests.length, 1);
    const request = requests[0];
    NodeAssert.ok(request);
    NodeAssert.equal(request.method, "POST");
    NodeAssert.equal(request.path, "/api/generate");
    NodeAssert.deepEqual(request.query, {
      "location[directory]": "/work/project",
    });
    NodeAssert.deepEqual(request.body, {
      prompt: (request.body as { readonly prompt: string }).prompt,
      model: { providerID: "openai", id: "gpt-5.6", variant: "high" },
    });
    NodeAssert.match((request.body as { readonly prompt: string }).prompt, /commit message/i);
  }).pipe(
    Effect.provide(
      runtimeLayer(
        {
          text: JSON.stringify({
            subject: "Add OpenCode 2 runtime",
            body: "Attach to the shared service.",
          }),
        },
        requests,
      ),
    ),
  );
});

it.effect("rejects model selections that do not identify an upstream provider", () => {
  const requests: Array<CapturedRequest> = [];
  return Effect.gen(function* () {
    const textGeneration = yield* makeOpenCodeTextGeneration({ binaryPath: "opencode2" });
    const error = yield* Effect.flip(
      textGeneration.generateBranchName({
        cwd: "/work/project",
        message: "add opencode 2",
        modelSelection: createModelSelection(ProviderInstanceId.make("opencode"), "gpt-5.6"),
      }),
    );

    NodeAssert.equal(error._tag, "TextGenerationError");
    NodeAssert.match(error.detail, /provider\/model/);
    NodeAssert.equal(requests.length, 0);
  }).pipe(Effect.provide(runtimeLayer({ text: JSON.stringify({ branch: "unused" }) }, requests)));
});
