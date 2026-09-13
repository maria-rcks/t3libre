import * as NodeOS from "node:os";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(JsonObject));
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(JsonObject));
const decodeServers = Schema.decodeUnknownEffect(JsonObject);

/**
 * Devin 3000.10.21 accepts ACP MCP servers but resolves calls from on-disk config.
 * Keep this overlay scoped to the process; never write credentials into the workspace.
 * XDG_DATA_HOME stays unchanged so authentication and saved sessions remain available.
 * Shell tools inherit XDG_CONFIG_HOME too, so their unrelated XDG config lookup changes.
 */
export const prepareDevinMcpEnvironment = Effect.fn("prepareDevinMcpEnvironment")(
  function* (input: {
    readonly mcpServers: ReadonlyArray<EffectAcpSchema.McpServer>;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    if (input.mcpServers.length === 0) {
      return { environment: input.environment, args: ["acp"] };
    }
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = input.environment.HOME || NodeOS.homedir();
    const configRoot = input.environment.XDG_CONFIG_HOME || path.join(home, ".config");
    const originalDirectory = path.join(configRoot, "devin");
    const originalMcp = path.join(originalDirectory, "mcp_config.json");
    const originalConfig = path.join(originalDirectory, "config.json");
    const config: Record<string, unknown> = (yield* fs.exists(originalMcp))
      ? yield* fs.readFileString(originalMcp).pipe(Effect.flatMap(decodeConfig))
      : {};
    const servers = {
      ...(config.mcpServers === undefined ? {} : yield* decodeServers(config.mcpServers)),
    };
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-devin-mcp-" });
    const devinDirectory = path.join(directory, "devin");
    yield* fs.makeDirectory(devinDirectory, { mode: 0o700 });
    // Preserve Devin's other config resources without copying private files.
    if (yield* fs.exists(originalDirectory)) {
      for (const entry of yield* fs.readDirectory(originalDirectory)) {
        if (entry === "mcp_config.json" || entry === "config.json") continue;
        yield* fs.symlink(path.join(originalDirectory, entry), path.join(devinDirectory, entry));
      }
    }
    for (const server of input.mcpServers) {
      servers[server.name] =
        "url" in server
          ? {
              transport: server.type,
              url: server.url,
              headers: Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
            }
          : {
              transport: "stdio",
              command: server.command,
              args: server.args,
              env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
            };
    }
    yield* fs.writeFileString(
      path.join(devinDirectory, "mcp_config.json"),
      yield* encodeConfig({ ...config, mcpServers: servers }),
      { mode: 0o600 },
    );
    return {
      environment: { ...input.environment, XDG_CONFIG_HOME: directory },
      args: (yield* fs.exists(originalConfig)) ? ["--config", originalConfig, "acp"] : ["acp"],
    };
  },
  Effect.mapError(() =>
    EffectAcpErrors.AcpRequestError.invalidParams(
      "Could not prepare Devin's isolated MCP configuration.",
    ),
  ),
);
