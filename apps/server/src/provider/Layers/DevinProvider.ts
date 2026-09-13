import type {
  DevinSettings,
  ServerProviderModel,
  ServerProviderSlashCommand,
  ServerProvider,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type * as AcpSchema from "effect-acp/schema";

import type { ServerProviderShape } from "../Services/ServerProvider.ts";
import { makeDevinAcpRuntime } from "../acp/DevinAcpSupport.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  spawnAndCollect,
} from "../providerSnapshot.ts";

const PRESENTATION = {
  displayName: "Devin",
  supportsConversationRollback: false,
  showInteractionModeToggle: true,
} as const;
const CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });

export function buildDevinModelsFromConfigOptions(
  configOptions: ReadonlyArray<AcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  const modelOption = configOptions?.find(
    (option) => option.category === "model" || option.id === "model",
  );
  if (!modelOption || modelOption.type !== "select") return [];
  return modelOption.options
    .flatMap((entry) => ("value" in entry ? [entry] : entry.options))
    .map((option) => ({
      slug: option.value,
      name: option.name,
      isCustom: false,
      ...(option.value === modelOption.currentValue ? { isDefault: true } : {}),
      capabilities: CAPABILITIES,
    }));
}

export function buildDevinNativeCommands(
  commands: ReadonlyArray<AcpSchema.AvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const seen = new Set<string>();
  return commands.flatMap((command): ServerProviderSlashCommand[] => {
    const name = command.name.trim();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const description = command.description.trim();
    const hint = command.input?.hint.trim();
    return [
      { name, ...(description ? { description } : {}), ...(hint ? { input: { hint } } : {}) },
    ];
  });
}

export const makeDevinRuntimeMetadata = Effect.fn("makeDevinRuntimeMetadata")(function* (
  base: ServerProviderShape,
) {
  const metadata = yield* SubscriptionRef.make<{
    models?: ReadonlyArray<ServerProviderModel>;
    workspaceSnapshots: NonNullable<ServerProvider["workspaceSnapshots"]>;
  }>({ workspaceSnapshots: [] });
  const overlay = (snapshot: ServerProvider) =>
    SubscriptionRef.get(metadata).pipe(
      Effect.map((state) =>
        snapshot.enabled && snapshot.auth.status === "authenticated"
          ? {
              ...snapshot,
              ...(state.models ? { models: state.models } : {}),
              workspaceSnapshots: state.workspaceSnapshots,
            }
          : snapshot,
      ),
    );
  const getSnapshot = base.getSnapshot.pipe(Effect.flatMap(overlay));
  const onConfigOptionsUpdated = (configOptions: ReadonlyArray<AcpSchema.SessionConfigOption>) => {
    const models = buildDevinModelsFromConfigOptions(configOptions);
    return configOptions.some((option) => option.category === "model" || option.id === "model")
      ? SubscriptionRef.update(metadata, (state) => ({ ...state, models }))
      : Effect.void;
  };
  const onAvailableCommands = Effect.fn("DevinProvider.onAvailableCommands")(function* (
    commands: ReadonlyArray<AcpSchema.AvailableCommand>,
    cwd: string,
  ) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const slashCommands = buildDevinNativeCommands(commands);
    yield* SubscriptionRef.update(metadata, (state) => ({
      ...state,
      workspaceSnapshots: [
        ...state.workspaceSnapshots.filter((entry) => entry.cwd !== cwd),
        { cwd, checkedAt, slashCommands, skills: [] },
      ].slice(-32),
    }));
  });
  return {
    snapshot: {
      ...base,
      getSnapshot,
      refresh: SubscriptionRef.set(metadata, { workspaceSnapshots: [] }).pipe(
        Effect.andThen(base.refresh),
        Effect.flatMap(overlay),
      ),
      streamChanges: Stream.merge(
        base.streamChanges.pipe(Stream.mapEffect(overlay)),
        SubscriptionRef.changes(metadata).pipe(Stream.mapEffect(() => getSnapshot)),
      ),
    } satisfies ServerProviderShape,
    snapshotForCwd: (cwd: string) =>
      getSnapshot.pipe(
        Effect.map((snapshot) => {
          const workspace = snapshot.workspaceSnapshots?.find((entry) => entry.cwd === cwd);
          return workspace ? { ...snapshot, slashCommands: workspace.slashCommands } : snapshot;
        }),
      ),
    onAvailableCommands,
    onConfigOptionsUpdated,
  };
});

