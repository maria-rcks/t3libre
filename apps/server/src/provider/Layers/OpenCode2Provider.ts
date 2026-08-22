import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { createModelCapabilities } from "@t3tools/shared/model";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { OpenCode2Runtime, OpenCode2RuntimeError } from "../openCode2Runtime.ts";

export interface OpenCode2ProviderSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
}

const OPENCODE2_PRESENTATION = {
  displayName: "OpenCode 2",
  showInteractionModeToggle: false,
} as const;
const OPENCODE2_PROVIDER_PROBE_TIMEOUT = "15 seconds";

const OpenCode2HealthSchema = Schema.Struct({
  healthy: Schema.optionalKey(Schema.Boolean),
  version: Schema.optionalKey(Schema.String),
  pid: Schema.optionalKey(Schema.Number),
});

const OpenCode2VariantSchema = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]);

const OpenCode2ModelSchema = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  name: Schema.String,
  enabled: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(Schema.String),
  variants: Schema.optionalKey(
    Schema.Union([
      Schema.Array(OpenCode2VariantSchema),
      Schema.Record(Schema.String, Schema.Unknown),
    ]),
  ),
});

const OpenCode2ModelListSchema = Schema.Union([
  Schema.Array(OpenCode2ModelSchema),
  Schema.Struct({ data: Schema.Array(OpenCode2ModelSchema) }),
]);

const OpenCode2DefaultModelSchema = Schema.Union([
  Schema.NullOr(OpenCode2ModelSchema),
  Schema.Struct({ data: Schema.NullOr(OpenCode2ModelSchema) }),
]);

const OpenCode2AgentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mode: Schema.optionalKey(Schema.String),
  hidden: Schema.optionalKey(Schema.Boolean),
  description: Schema.optionalKey(Schema.String),
});

const OpenCode2AgentListSchema = Schema.Union([
  Schema.Array(OpenCode2AgentSchema),
  Schema.Struct({ data: Schema.Array(OpenCode2AgentSchema) }),
]);

type OpenCode2Model = typeof OpenCode2ModelSchema.Type;
type OpenCode2Agent = typeof OpenCode2AgentSchema.Type;

const DEFAULT_OPENCODE2_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

function responseList<A>(value: ReadonlyArray<A> | { readonly data: ReadonlyArray<A> }) {
  return "data" in value ? value.data : value;
}

function responseValue<A>(value: A | null | { readonly data: A | null }): A | null {
  return value !== null && typeof value === "object" && "data" in value ? value.data : value;
}

