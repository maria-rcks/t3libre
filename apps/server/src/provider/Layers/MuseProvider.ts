import { spawnMspConnection } from "@muse-code/sdk";
import {
  MUSE_DEFAULT_MODEL,
  type MuseSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { readMuseUsageLimits } from "./museUsageLimits.ts";
import { encodeMuseModelSelection, MuseModelCatalog } from "../muse/MuseModels.ts";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot.ts";

const PRESENTATION = {
  displayName: "Muse Code",
  badgeLabel: "Developer Preview",
  supportsConversationRollback: false,
  showInteractionModeToggle: false,
  runtimeModeDescriptions: {
    "approval-required": "Ask before shell commands. Workspace file writes are allowed.",
    "auto-accept-edits": "Muse requests approval when needed. Workspace file writes are allowed.",
    auto: "Muse requests approval when needed. Workspace file writes are allowed.",
    "full-access": "Allow commands and file writes without prompts or sandbox restrictions.",
  },
} as const;
const CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const DEFAULT_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: MUSE_DEFAULT_MODEL,
    name: "Muse Code default",
    isDefault: true,
    isCustom: false,
    capabilities: CAPABILITIES,
  },
];

export const buildInitialMuseProviderSnapshot = Effect.fn("buildInitialMuseProviderSnapshot")(
  function* (settings: MuseSettings) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      models: providerModelsFromSettings(DEFAULT_MODELS, settings.customModels, CAPABILITIES),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Muse Code SDK availability..."
          : "Muse Code is disabled in T3 Code settings.",
      },
    });
  },
);

export const checkMuseProviderStatus = Effect.fn("checkMuseProviderStatus")(function* (
  settings: MuseSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) {
  if (!settings.enabled) return yield* buildInitialMuseProviderSnapshot(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const probe = Effect.gen(function* () {
    const handshake = yield* Effect.acquireRelease(
      Effect.try(() =>
        spawnMspConnection({
          command: settings.binaryPath || "muse",
          args: ["serve"],
          env: environment,
          cwd,
          shutdownTimeoutMs: 1_000,
        }),
      ),
      (host) => Effect.tryPromise(() => host.close()).pipe(Effect.ignore),
    );
    const host = yield* Effect.tryPromise(() =>
      handshake.initialize({
        clientInfo: { name: "t3_code", version: "0.0.0" },
      }),
    );
    const catalog = yield* Effect.tryPromise(() => host.connection.request("model/list", {})).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MuseModelCatalog)),
    );
    const usageLimits = yield* readMuseUsageLimits(host.connection);
    const models: ServerProviderModel[] =
      catalog.source === "fakeCatalog"
        ? []
        : catalog.models.map((model) => {
            const duplicate = catalog.models.some(
              (other) =>
                other.modelId === model.modelId &&
                (other.providerId !== model.providerId || other.profileId !== model.profileId),
            );
            return {
              slug: duplicate ? encodeMuseModelSelection(model) : model.modelId,
              name: `${model.displayLabel || model.modelId}${duplicate ? ` (${model.providerId}${model.profileId === null ? "" : ` / ${model.profileId}`})` : ""}`,
              isDefault: model.isDefault,
              isCustom: false,
              capabilities: CAPABILITIES,
            };
          });
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings(
        models.length > 0 ? models : DEFAULT_MODELS,
        settings.customModels,
        CAPABILITIES,
      ),
      probe: {
        installed: true,
        usageLimits,
        version: host.initializeResult.serverInfo.version,
        status: "ready",
        auth: { status: "unknown" },
        message: "Muse Code SDK is available. Authentication is checked when a turn runs.",
      },
    });
  }).pipe(Effect.timeout("10 seconds"), Effect.scoped);
  return yield* probe.pipe(
    Effect.catch((error) =>
      Effect.succeed(
        buildServerProvider({
          presentation: PRESENTATION,
          enabled: true,
          checkedAt,
          models: providerModelsFromSettings(DEFAULT_MODELS, settings.customModels, CAPABILITIES),
          probe: {
            installed: false,
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: `Could not connect to Muse Code. Install and sign in to a build supporting muse serve. ${String(error)}`,
          },
        }),
      ),
    ),
  );
});
