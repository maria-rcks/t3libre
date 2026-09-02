import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";

import * as ServerRuntimeState from "./serverRuntimeState.ts";

const isServerRuntimeStateError = Schema.is(ServerRuntimeState.ServerRuntimeStateError);

interface CapturedLog {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

describe("serverRuntimeState", () => {
  it.effect("persists and reads the runtime state", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "runtime", "server.json");
      const state: ServerRuntimeState.PersistedServerRuntimeState = {
        version: 1,
        pid: 123,
        host: "127.0.0.1",
        port: 4_971,
        origin: "http://127.0.0.1:4971",
        devUrl: "http://localhost:5733/",
        pairingBaseUrl: "https://environment.tunnels.example.com/",
        startedAt: "2026-06-20T00:00:00.000Z",
      };

      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state });
      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.deepEqual(Option.getOrThrow(restored), state);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("records the dev web URL when the server fronts a dev server", () =>
    Effect.gen(function* () {
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: new URL("http://localhost:5733") },
        port: 13_773,
        pairingBaseUrl: "https://environment.tunnels.example.com/",
      });

      assert.equal(state.devUrl, "http://localhost:5733/");
      assert.equal(state.origin, "http://127.0.0.1:13773");
      assert.equal(state.pairingBaseUrl, "https://environment.tunnels.example.com/");