function titleCase(value: string): string {
  return value
    .split(/[-_/]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function variantIds(model: OpenCode2Model): ReadonlyArray<string> {
  if (!model.variants) return [];
  if (Array.isArray(model.variants)) {
    return model.variants.map((variant) => (typeof variant === "string" ? variant : variant.id));
  }
  return Object.keys(model.variants);
}

function modelCapabilities(
  model: OpenCode2Model,
  agents: ReadonlyArray<OpenCode2Agent>,
): ModelCapabilities {
  const variants = variantIds(model);
  const defaultVariant = variants.includes("default")
    ? "default"
    : variants.includes("medium")
      ? "medium"
      : variants.length === 1
        ? variants[0]
        : undefined;
  const visibleAgents = agents.filter(
    (agent) => agent.hidden !== true && agent.mode !== "subagent",
  );
  const defaultAgent =
    visibleAgents.find((agent) => agent.id === "build")?.id ?? visibleAgents[0]?.id;

  return createModelCapabilities({
    optionDescriptors: [
      ...(variants.length > 0
        ? [
            {
              id: "variant",
              label: "Variant",
              type: "select" as const,
              options: variants.map((variant) => ({
                id: variant,
                label: titleCase(variant),
                ...(variant === defaultVariant ? { isDefault: true as const } : {}),
              })),
              ...(defaultVariant ? { currentValue: defaultVariant } : {}),
            },
          ]
        : []),
      ...(visibleAgents.length > 0
        ? [
            {
              id: "agent",
              label: "Agent",
              type: "select" as const,
              options: visibleAgents.map((agent) => ({
                id: agent.id,
                label: nonEmptyTrimmed(agent.name) ?? titleCase(agent.id),
                ...(agent.id === defaultAgent ? { isDefault: true as const } : {}),
              })),
              ...(defaultAgent ? { currentValue: defaultAgent } : {}),
            },
          ]
        : []),
    ],
  });
}

function providerModels(input: {
  readonly models: ReadonlyArray<OpenCode2Model>;
  readonly defaultModel: OpenCode2Model | null;
  readonly agents: ReadonlyArray<OpenCode2Agent>;
}): ReadonlyArray<ServerProviderModel> {
  const defaultSlug = input.defaultModel
    ? `${input.defaultModel.providerID}/${input.defaultModel.id}`
    : null;
  return input.models
    .filter((model) => model.enabled !== false && model.status !== "deprecated")
    .map((model) => {
      const slug = `${model.providerID}/${model.id}`;
      return {
        slug,
        name: nonEmptyTrimmed(model.name) ?? model.id,
        subProvider: model.providerID,
        isCustom: false,
        ...(slug === defaultSlug ? { isDefault: true as const } : {}),
        capabilities: modelCapabilities(model, input.agents),
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function errorText(cause: unknown): string {
  if (cause instanceof OpenCode2RuntimeError) {
    return `${cause.detail} ${errorText(cause.cause)}`.trim();
  }
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : "";
}

function failureSnapshot(input: {
  readonly settings: OpenCode2ProviderSettings;
  readonly checkedAt: string;
  readonly cause: unknown;
  readonly version?: string | null;
}): ServerProviderDraft {
  const unsupported =
    input.cause instanceof OpenCode2RuntimeError && input.cause.kind === "unsupported-preview";
  const detail = errorText(input.cause);
  const missing =
    input.cause instanceof OpenCode2RuntimeError &&
    input.cause.kind === "command" &&
    (input.cause.operation === "command.resolve" || input.cause.operation === "command.spawn") &&
    /(?:enoent|not found|could not resolve|failed to execute)/iu.test(detail);
  return buildServerProvider({
    presentation: OPENCODE2_PRESENTATION,
    enabled: input.settings.enabled,
    checkedAt: input.checkedAt,
    models: providerModelsFromSettings(
      [],
      input.settings.customModels,
      DEFAULT_OPENCODE2_MODEL_CAPABILITIES,
    ),
    probe: {
      installed: !missing,
      version: input.version ?? null,
      status: "error",
      auth: { status: "unknown" },
      message: unsupported
        ? `This OpenCode 2 preview is not supported by T3 Code. ${input.cause.detail}`
        : missing
          ? "OpenCode 2 CLI (`opencode2`) is not installed or not on PATH."
          : detail || "Failed to connect to the OpenCode 2 background service.",
    },
  });
}

export const buildInitialOpenCode2ProviderSnapshot = (
  settings: OpenCode2ProviderSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation: OPENCODE2_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: providerModelsFromSettings(
        [],
        settings.customModels,
        DEFAULT_OPENCODE2_MODEL_CAPABILITIES,
      ),
      probe: settings.enabled
        ? {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "OpenCode 2 provider status has not been checked in this session yet.",
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "OpenCode 2 is disabled in T3 Code settings.",
          },
    });
  });

export const checkOpenCode2ProviderStatus = Effect.fn("checkOpenCode2ProviderStatus")(function* (
  settings: OpenCode2ProviderSettings,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, OpenCode2Runtime> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) return yield* buildInitialOpenCode2ProviderSnapshot(settings);

  const runtime = yield* OpenCode2Runtime;
  const attached = yield* Effect.exit(
    Effect.gen(function* () {
      const connection = yield* runtime.attach({
        binaryPath: settings.binaryPath || "opencode2",
        ...(environment ? { environment } : {}),
      });
      const [health, modelsResponse, defaultResponse, agentsResponse] = yield* Effect.all(
        [
          connection.request("GET", "/api/health", {
            operation: "health.get",
            schema: OpenCode2HealthSchema,
          }),
          connection.request("GET", "/api/model", {
            operation: "model.list",
            schema: OpenCode2ModelListSchema,
          }),
          connection.request("GET", "/api/model/default", {
            operation: "model.default",
            schema: OpenCode2DefaultModelSchema,
          }),
          connection.request("GET", "/api/agent", {
            operation: "agent.list",
            schema: OpenCode2AgentListSchema,
          }),
        ],
        { concurrency: "unbounded" },
      );
      return {
        health,
        models: responseList(modelsResponse),
        defaultModel: responseValue(defaultResponse),
        agents: responseList(agentsResponse),
      };
    }).pipe(Effect.timeoutOption(OPENCODE2_PROVIDER_PROBE_TIMEOUT)),
  );
  if (Exit.isFailure(attached)) {
    return failureSnapshot({
      settings,
      checkedAt,
      cause: Cause.squash(attached.cause),
    });
  }

  if (Option.isNone(attached.value)) {
    return failureSnapshot({
      settings,
      checkedAt,
      cause: new OpenCode2RuntimeError({
        operation: "provider.probe",
        kind: "connection",
        detail: "OpenCode 2 provider discovery timed out.",
      }),
    });
  }

  const value = attached.value.value;
  const discoveredModels = providerModels(value);
  const models = providerModelsFromSettings(
    discoveredModels,
    settings.customModels,
    DEFAULT_OPENCODE2_MODEL_CAPABILITIES,
  );
  const providerCount = new Set(
    discoveredModels.map((model) => model.subProvider).filter((provider) => provider !== undefined),
  ).size;
  const healthy = value.health.healthy !== false;
  return buildServerProvider({
    presentation: OPENCODE2_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: value.health.version ?? null,
      status: healthy && models.length > 0 ? "ready" : "warning",
      auth: { status: "authenticated", type: "opencode" },
      message: !healthy
        ? "The OpenCode 2 background service reported that it is unhealthy."
        : providerCount > 0
          ? `${providerCount} upstream provider${providerCount === 1 ? "" : "s"} available through the OpenCode 2 background service.`
          : models.length > 0
            ? "Connected to OpenCode 2 using the custom models configured in T3 Code."
            : "Connected to OpenCode 2, but it did not report any available models.",
    },
  });
});
