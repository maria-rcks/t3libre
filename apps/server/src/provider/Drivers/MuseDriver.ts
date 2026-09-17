import { MuseSettings, ProviderDriverKind, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { ProviderDriverError } from "../Errors.ts";
import * as MuseAdapter from "../Layers/MuseAdapter.ts";
import {
  buildInitialMuseProviderSnapshot,
  checkMuseProviderStatus,
} from "../Layers/MuseProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
} from "../providerUpdateSettings.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { discoverMuseSkills } from "./MuseSkills.ts";

const DRIVER_KIND = ProviderDriverKind.make("muse");
const decodeSettings = Schema.decodeSync(MuseSettings);
const isProviderDriverError = Schema.is(ProviderDriverError);
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});
const unavailableTextGeneration = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail:
        "Muse Code does not yet support tool-free background text generation. Select another provider for generated titles and source control text.",
    }),
  );

export type MuseDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerConfig.ServerConfig
  | ServerSettings.ServerSettingsService;

export const MuseDriver: ProviderDriver<MuseSettings, MuseDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Muse Code", supportsMultipleInstances: true },
  configSchema: MuseSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const { cwd } = yield* ServerConfig.ServerConfig;
      const serverSettings = yield* ServerSettings.ServerSettingsService;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const effectiveConfig = { ...config, enabled };
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampInstance = withInstanceIdentity({
        instanceId,
        driverKind: DRIVER_KIND,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const stampIdentity = (snapshot: ServerProviderDraft) => ({
        ...stampInstance(snapshot),
        supportsTextGeneration: false,
      });
      const adapter = yield* MuseAdapter.make(effectiveConfig, {
        environment: processEnv,
        instanceId,
      });
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider({
        resolveMaintenance: () => Effect.succeed(MAINTENANCE),
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialMuseProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider: checkMuseProviderStatus(effectiveConfig, processEnv, cwd).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.map(stampIdentity),
        ),
      });
      const snapshotForCwd = (workspaceCwd: string) =>
        !effectiveConfig.enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              discoverMuseSkills(effectiveConfig, processEnv, workspaceCwd).pipe(
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.provideService(Path.Path, path),
                Effect.mapError(
                  (cause) =>
                    new ProviderDriverError({
                      driver: DRIVER_KIND,
                      instanceId,
                      detail: "Failed to discover Muse skills for this workspace.",
                      cause,
                    }),
                ),
              ),
            ]).pipe(Effect.map(([machineSnapshot, skills]) => ({ ...machineSnapshot, skills })));
      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        adapter,
        textGeneration: {
          generateCommitMessage: () => unavailableTextGeneration("generateCommitMessage"),
          generatePrContent: () => unavailableTextGeneration("generatePrContent"),
          generateBranchName: () => unavailableTextGeneration("generateBranchName"),
          generateThreadTitle: () => unavailableTextGeneration("generateThreadTitle"),
        },
      } satisfies ProviderInstance;
    }).pipe(
      Effect.mapError((cause) =>
        isProviderDriverError(cause)
          ? cause
          : new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: "Failed to initialize the Muse Code provider.",
              cause,
            }),
      ),
    ),
};