export const buildInitialDevinProviderSnapshot = Effect.fn("buildInitialDevinProviderSnapshot")(
  function* (settings: DevinSettings) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      models: [],
      probe: {
        installed: settings.enabled,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Devin CLI availability..."
          : "Devin is disabled in T3 Code settings.",
      },
    });
  },
);

const runDevin = Effect.fn("runDevin")(function* (
  settings: DevinSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) {
  const binary = settings.binaryPath || "devin";
  const spawn = yield* resolveSpawnCommand(binary, args, { env: environment });
  return yield* spawnAndCollect(
    binary,
    ChildProcess.make(spawn.command, spawn.args, { env: environment, shell: spawn.shell }),
  );
});

// The account-wide `models list` catalog can include models unavailable over ACP.
// Probe a disposable session so the picker only offers models this transport accepts.
const discoverDevinModels = Effect.fn("discoverDevinModels")(function* (
  settings: DevinSettings,
  environment: NodeJS.ProcessEnv,
) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-models-" });
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runtime = yield* makeDevinAcpRuntime({
    devinSettings: settings,
    environment,
    childProcessSpawner,
    cwd,
    clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
  });
  const commands = yield* Ref.make<ReadonlyArray<ServerProviderSlashCommand>>([]);
  yield* runtime.handleSessionUpdate((notification) =>
    notification.update.sessionUpdate === "available_commands_update"
      ? Ref.set(commands, buildDevinNativeCommands(notification.update.availableCommands))
      : Effect.void,
  );
  const started = yield* runtime.start();
  yield* Effect.addFinalizer(() =>
    runtime
      .request("session/delete", { sessionId: started.sessionId })
      .pipe(Effect.timeoutOption(4_000), Effect.ignore),
  );
  return {
    models: buildDevinModelsFromConfigOptions(started.sessionSetupResult.configOptions),
    slashCommands: yield* Ref.get(commands),
  };
});

export const checkDevinProviderStatus = Effect.fn("checkDevinProviderStatus")(function* (
  settings: DevinSettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const initial = yield* buildInitialDevinProviderSnapshot(settings);
  if (!settings.enabled) return initial;
  const versionResult = yield* runDevin(settings, ["--version"], environment).pipe(
    Effect.timeoutOption(4_000),
    Effect.result,
  );
  if (Result.isFailure(versionResult) || Option.isNone(versionResult.success)) {
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    return {
      ...initial,
      installed: !missing,
      status: "error" as const,
      message: missing
        ? "Devin CLI (`devin`) is not installed or not on PATH."
        : "Devin CLI availability check failed or timed out.",
    };
  }
  const output = versionResult.success.value;
  const version = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);
  if (output.code !== 0)
    return {
      ...initial,
      version,
      status: "error" as const,
      message: "Devin CLI is installed but failed to run.",
    };
  const authResult = yield* runDevin(settings, ["auth", "status"], environment).pipe(
    Effect.timeoutOption(12_000),
    Effect.result,
  );
  const authOutput =
    Result.isSuccess(authResult) && Option.isSome(authResult.success)
      ? authResult.success.value
      : undefined;
  const authText = authOutput ? `${authOutput.stdout}\n${authOutput.stderr}` : "";
  const authenticated = authOutput?.code === 0 && /^Logged in\b/im.test(authText);
  const unauthenticated = /^(?:not (?:logged in|authenticated)|logged out|no credentials)\b/im.test(
    authText,
  );
  if (!authenticated)
    return {
      ...initial,
      version,
      status: unauthenticated ? ("error" as const) : ("warning" as const),
      auth: { status: unauthenticated ? ("unauthenticated" as const) : ("unknown" as const) },
      message: unauthenticated
        ? "Devin CLI is not logged in. Run `devin auth login`."
        : "Unable to verify Devin CLI authentication.",
    };
  const modelsResult = yield* discoverDevinModels(settings, environment).pipe(
    Effect.scoped,
    Effect.timeoutOption(20_000),
    Effect.result,
  );
  const discovered =
    Result.isSuccess(modelsResult) && Option.isSome(modelsResult.success)
      ? modelsResult.success.value
      : { models: [], slashCommands: [] };
  const { models, slashCommands } = discovered;
  return buildServerProvider({
    presentation: PRESENTATION,
    enabled: true,
    checkedAt: initial.checkedAt,
    models,
    slashCommands,
    probe: {
      installed: true,
      version,
      status: models.length ? "ready" : "warning",
      auth: { status: "authenticated", type: "cached_token", label: "Devin account" },
      ...(models.length ? {} : { message: "Devin is logged in, but ACP model discovery failed." }),
    },
  });
});
