import { type OpenCodeSettings, type ProviderOptionSelection } from "@t3tools/contracts";
import { getProviderOptionSelectionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type OpenCode2AcpSettings = Pick<OpenCodeSettings, "binaryPath">;

export interface OpenCode2AcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly settings: OpenCode2AcpSettings;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildOpenCode2AcpSpawnInput(
  settings: OpenCode2AcpSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: settings.binaryPath || "opencode2",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeOpenCode2AcpRuntime = (
  input: OpenCode2AcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildOpenCode2AcpSpawnInput(input.settings, input.cwd, input.environment),
        authMethodId: "opencode-login",
        clientCapabilities: {
          elicitation: { form: {} },
        },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
  });

export interface OpenCode2AcpSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly configId: "model" | "effort" | "mode";
}

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);
const isAcpTransportError = Schema.is(EffectAcpErrors.AcpTransportError);
const RELOAD_FAILURE_DETAIL = "OpenCode 2.0 ACP session reload failed";

export function isOpenCode2ReloadError(error: unknown): boolean {
  return isAcpTransportError(error) && error.detail === RELOAD_FAILURE_DETAIL;
}

export function isOpenCode2ActivePromptError(error: unknown): boolean {
  return (
    isAcpRequestError(error) &&
    error.method === "session/prompt" &&
    error.errorMessage.includes("Session already has an active ACP prompt")
  );
}

export function promptOpenCode2Acp(
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "prompt" | "reload">,
  payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">,
): Effect.Effect<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError> {
  return runtime.prompt(payload).pipe(
    Effect.catchTags({
      AcpRequestError: (error) =>
        isOpenCode2ActivePromptError(error)
          ? runtime.reload.pipe(
              Effect.mapError(
                (cause) =>
                  new EffectAcpErrors.AcpTransportError({
                    method: "session/load",
                    detail: RELOAD_FAILURE_DETAIL,
                    cause,
                  }),
              ),
              Effect.andThen(runtime.prompt(payload)),
            )
          : Effect.fail(error),
    }),
  );
}

export function applyOpenCode2AcpModelSelection<E>(input: {
  readonly runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "getConfigOptions" | "setConfigOption" | "setModel"
  >;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly interactionMode: "plan" | "default" | undefined;
  readonly mapError: (context: OpenCode2AcpSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const model = input.model?.trim();
    if (model) {
      yield* input.runtime
        .setModel(model)
        .pipe(Effect.mapError((cause) => input.mapError({ cause, configId: "model" })));
    }

    const configOptions = yield* input.runtime.getConfigOptions;
    const applySelect = Effect.fn("applyOpenCode2AcpModelSelection.applySelect")(function* (
      configId: "effort" | "mode",
      requestedValue: unknown,
    ) {
      if (typeof requestedValue !== "string" || !requestedValue.trim()) return;
      const config = configOptions.find((option) => option.id === configId);
      if (!config || config.type !== "select") return;
      const requested = requestedValue.trim().toLowerCase();
      const selected = config.options
        .flatMap((entry) => ("value" in entry ? [entry] : entry.options))
        .find(
          (option) =>
            option.value.trim().toLowerCase() === requested ||
            option.name.trim().toLowerCase() === requested,
        );
      if (!selected || selected.value === config.currentValue) return;
      yield* input.runtime
        .setConfigOption(configId, selected.value)
        .pipe(Effect.mapError((cause) => input.mapError({ cause, configId })));
    });

    yield* applySelect("effort", getProviderOptionSelectionValue(input.selections, "effort"));
    const selectedAgent = getProviderOptionSelectionValue(input.selections, "agent");
    yield* applySelect(
      "mode",
      input.interactionMode === "plan" ? "plan" : (selectedAgent ?? "build"),
    );
  });
}
