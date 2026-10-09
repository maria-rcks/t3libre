// @effect-diagnostics nodeBuiltinImport:off - Ownership tests exercise real OS locks and a task-owned child process.
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodeAssert from "node:assert/strict";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as BootService from "./cloud/bootService.ts";
import { runServicePreflight } from "./cloud/servicePreflight.ts";
import {
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
} from "./cloud/serviceProtocol.ts";
import * as ServerRuntimeState from "./serverRuntimeState.ts";
import * as ServerOwnership from "./serverOwnership.ts";
import * as ProcessRunner from "./processRunner.ts";
import { acquireServerOwnershipLock } from "./serverOwnershipLock.ts";
import { writeServiceState } from "./serviceLauncher.ts";

const isServerRuntimeStateError = Schema.is(ServerRuntimeState.ServerRuntimeStateError);

/** Starts on a T3 home with a boot service unit installed, behind fake service-manager probes. */
const startBesideBootService = Effect.fn("test.start_beside_boot_service")(function* (input: {
  readonly platform: "darwin" | "linux";
  readonly outputs: Readonly<Record<string, { readonly code: number; readonly stdout?: string }>>;
  readonly unitServesOtherHome?: boolean;
  readonly restartPending?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
  readonly serviceSetup?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-boot-service-owner-" });
  const t3Home = path.join(root, ".t3");
  const serviceHome = input.unitServesOtherHome ? path.join(root, "other") : t3Home;
  yield* fs.makeDirectory(path.join(serviceHome, "userdata"), { recursive: true });
  yield* fs.makeDirectory(path.join(t3Home, "userdata"), { recursive: true });
  yield* Effect.promise(() =>
    writeServiceState(path.join(serviceHome, "runtime", "service-state.json"), {
      protocol: 3,
      activeVersion: "0.0.42",
    }),
  );
  if (input.restartPending) {
    yield* fs.writeFileString(path.join(serviceHome, "runtime", ".restart-pending"), "0.0.46\n");
  }
  const plan = { program: [], baseDir: serviceHome, logPath: "", unitPath: "" };
  const [unitPath, unit] =
    input.platform === "darwin"
      ? [
          path.join(root, "Library", "LaunchAgents", "com.t3tools.t3code.service.plist"),
          BootService.renderBootServicePlist(plan, { homeDir: root, environmentPath: "" }),
        ]
      : [
          path.join(root, ".config", "systemd", "user", "t3code.service"),
          BootService.renderBootServiceUnit(plan),
        ];
  yield* fs.makeDirectory(path.dirname(unitPath), { recursive: true });
  yield* fs.writeFileString(unitPath, unit);

  const probes: string[] = [];
  const invocations: ReadonlyArray<string>[] = [];
  const runner = ProcessRunner.ProcessRunner.of({
    run: (run) => {
      const probe = `${path.basename(run.command)} ${run.args.find((arg) => !arg.startsWith("--"))}`;
      probes.push(probe);
      invocations.push([run.command, ...run.args]);
      const output = input.outputs[probe];
      return output === undefined
        ? Effect.fail(
            new ProcessRunner.ProcessTimeoutError({
              command: run.command,
              argumentCount: run.args.length,
              timeoutMs: 5_000,
            }),
          )
        : Effect.succeed({
            stdout: output.stdout ?? "",
            stderr: "",
            code: ChildProcessSpawner.ExitCode(output.code),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          });
    },
  });
  const statePath = path.join(t3Home, "userdata", "server-runtime.json");
  const result = yield* (
    input.serviceSetup
      ? ServerOwnership.requireServerStopped(statePath)
      : Effect.scoped(ServerOwnership.acquireServerOwnership(statePath)).pipe(Effect.asVoid)
  ).pipe(
    Effect.provideService(ProcessRunner.ProcessRunner, runner),
    Effect.provideService(HostProcessPlatform, input.platform),
    Effect.provideService(HostProcessUserId, 501),
    Effect.provideService(HostProcessEnvironment, { HOME: root, ...input.environment }),
    Effect.result,
  );
  return {
    outcome: result._tag === "Success" ? "started" : result.failure._tag,
    probes,
    invocations,
    t3Home,
    stateDir: yield* fs.realPath(path.join(t3Home, "userdata")),
  };
});

const preflightOutput = (result: object) => ({ code: 0, stdout: `${JSON.stringify(result)}\n` });
// Releases before the ownership lock: 0.0.32 through 0.0.42 speak launcher
// protocol 2 and so answer "blocked"; 0.0.43 through 0.0.45 answer "ready".
const preLockPreflight = preflightOutput({
  status: "blocked",
  version: "0.0.42",
  reason:
    "This release requires a newer T3 Code service launcher. Update it on the server machine.",
});

interface CapturedLog {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
}

describe("serverRuntimeState", () => {
  it.effect(
    "blocks database startup and auth commands while interrupted restore state is pending",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-interrupted-restore-" });
        const stateDir = path.join(root, "userdata");
        yield* fs.makeDirectory(path.join(root, "runtime", "db-backup", "update-1"), {
          recursive: true,
        });
        yield* Effect.promise(() =>
          writeServiceState(path.join(root, "runtime", "service-state.json"), {
            protocol: 3,
            activeVersion: "1.0.0",
            update: {
              id: "update-1",
              fromVersion: "1.0.0",
              targetVersion: "1.1.0",
              status: "pending",
              dbPath: path.join(stateDir, "state.sqlite"),
            },
          }),
        );
        const stateFile = path.join(root, "runtime", "service-state.json");
        const stateContents = yield* fs.readFileString(stateFile);
        for (const protocol of [1, 2, 3, 4]) {
          yield* fs.writeFileString(
            stateFile,
            stateContents.replace(/"protocol":\s*3/, `"protocol":${protocol}`),
          );
          const error = yield* Effect.scoped(
            ServerOwnership.acquireServerOwnership(path.join(stateDir, "server-runtime.json")),
          ).pipe(Effect.flip);
          assert.equal(error._tag, "ServerUpdateRecoveryRequiredError");
          yield* Effect.tryPromise(() => acquireServerOwnershipLock(stateDir, { cli: true })).pipe(
            Effect.flip,
          );
        }
        const aliasHome = path.join(root, "alias-home");
        yield* fs.makeDirectory(aliasHome);
        yield* Effect.sync(() =>
          NodeFS.symlinkSync(stateDir, path.join(aliasHome, "userdata"), "junction"),
        );
        const aliasError = yield* Effect.scoped(
          ServerOwnership.acquireServerOwnership(
            path.join(aliasHome, "userdata", "server-runtime.json"),
          ),
        ).pipe(Effect.flip);
        assert.equal(aliasError._tag, "ServerUpdateRecoveryRequiredError");
        yield* Effect.tryPromise(() => acquireServerOwnershipLock(stateDir, { cli: true })).pipe(
          Effect.flip,
        );
        const markerLock = yield* Effect.promise(() => acquireServerOwnershipLock(stateDir));
        markerLock.markUpdatePending("update-1");
        markerLock.close();
        // Model a launcher whose runtime lives outside the canonical home's parent.
        yield* fs.rename(path.join(root, "runtime"), path.join(root, "other-runtime"));
        const markerError = yield* Effect.scoped(
          ServerOwnership.acquireServerOwnership(
            path.join(aliasHome, "userdata", "server-runtime.json"),
          ),
        ).pipe(Effect.flip);
        assert.equal(markerError._tag, "ServerUpdateRecoveryRequiredError");
        yield* Effect.tryPromise(() =>
          acquireServerOwnershipLock(path.join(aliasHome, "userdata"), { cli: true }),
        ).pipe(Effect.flip);
        const lock = yield* Effect.acquireRelease(
          Effect.promise(() => acquireServerOwnershipLock(stateDir)),
          (value) => Effect.sync(() => value.close()),
        );
        assert.isNull(lock.readOwnerId());
      }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );
  it.effect("refuses a trial after an intervening owner stopped and cleared discovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-trial-continuity-" });
      const statePath = path.join(root, "server-runtime.json");
      const previous = yield* Effect.promise(() => acquireServerOwnershipLock(root));
      previous.claim("snapshot-owner");
      previous.close();
      yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath));
      assert.isFalse(yield* fs.exists(statePath));
      const error = yield* Effect.scoped(
        ServerOwnership.acquireServerOwnership(statePath, {
          previousOwnerId: "snapshot-owner",
          ownerId: "trial-owner",
        }),
      ).pipe(Effect.flip);
      assert.equal(error._tag, "ServerAlreadyRunningError");
      const lock = yield* Effect.acquireRelease(
        Effect.promise(() => acquireServerOwnershipLock(root)),
        (value) => Effect.sync(() => value.close()),
      );
      assert.notEqual(lock.readOwnerId(), "trial-owner");
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("claims trial ownership only when it matches the snapshot owner", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-trial-continuity-" });
      const statePath = path.join(root, "server-runtime.json");
      yield* Effect.scoped(
        ServerOwnership.acquireServerOwnership(statePath, {
          previousOwnerId: null,
          ownerId: "trial-owner",
        }),
      );
      const lock = yield* Effect.acquireRelease(
        Effect.promise(() => acquireServerOwnershipLock(root)),
        (value) => Effect.sync(() => value.close()),
      );
      assert.equal(lock.readOwnerId(), "trial-owner");
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );
  it("releases the OS ownership lock after its task-owned process crashes", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-owner-crash-"));
    const moduleUrl = new URL("./serverOwnershipLock.ts", import.meta.url).href;
    const encodedModuleUrl = JSON.stringify(moduleUrl);
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        `const { acquireServerOwnershipLock } = await import(${encodedModuleUrl});
const ownership = await acquireServerOwnershipLock(process.argv[1]);
process.on('disconnect', () => ownership.close());
process.send('owned');`,
        root,
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    const exited = new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve());
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Owner exited before claiming the directory.")));
      });
      await NodeAssert.rejects(
        () => acquireServerOwnershipLock(root),
        (cause: unknown) =>
          cause instanceof Error &&
          (("errcode" in cause && cause.errcode === 5) ||
            ("code" in cause && cause.code === "SQLITE_BUSY")),
      );
      child.kill("SIGKILL");
      await exited;
      const replacement = await acquireServerOwnershipLock(root);
      replacement.close();
    } finally {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it.effect("only one racing start can acquire a shared state directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-race-" });
      const statePath = path.join(root, "server-runtime.json");
      const attempts = yield* Effect.all(
        [
          ServerOwnership.acquireServerOwnership(statePath).pipe(Effect.result),
          ServerOwnership.acquireServerOwnership(statePath).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(attempts.filter((result) => result._tag === "Success").length, 1);
      const refused = attempts.find((result) => result._tag === "Failure");
      assert.equal(refused?.failure._tag, "ServerAlreadyRunningError");
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect(
    "refuses a second owner, preserves its runtime record, and permits a clean restart",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-" });
        const statePath = path.join(root, "server-runtime.json");
        const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
          config: { host: undefined, devUrl: undefined },
          port: 3773,
        });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const owner = yield* ServerOwnership.acquireServerOwnership(statePath);
            yield* owner.publish(state);
            const before = yield* fs.readFileString(statePath);
            const refused = yield* ServerOwnership.acquireServerOwnership(statePath).pipe(
              Effect.flip,
            );
            assert.equal(refused._tag, "ServerAlreadyRunningError");
            assert.equal(yield* fs.readFileString(statePath), before);
          }),
        );
        assert.isFalse(yield* fs.exists(statePath));
        yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath));
      }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect(
    "resolves symlink aliases to the same owner and permits a separate state directory",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-alias-" });
        const directory = path.join(root, "state");
        const alias = path.join(root, "alias");
        yield* fs.makeDirectory(directory);
        yield* Effect.sync(() => NodeFS.symlinkSync(directory, alias, "junction"));
        yield* ServerOwnership.acquireServerOwnership(path.join(directory, "server-runtime.json"));
        const refused = yield* ServerOwnership.acquireServerOwnership(
          path.join(alias, "server-runtime.json"),
        ).pipe(Effect.flip);
        assert.equal(refused._tag, "ServerAlreadyRunningError");
        yield* ServerOwnership.acquireServerOwnership(
          path.join(root, "other", "server-runtime.json"),
        );
      }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("fails closed beside a live legacy owner and allows a stale legacy record", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-legacy-" });
      const statePath = path.join(root, "server-runtime.json");
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 3773,
      });
      yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        // @effect-diagnostics-next-line globalDateInEffect:off - Legacy identity uses the real process start time, not TestClock.
        state: { ...state, startedAt: new Date().toISOString() },
      });
      const refused = yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath)).pipe(
        Effect.flip,
      );
      assert.equal(refused._tag, "ServerAlreadyRunningError");
      yield* ServerRuntimeState.persistServerRuntimeState({
        path: statePath,
        state: { ...state, pid: 0 },
      });
      yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath));
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("refuses a malformed owner record without losing the ownership lock on recovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-malformed-" });
      const statePath = path.join(root, "server-runtime.json");
      yield* fs.writeFileString(statePath, "{incomplete");
      const failed = yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath)).pipe(
        Effect.flip,
      );
      assert.equal(failed._tag, "ServerOwnershipError");
      assert.equal(yield* fs.readFileString(statePath), "{incomplete");
      yield* fs.remove(statePath);
      yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath));
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("an old owner's shutdown never removes a runtime record it did not publish", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-cleanup-" });
      const statePath = path.join(root, "server-runtime.json");
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 3773,
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* ServerOwnership.acquireServerOwnership(statePath);
          yield* owner.publish(state);
          yield* ServerRuntimeState.persistServerRuntimeState({
            path: statePath,
            state: { ...state, ownerId: "other-owner" },
          });
        }),
      );
      const restored = yield* ServerRuntimeState.readPersistedServerRuntimeState(statePath);
      assert.equal(Option.getOrThrow(restored).ownerId, "other-owner");
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("a released owner cannot publish state after a successor starts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-released-" });
      const statePath = path.join(root, "server-runtime.json");
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 3773,
      });
      const released = yield* Effect.scoped(ServerOwnership.acquireServerOwnership(statePath));
      const successor = yield* ServerOwnership.acquireServerOwnership(statePath);
      yield* successor.publish({ ...state, port: 3774, origin: "http://127.0.0.1:3774" });
      const before = yield* fs.readFileString(statePath);
      const refused = yield* released.publish(state).pipe(Effect.flip);
      assert.equal(refused._tag, "ServerOwnershipReleasedError");
      assert.equal(yield* fs.readFileString(statePath), before);
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  it.effect("a discovery publication failure does not release a live ownership lock", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-owner-publish-failure-" });
      const statePath = path.join(root, "server-runtime.json");
      const owner = yield* ServerOwnership.acquireServerOwnership(statePath);
      const state = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 3773,
      });
      yield* fs.makeDirectory(statePath);
      const failed = yield* owner.publish(state).pipe(Effect.flip);
      assert.equal(failed._tag, "ServerOwnershipError");
      const refused = yield* ServerOwnership.acquireServerOwnership(statePath).pipe(Effect.flip);
      assert.equal(refused._tag, "ServerAlreadyRunningError");
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

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
      });

      assert.equal(state.devUrl, "http://localhost:5733/");
      assert.equal(state.origin, "http://127.0.0.1:13773");

      const withoutDev = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
      });
      assert.isFalse("devUrl" in withoutDev);
    }),
  );

  it.effect("marks a service-supervised server so CLIs can tell it from a manual one", () =>
    Effect.gen(function* () {
      const managed = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
        serviceManaged: true,
      });
      const manual = yield* ServerRuntimeState.makePersistedServerRuntimeState({
        config: { host: undefined, devUrl: undefined },
        port: 13_773,
      });

      assert.isTrue(managed.serviceManaged);
      // Older readers decode the file without the field, so it is omitted
      // rather than written as false.
      assert.isFalse("serviceManaged" in manual);
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

  describe("beside an installed boot service", () => {
    it.effect("refuses while a loaded service runs an older release", () =>
      Effect.gen(function* () {
        for (const [release, preflight] of [
          ["0.0.42, launcher protocol 2", preLockPreflight],
          [
            "0.0.45, launcher protocol 3",
            preflightOutput({ status: "ready", version: "0.0.45", launcherProtocol: 3 }),
          ],
        ] as const) {
          const started = yield* startBesideBootService({
            platform: "darwin",
            outputs: { "launchctl print": { code: 0 }, "t3 __service-preflight": preflight },
          });
          assert.equal(started.outcome, "LegacyBootServiceError", release);
          assert.deepEqual(started.invocations, [
            ["launchctl", "print", "gui/501/com.t3tools.t3code.service"],
            [
              NodePath.join(started.t3Home, "runtime", "versions", "0.0.42", "t3"),
              "__service-preflight",
              "--database-path",
              NodePath.join(started.stateDir, "statev2.sqlite"),
              "--launcher-protocol",
              String(SERVICE_LAUNCHER_PROTOCOL),
            ],
          ]);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("refuses a stopped service only when it will start again at login", () =>
      Effect.gen(function* () {
        const printDisabled = (state: string) => ({
          code: 0,
          stdout: `disabled services = {\n\t"com.apple.example" => enabled\n\t"com.t3tools.t3code.service" => ${state}\n}\n`,
        });
        const cases = [
          { format: "macOS 13+", state: "disabled", outcome: "started" },
          { format: "macOS 13+", state: "enabled", outcome: "LegacyBootServiceError" },
          { format: "macOS 12", state: "true", outcome: "started" },
          { format: "macOS 12", state: "false", outcome: "LegacyBootServiceError" },
        ];
        for (const { format, state, outcome } of cases) {
          const started = yield* startBesideBootService({
            platform: "darwin",
            outputs: {
              "launchctl print": { code: 113 },
              "launchctl print-disabled": printDisabled(state),
              "t3 __service-preflight": preLockPreflight,
            },
          });
          assert.equal(started.outcome, outcome, `${format} ${state}`);
        }
        for (const [active, enabled, outcome] of [
          [
            { code: 3, stdout: "inactive\n" },
            { code: 0, stdout: "enabled\n" },
            "LegacyBootServiceError",
          ],
          [{ code: 3, stdout: "inactive\n" }, { code: 1, stdout: "disabled\n" }, "started"],
          // Between automatic restarts.
          [
            { code: 3, stdout: "activating\n" },
            { code: 1, stdout: "disabled\n" },
            "LegacyBootServiceError",
          ],
        ] as const) {
          const started = yield* startBesideBootService({
            platform: "linux",
            outputs: {
              "systemctl is-active": active,
              "systemctl is-enabled": enabled,
              "t3 __service-preflight": preLockPreflight,
            },
          });
          assert.equal(started.outcome, outcome, `${active.stdout} ${enabled.stdout}`);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("lets service setup replace a stopped service but not a loaded one", () =>
      Effect.gen(function* () {
        const stopped = yield* startBesideBootService({
          platform: "darwin",
          serviceSetup: true,
          outputs: {
            "launchctl print": { code: 113 },
            "launchctl print-disabled": { code: 0, stdout: "" },
            "t3 __service-preflight": preLockPreflight,
          },
        });
        assert.equal(stopped.outcome, "started");
        const loaded = yield* startBesideBootService({
          platform: "darwin",
          serviceSetup: true,
          outputs: { "launchctl print": { code: 0 }, "t3 __service-preflight": preLockPreflight },
        });
        assert.equal(loaded.outcome, "LegacyBootServiceError");
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("refuses a loaded service that has not restarted into its new release", () =>
      Effect.gen(function* () {
        const lockAware = preflightOutput(
          runServicePreflight({
            databasePath: "/unused",
            launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
          }),
        );
        const loaded = yield* startBesideBootService({
          platform: "darwin",
          restartPending: true,
          outputs: { "launchctl print": { code: 0 }, "t3 __service-preflight": lockAware },
        });
        assert.equal(loaded.outcome, "LegacyBootServiceError");
        assert.deepEqual(loaded.probes, ["launchctl print"]);
        // Booted out, the release that starts at login is the one activeVersion names.
        const stopped = yield* startBesideBootService({
          platform: "darwin",
          restartPending: true,
          outputs: {
            "launchctl print": { code: 113 },
            "launchctl print-disabled": { code: 0, stdout: "" },
            "t3 __service-preflight": lockAware,
          },
        });
        assert.equal(stopped.outcome, "started");
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("starts beside a service whose runtime takes the ownership lock", () =>
      Effect.gen(function* () {
        // A newer runtime answers an older launcher protocol with "blocked".
        for (const launcherProtocol of [SERVICE_LAUNCHER_PROTOCOL, SERVICE_LAUNCHER_PROTOCOL + 1]) {
          const started = yield* startBesideBootService({
            platform: "darwin",
            outputs: {
              "launchctl print": { code: 0 },
              "t3 __service-preflight": preflightOutput(
                runServicePreflight({ databasePath: "/unused", launcherProtocol }),
              ),
            },
          });
          assert.equal(started.outcome, "started");
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("never probes for another home's service or from the service's own server", () =>
      Effect.gen(function* () {
        const outputs = {
          "launchctl print": { code: 0 },
          "t3 __service-preflight": preLockPreflight,
        };
        for (const started of [
          yield* startBesideBootService({ platform: "darwin", outputs, unitServesOtherHome: true }),
          yield* startBesideBootService({
            platform: "darwin",
            outputs,
            environment: { [SERVICE_LAUNCHER_CONTEXT_ENV]: "{}" },
          }),
        ]) {
          assert.equal(started.outcome, "started");
          assert.deepEqual(started.probes, []);
        }
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    it.effect("starts when the service runtime cannot be probed", () =>
      Effect.gen(function* () {
        const started = yield* startBesideBootService({
          platform: "darwin",
          outputs: { "launchctl print": { code: 0 } },
        });
        assert.equal(started.outcome, "started");
        assert.deepEqual(started.probes, ["launchctl print", "t3 __service-preflight"]);
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  });
});
