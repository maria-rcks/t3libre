import {
  type DevinSettings,
  type RuntimeMode,
  type ProviderSendTurnInput,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { normalizeDevinSessionUpdate } from "./DevinProtocol.ts";
import { prepareDevinMcpEnvironment } from "./DevinMcpSupport.ts";

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "spawn" | "authMethodId" | "clientCapabilities"
> {
  readonly devinSettings: Pick<DevinSettings, "binaryPath">;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

/** Uses the CLI's existing login. ACP authenticate launches an interactive browser even when logged in. */
export const makeDevinAcpRuntime = Effect.fn("makeDevinAcpRuntime")(function* (
  input: DevinAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope | FileSystem.FileSystem | Path.Path
> {
  const prepared = yield* prepareDevinMcpEnvironment({
    mcpServers: input.mcpServers ?? [],
    environment: input.environment ?? process.env,
  });
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn: {
        command: input.devinSettings.binaryPath || "devin",
        args: prepared.args,
        cwd: input.cwd,
        env: prepared.environment,
      },
      authMethodId: undefined,
      cancelBehavior: "wait-for-prompt",
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      transformSessionUpdate: normalizeDevinSessionUpdate,
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

export function devinPermissionMode(mode: RuntimeMode): string {
  switch (mode) {
    case "full-access":
      return "bypass";
    case "auto":
      return "smart";
    case "approval-required":
      return "ask";
    case "auto-accept-edits":
      return "accept-edits";
  }
}

export function devinModelOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
) {
  const model = configOptions.find((option) => option.id === "model");
  if (model?.type !== "select") return [];
  return model.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

/**
 * Resolves the model a turn should run on. A saved selection is reapplied
 * as-is. The provider default alias resolves to `defaultModel` when the
 * account offers it, so T3 can pick a model other than the one Devin marks
 * current. Otherwise the agent's current selection stands.
 */
export function resolveDevinModel(input: {
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly model: string | null | undefined;
  readonly defaultModel?: string | undefined;
}): string | undefined {
  const modelConfig = input.configOptions.find((option) => option.id === "model");
  const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
  if (input.model && input.model !== "default") return input.model;
  const options = devinModelOptions(input.configOptions);
  return input.defaultModel && options.some((option) => option.value === input.defaultModel)
    ? input.defaultModel
    : current;
}

/** Never replace a saved selection with the default returned by a cold resume. */
export const applyDevinAcpModelSelection = Effect.fn("applyDevinAcpModelSelection")(function* <
  E,
>(input: {
  readonly runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "getConfigOptions" | "setModel"
  >;
  readonly model: string | null | undefined;
  /** Model to select for the provider default alias. See `resolveDevinModel`. */
  readonly defaultModel?: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.fn.Return<string | undefined, E> {
  const configOptions = yield* input.runtime.getConfigOptions;
  const modelConfig = configOptions.find((option) => option.id === "model");
  const current = modelConfig?.type === "select" ? modelConfig.currentValue : undefined;
  const resolved = resolveDevinModel({
    configOptions,
    model: input.model,
    defaultModel: input.defaultModel,
  });
  // The default alias never sends an internal ID. It selects the manifest
  // default when that differs from the agent's current model, and otherwise
  // leaves the agent's choice alone.
  const explicit = Boolean(input.model) && input.model !== "default";
  if (resolved === undefined || (!explicit && resolved === current)) return current;
  const options = devinModelOptions(configOptions);
  if (!options.some((option) => option.value === resolved)) {
    return yield* Effect.fail(
      input.mapError(
        EffectAcpErrors.AcpRequestError.invalidParams(
          `Devin model '${resolved}' is unavailable for this account. Select an available model.`,
        ),
      ),
    );
  }
  yield* input.runtime.setModel(resolved).pipe(Effect.mapError(input.mapError));
  return resolved;
});

/** Images use native ACP content; other uploads retain the server's workspace path hints. */
export const buildDevinPrompt = Effect.fn("buildDevinPrompt")(function* (input: {
  readonly input: ProviderSendTurnInput["input"];
  readonly attachments: ProviderSendTurnInput["attachments"];
  readonly attachmentsDir: string;
}): Effect.fn.Return<
  ReadonlyArray<EffectAcpSchema.ContentBlock>,
  EffectAcpErrors.AcpError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const blocks: EffectAcpSchema.ContentBlock[] = [];
  if (input.input?.trim()) blocks.push({ type: "text", text: input.input.trim() });
  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "image") continue;
    const file = resolveAttachmentPath({ attachmentsDir: input.attachmentsDir, attachment });
    if (!file)
      return yield* EffectAcpErrors.AcpRequestError.invalidParams("Invalid image attachment.");
    const info = yield* fs
      .stat(file)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams("Could not read image attachment."),
        ),
      );
    if (info.type !== "File" || Number(info.size) > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        "Image attachment exceeds the supported size.",
      );
    const bytes = yield* fs
      .readFile(file)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.invalidParams("Could not read image attachment."),
        ),
      );
    blocks.push({
      type: "image",
      mimeType: attachment.mimeType,
      data: Buffer.from(bytes).toString("base64"),
    });
  }
  if (!blocks.length)
    return yield* EffectAcpErrors.AcpRequestError.invalidParams(
      "A turn requires text or an image.",
    );
  return blocks;
});