      const withoutDev = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
      });
      assert.isFalse("devUrl" in withoutDev);
    }),
  );

  it.effect("treats a missing runtime state file as absent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(
        path.join(root, "missing.json"),
      );

      assert.isTrue(Option.isNone(restored));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("only clears runtime state owned by the expected process", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-owner-test-",
      });
      const statePath = path.join(root, "server.json");
      const state: ServerRuntimeState.PersistedServerRuntimeState = {
        version: 1,
        pid: 456,
        port: 4_971,
        origin: "http://127.0.0.1:4971",
        startedAt: "2026-06-20T00:00:00.000Z",
      };
      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state });

      yield* ServerRuntimeState.clearOwnedPersistedServerRuntimeState(statePath, 123);
      assert.isTrue(
        Option.isSome(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
      );

      yield* ServerRuntimeState.clearOwnedPersistedServerRuntimeState(statePath, 456);
      assert.isTrue(
        Option.isNone(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
      );

      const replacementState = { ...state, pid: 789 };
      yield* Effect.forEach(Array.from({ length: 25 }), () =>
        Effect.gen(function* () {
          yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state });
          yield* Effect.all(
            [
              ServerRuntimeState.clearOwnedPersistedServerRuntimeState(statePath, state.pid),
              ServerRuntimeState.persistServerRuntimeState({
                path: statePath,
                state: replacementState,
              }),
            ],
            { concurrency: "unbounded" },
          );
          assert.deepEqual(
            Option.getOrThrow(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
            replacementState,
          );
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("only clears the exact pairing origin owned by the expected process", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-pairing-owner-test-",
      });
      const statePath = path.join(root, "server.json");
      const ownedPairingBaseUrl = "https://owned.tunnels.example.com/";
      const ownedState: ServerRuntimeState.PersistedServerRuntimeState = {
        version: 1,
        pid: 456,
        port: 4_971,
        origin: "http://127.0.0.1:4971",
        devUrl: "http://localhost:5733/__t3-connect-dev-share/owned/",
        pairingBaseUrl: ownedPairingBaseUrl,
        startedAt: "2026-06-20T00:00:00.000Z",
      };
      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state: ownedState });

      yield* ServerRuntimeState.clearOwnedPairingBaseUrl({
        path: statePath,
        pid: 456,
        pairingBaseUrl: "https://replacement.tunnels.example.com/",
      });
      assert.deepEqual(
        Option.getOrThrow(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
        ownedState,
      );

      const replacementState = {
        ...ownedState,
        pid: 789,
        pairingBaseUrl: "https://replacement.tunnels.example.com/",
      };
      yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        state: replacementState,
      });
      yield* ServerRuntimeState.clearOwnedPairingBaseUrl({
        path: statePath,
        pid: 456,
        pairingBaseUrl: ownedPairingBaseUrl,
      });
      assert.deepEqual(
        Option.getOrThrow(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
        replacementState,
      );

      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state: ownedState });
      yield* ServerRuntimeState.clearOwnedPairingBaseUrl({
        path: statePath,
        pid: 456,
        pairingBaseUrl: ownedPairingBaseUrl,
      });
      const cleared = Option.getOrThrow(
        yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath),
      );
      assert.isFalse("pairingBaseUrl" in cleared);
      assert.deepInclude(cleared, {
        pid: ownedState.pid,
        origin: ownedState.origin,
        devUrl: ownedState.devUrl,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("restores the runtime advertisement when an owned mutation fails", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-mutation-failure-test-",
      });
      const statePath = path.join(root, "server.json");
      const state: ServerRuntimeState.PersistedServerRuntimeState = {
        version: 1,
        pid: 456,
        port: 4_971,
        origin: "http://127.0.0.1:4971",
        pairingBaseUrl: "https://owned.tunnels.example.com/",
        startedAt: "2026-06-20T00:00:00.000Z",
      };
      yield* ServerRuntimeState.persistServerRuntimeState({ path: statePath, state });
      const failingFileSystem = FileSystem.FileSystem.of({
        ...fileSystem,
        readFileString: (filePath, encoding) =>
          filePath.includes("server.json.mutate.")
            ? Effect.die(new Error("injected snapshot read failure"))
            : fileSystem.readFileString(filePath, encoding),
      });

      const result = yield* ServerRuntimeState.clearOwnedPairingBaseUrl({
        path: statePath,
        pid: state.pid,
        pairingBaseUrl: "https://owned.tunnels.example.com/",
      }).pipe(Effect.provideService(FileSystem.FileSystem, failingFileSystem), Effect.exit);

      assert.isTrue(Exit.isFailure(result));
      assert.deepEqual(
        Option.getOrThrow(yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath)),
        state,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("preserves malformed state decode failures", () => {
    const logs: CapturedLog[] = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push({
        message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    });

    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "server.json");
      yield* fileSystem.writeFileString(statePath, "{not json");

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.isTrue(Option.isNone(restored));
      assert.equal(logs[0]?.message, `Failed to decode server runtime state at ${statePath}.`);
      const error = logs[0]?.annotations.cause;
      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "decode");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to decode server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "SchemaError" });
      }
    }).pipe(
      Effect.provide(
        Layer.merge(NodeServices.layer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("preserves runtime state read failures", () => {
    const logs: CapturedLog[] = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push({
        message,
        annotations: fiber.getRef(References.CurrentLogAnnotations),
      });
    });

    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const statePath = path.join(root, "server.json");
      yield* fileSystem.makeDirectory(statePath);

      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);

      assert.isTrue(Option.isNone(restored));
      assert.equal(logs[0]?.message, `Failed to read server runtime state at ${statePath}.`);
      const error = logs[0]?.annotations.cause;
      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "read");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to read server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "PlatformError" });
      }
    }).pipe(
      Effect.provide(
        Layer.merge(NodeServices.layer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("preserves runtime state persistence failures", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-runtime-state-test-",
      });
      const blockedDirectory = path.join(root, "not-a-directory");
      const statePath = path.join(blockedDirectory, "server.json");
      yield* fileSystem.writeFileString(blockedDirectory, "blocked");

      const error = yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        state: {
          version: 1,
          pid: 123,
          port: 4_971,
          origin: "http://127.0.0.1:4971",
          startedAt: "2026-06-20T00:00:00.000Z",
        },
      }).pipe(Effect.flip);

      assert.isTrue(isServerRuntimeStateError(error));
      if (isServerRuntimeStateError(error)) {
        assert.equal(error.operation, "persist");
        assert.equal(error.statePath, statePath);
        assert.equal(error.message, `Failed to persist server runtime state at ${statePath}.`);
        assert.deepInclude(error.cause, { _tag: "PlatformError" });
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
