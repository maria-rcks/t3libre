import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { DevinSettings } from "@t3tools/contracts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import {
  buildDevinModelsFromConfigOptions,
  buildDevinNativeCommands,
  buildInitialDevinProviderSnapshot,
  checkDevinProviderStatus,
} from "./Layers/DevinProvider.ts";
import { describe, expect, it } from "@effect/vitest";
import type { ModelCapabilities } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  isCommandMissingCause,
  providerModelsFromSettings,
  spawnAndCollect,
} from "./providerSnapshot.ts";

const decodeDevinSettings = Schema.decodeEffect(DevinSettings);

const OPENCODE_CUSTOM_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [{ id: "build", label: "Build", isDefault: true }],
      currentValue: "build",
    },
  ],
});

describe("providerModelsFromSettings", () => {
  it("applies the provided capabilities to custom models", () => {
    const models = providerModelsFromSettings(
      [],
      ["openai/gpt-5"],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "openai/gpt-5",
        name: "openai/gpt-5",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
    ]);
  });

  it("keeps an entry's own name and capabilities over the driver default", () => {
    const capabilities = createModelCapabilities({
      optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" }],
    });
    const models = providerModelsFromSettings(
      [],
      ["bare", { slug: "named", name: "Named", capabilities }],
      OPENCODE_CUSTOM_MODEL_CAPABILITIES,
    );

    expect(models).toEqual([
      {
        slug: "bare",
        name: "bare",
        isCustom: true,
        capabilities: OPENCODE_CUSTOM_MODEL_CAPABILITIES,
      },
      { slug: "named", name: "Named", isCustom: true, capabilities },
    ]);
  });

  it("preserves a custom slug that collides with a provider alias", () => {
    const capabilities = createModelCapabilities({ optionDescriptors: [] });
    const models = providerModelsFromSettings(
      [
        {
          slug: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          isCustom: false,
          capabilities,
        },
      ],
      [" opus "],
      capabilities,
    );

    expect(models.map((model) => model.slug)).toEqual(["claude-opus-4-8", "opus"]);
    expect(models[1]?.isCustom).toBe(true);
  });
});

describe("ProviderCommandNotFoundError", () => {
  it("classifies normalized platform failures without parsing messages", () => {
    expect(
      isCommandMissingCause(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description: "arbitrary host detail",
        }),
      ),
    ).toBe(true);
    expect(isCommandMissingCause(new Error("spawn provider ENOENT"))).toBe(false);
  });

  it.effect("retains safe failed-command diagnostics without process output", () => {
    const stderr = "'codex' is not recognized: secret-token-value";
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(9009)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.encodeText(Stream.make(stderr)),
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* spawnAndCollect(
        "C:\\tools\\codex.cmd",
        ChildProcess.make("codex", ["--version"]),
      ).pipe(
        Effect.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        Effect.provideService(HostProcessPlatform, "win32"),
        Effect.flip,
      );

      if (error._tag !== "ProviderCommandNotFoundError") {
        throw new Error(`Unexpected error: ${error._tag}`);
      }

      expect(error.binaryPath).toBe("C:\\tools\\codex.cmd");
      expect(error.exitCode).toBe(9009);
      expect(error.stdoutLength).toBe(0);
      expect(error.stderrLength).toBe(stderr.length);
      expect(error.message).toBe(
        "Provider command C:\\tools\\codex.cmd was not found (exit code 9009).",
      );
      expect(isCommandMissingCause(error)).toBe(true);
      expect(error).not.toHaveProperty("stdout");
      expect(error).not.toHaveProperty("stderr");
      expect(error.message).not.toContain("secret-token-value");
    });
  });
});

describe("Devin provider discovery", () => {
  it("preserves native command arguments and removes empty or duplicate commands", () => {
    expect(
      buildDevinNativeCommands([
        { name: " review ", description: " Review changes ", input: { hint: " instructions " } },
        { name: "review", description: "Duplicate" },
        { name: " ", description: "Empty" },
      ]),
    ).toEqual([{ name: "review", description: "Review changes", input: { hint: "instructions" } }]);
  });
  it("offers only ACP models and preserves grouped models and the active default", () => {
    const models = buildDevinModelsFromConfigOptions([
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "second",
        options: [
          {
            group: "first-group",
            name: "First group",
            options: [{ value: "first", name: "First" }],
          },
          { group: "other", name: "Other", options: [{ value: "second", name: "Second" }] },
        ],
      },
    ]);
    expect(
      models.map(({ slug, name, isDefault }) => ({ slug, name, isDefault: isDefault ?? false })),
    ).toEqual([
      { slug: "first", name: "First", isDefault: false },
      { slug: "second", name: "Second", isDefault: true },
    ]);
    expect(buildDevinModelsFromConfigOptions(undefined)).toEqual([]);
  });

  it.effect("does not advertise unverified custom models while discovery is pending", () =>
    Effect.gen(function* () {
      const settings = yield* decodeDevinSettings({ customModels: ["unavailable"] });
      const snapshot = yield* buildInitialDevinProviderSnapshot(settings);
      expect(snapshot.models).toEqual([]);
      expect(snapshot.auth.status).toBe("unknown");
    }),
  );

  for (const scenario of [
    { output: "Not logged in.", code: 1, auth: "unauthenticated", status: "error" },
    {
      output: "Could not reach server: secret-token-value",
      code: 1,
      auth: "unknown",
      status: "warning",
    },
    { output: "Logged in (via Devin).", code: 1, auth: "unknown", status: "warning" },
  ]) {
    it.effect(
      `reports ${scenario.auth} for auth output '${scenario.output}' with exit ${scenario.code}`,
      () =>
        Effect.gen(function* () {
          const filesystem = yield* FileSystem.FileSystem;
          const directory = yield* filesystem.makeTempDirectoryScoped({ prefix: "t3-devin-auth-" });
          const binaryPath = writeFakeCli({
            directory,
            name: "devin",
            source: [
              'if (process.argv.includes("--version")) { process.stdout.write("devin 3000.10.21\\n"); process.exit(0); }',
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              `process.stdout.write(${JSON.stringify(scenario.output)}); process.exit(${scenario.code});`,
            ].join("\n"),
          });
          const settings = yield* decodeDevinSettings({ enabled: true, binaryPath });
          const snapshot = yield* checkDevinProviderStatus(settings);
          expect(snapshot.auth.status).toBe(scenario.auth);
          expect(snapshot.status).toBe(scenario.status);
          expect(snapshot.models).toEqual([]);
          expect(snapshot.message).not.toContain("secret-token-value");
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  }
});
