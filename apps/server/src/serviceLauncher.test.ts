// @effect-diagnostics nodeBuiltinImport:off - Inject a failed durable state rename in the real launcher.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeFSP from "node:fs/promises";
import { assert, it } from "@effect/vitest";
import { SERVER_EXIT_CODE_STATE_DIR_OWNED } from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { Launcher, readServiceState, writeServiceState } from "./serviceLauncher.ts";
import * as ServerOwnershipLock from "./serverOwnershipLock.ts";
import * as ServerRuntimeState from "./serverRuntimeState.ts";
import {
  compareExactServiceVersions,
  decodeServiceState,
  isExactServiceVersion,
  parseServiceState,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_RESTART_PENDING_FILE,
  SERVICE_STOP_MARKER_FILE,
} from "./cloud/serviceProtocol.ts";

vi.mock("node:fs/promises", { spy: true });

it("accepts only exact semantic versions", () => {
  for (const version of ["0.0.0", "1.2.3", "1.2.3-alpha.1", "1.2.3-0", "1.2.3+001"]) {
    assert.isTrue(isExactServiceVersion(version), version);
  }
  for (const version of ["latest", "01.2.3", "1.2.3-01", "1.2.3-alpha..1", "1.2.3+."]) {
    assert.isFalse(isExactServiceVersion(version), version);
  }
});

it("orders exact semantic versions without treating build metadata as precedence", () => {
  assert.equal(compareExactServiceVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareExactServiceVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.1", "2.0.0-alpha.2"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.2", "2.0.0-alpha.beta"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha-beta", "2.0.0-alpha-alpha"), 1);
  assert.equal(compareExactServiceVersions("2.0.0", "2.0.0-rc.1"), 1);
  assert.equal(compareExactServiceVersions("2.0.0+one", "2.0.0+two"), 0);
});

it("rejects contradictory service state", () => {
  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "0.0.31",
      update: {
        id: "update-1",
        fromVersion: "0.0.30",
        targetVersion: "0.0.32",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-3",
        fromVersion: "1.0.0",
        targetVersion: "1.1.0",
        status: "pending",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-2",
        fromVersion: "1.0.0",
        targetVersion: "0.9.0",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
      },
    }),
  );
});

// A pinned runtime is an executable at <versionDir>/t3. The tests stand one up
// as a Node shebang script so the launcher spawns it the way it spawns the
// real single-executable, IPC channel included.
const writeFakeRuntime = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  versionDir: string,
  childSource: string,
  ownershipProtocol = true,
) =>
  Effect.gen(function* () {
    const entryPath = path.join(versionDir, "t3");
    yield* fs.makeDirectory(versionDir, { recursive: true });
    yield* fs.writeFileString(
      entryPath,
      `#!${process.execPath}\nif(process.argv[2] === "__service-preflight") { console.log(JSON.stringify({status:"ready",version:"${path.basename(versionDir)}",launcherProtocol:3${ownershipProtocol ? ",ownershipProtocol:1" : ""}})); process.exit(0); }\n${childSource}`,
    );
    yield* fs.chmod(entryPath, 0o755);
    yield* fs.writeFileString(
      path.join(versionDir, ".install-complete"),
      `${path.basename(versionDir)}\n`,
    );
    return entryPath;
  });

it.layer(NodeServices.layer)("service state persistence", (it) => {
  it.effect("parks a competing launcher without changing service state or stop markers", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-launcher-contender-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const startsPath = path.join(root, "starts");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - isolated path embedded in a real child process.
      const starts = JSON.stringify(startsPath);
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        `
import { appendFileSync } from "node:fs";
appendFileSync(${starts}, "started\\n");
process.exit(78);
`,
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const firstRefusal = Promise.withResolvers<void>();
      const secondRefusal = Promise.withResolvers<void>();
      let refusals = 0;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            if (String(chunk).includes("waiting for a service restart")) {
              if (++refusals === 1) firstRefusal.resolve();
              else secondRefusal.resolve();
            }
            return true;
          }),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const owner = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      const ownerRunning = owner.run();
      yield* Effect.addFinalizer(() => Effect.promise(() => owner.stop("SIGTERM")));
      yield* Effect.promise(() => firstRefusal.promise);
      const before = yield* fs.readFileString(statePath);
      const contender = new Launcher(root, {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.0.0",
        update: {
          id: "stale-update",
          fromVersion: "1.0.0",
          targetVersion: "1.1.0",
          dbPath: path.join(root, "userdata", "state.sqlite"),
          status: "pending",
        },
      });
      const contenderRunning = contender.run();
      yield* Effect.addFinalizer(() => Effect.promise(() => contender.stop("SIGTERM")));
      yield* Effect.promise(() => secondRefusal.promise);
      yield* Effect.promise(() => contender.stop("SIGTERM"));
      yield* Effect.promise(() => contenderRunning);
      const earlyContender = new Launcher(root, {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.0.0",
      });
      const earlyRunning = earlyContender.run();
      const earlyStopping = earlyContender.stop("SIGTERM");
      yield* Effect.promise(() => earlyStopping);
      yield* Effect.promise(() => earlyRunning);
      assert.equal(yield* fs.readFileString(statePath), before);
      assert.equal(yield* fs.readFileString(startsPath), "started\n");
      assert.isFalse(yield* fs.exists(path.join(root, "runtime", SERVICE_STOP_MARKER_FILE)));
      yield* Effect.promise(() => owner.stop("SIGTERM"));
      yield* Effect.promise(() => ownerRunning);
    }),
  );
  it.effect("rejects a target that does not acknowledge ownership before snapshotting", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-capability-" });
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const statePath = path.join(root, "runtime", "service-state.json");
      const rejectedPath = path.join(root, "rejected");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "original database");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - isolated paths embedded in a real child process.
      const database = JSON.stringify(databasePath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off - isolated paths embedded in a real child process.
      const rejected = JSON.stringify(rejectedPath);
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        `
import { writeFileSync } from "node:fs";
process.on("message", (message) => { if(message.type === "update-rejected") { writeFileSync(${rejected}, message.reason); process.exit(0); }});
process.send({type:"request-update",targetVersion:"1.1.0",dbPath:${database}});
setInterval(() => {}, 1000);
`,
      );
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.1.0"),
        "throw new Error('unsupported runtime must not start');",
        false,
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.tryPromise(() => launcher.run()).pipe(Effect.flip);
      assert.include(
        yield* fs.readFileString(rejectedPath),
        "does not support safe database ownership",
      );
      assert.equal(yield* fs.readFileString(databasePath), "original database");
      assert.isFalse(yield* fs.exists(path.join(root, "runtime", "db-backup")));
      assert.isUndefined((yield* Effect.promise(() => readServiceState(statePath))).update);
    }),
  );
  it.effect("preserves newer writes on restart when persisting ownership cancellation failed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-cancel-" });
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const statePath = path.join(root, "runtime", "service-state.json");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "old database");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds the isolated database path in fake child source.
      const database = JSON.stringify(databasePath);
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        `
process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${database} });
setInterval(() => {}, 1000);
`,
      );
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.1.0"),
        "process.exit(78);\n",
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const { rename } = yield* Effect.promise(() =>
        vi.importActual<typeof NodeFSP>("node:fs/promises"),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              vi.spyOn(NodeFSP, "rename").mockImplementation(async (from, to) => {
                if (
                  to === statePath &&
                  parseServiceState(await NodeFSP.readFile(from, "utf8"))?.update?.status ===
                    "failed"
                )
                  throw new Error("state rename failed");
                return rename(from, to);
              }),
            ),
            (spy) => Effect.sync(() => spy.mockRestore()),
          );
          const launcher = new Launcher(
            root,
            yield* Effect.promise(() => readServiceState(statePath)),
          );
          const error = yield* Effect.tryPromise({
            try: () => launcher.run(),
            catch: String,
          }).pipe(Effect.flip);
          assert.include(error, "state rename failed");
        }),
      );
      assert.equal(
        (yield* Effect.promise(() => readServiceState(statePath))).update?.status,
        "pending",
      );
      yield* fs.writeFileString(databasePath, "new accepted writes");
      const restarted = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
      );
      const error = yield* Effect.tryPromise({
        try: () => restarted.run(),
        catch: String,
      }).pipe(Effect.flip);
      assert.include(error, "Manual recovery");
      assert.equal(yield* fs.readFileString(databasePath), "new accepted writes");
    }),
  );
  it.effect("does not roll a snapshot back over a stopped intervening owner's writes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-continuity-" });
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const statePath = path.join(root, "runtime", "service-state.json");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "before trial");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - fake runtime uses the production ownership boundary.
      const lockModule = JSON.stringify(new URL("./serverOwnershipLock.ts", import.meta.url).href);
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds the isolated database path in fake child source.
      const database = JSON.stringify(databasePath);
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        `
process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${database} });
setInterval(() => {}, 1000);
`,
      );
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.1.0"),
        `
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { acquireServerOwnershipLock } from ${lockModule};
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
const owner = await acquireServerOwnershipLock(dirname(context.update.dbPath));
owner.claim("intervening-owner");
writeFileSync(context.update.dbPath, "foreign accepted writes");
owner.close();
process.exit(1);
`,
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const refused = Promise.withResolvers<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            if (String(chunk).includes("waiting for a service restart")) refused.resolve();
            return true;
          }),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      const running = launcher.run();
      yield* Effect.addFinalizer(() => Effect.promise(() => launcher.stop("SIGTERM")));
      yield* Effect.promise(() => refused.promise);
      assert.equal(yield* fs.readFileString(databasePath), "foreign accepted writes");
      assert.equal(
        (yield* Effect.promise(() => readServiceState(statePath))).update?.status,
        "failed",
      );
      yield* Effect.promise(() => launcher.stop("SIGTERM"));
      yield* Effect.promise(() => running);
    }),
  );
  it.effect("parks on ownership refusal until explicitly stopped instead of restarting", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-refused-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        `process.exit(${SERVER_EXIT_CODE_STATE_DIR_OWNED});\n`,
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const refused = Promise.withResolvers<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
            if (String(chunk).includes("waiting for a service restart")) refused.resolve();
            return true;
          }),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      let completed = false;
      const running = launcher.run().finally(() => {
        completed = true;
      });
      yield* Effect.addFinalizer(() => Effect.promise(() => launcher.stop("SIGTERM")));
      yield* Effect.promise(() => refused.promise);
      assert.isFalse(completed);
      yield* Effect.promise(() => launcher.stop("SIGTERM"));
      yield* Effect.promise(() => running);
      assert.isTrue(completed);
    }),
  );

  it.effect("refuses backup and interrupted restore beside a live database owner", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      for (const [recovery, ownerKind] of [
        ["backup", "locked"],
        ["restore", "locked"],
        ["backup", "legacy"],
        ["restore", "legacy"],
        ["backup", "released"],
      ] as const) {
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-owned-" });
        const statePath = path.join(root, "runtime", "service-state.json");
        const databasePath = path.join(root, "userdata", "state.sqlite");
        const backupDir = path.join(root, "runtime", "db-backup", "owned-update");
        yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
        yield* fs.writeFileString(databasePath, "live database");
        yield* fs.writeFileString(`${databasePath}-wal`, "live wal");
        yield* writeFakeRuntime(
          fs,
          path,
          path.join(root, "runtime", "versions", "1.1.0"),
          'throw new Error("Recovery must not start a trial beside the live owner");\n',
        );
        const hasBackup = recovery === "restore";
        if (hasBackup) {
          yield* fs.makeDirectory(backupDir, { recursive: true });
          yield* fs.writeFileString(path.join(backupDir, "database"), "older backup");
          if (recovery === "restore") {
            yield* fs.writeFileString(path.join(backupDir, ".restore-pending"), "");
          }
        }
        yield* Effect.promise(() =>
          writeServiceState(statePath, {
            protocol: SERVICE_LAUNCHER_PROTOCOL,
            activeVersion: "1.0.0",
            update: {
              id: "owned-update",
              fromVersion: "1.0.0",
              targetVersion: "1.1.0",
              dbPath: databasePath,
              status: "pending",
            },
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            if (ownerKind === "locked") {
              yield* Effect.acquireRelease(
                Effect.promise(() =>
                  ServerOwnershipLock.acquireServerOwnershipLock(path.dirname(databasePath)),
                ),
                (lock) => Effect.sync(() => lock.close()),
              );
            } else if (ownerKind === "released") {
              const acquire = ServerOwnershipLock.acquireServerOwnershipLock;
              const foreignOwner = yield* Effect.promise(() => acquire(path.dirname(databasePath)));
              let released = false;
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  if (!released) foreignOwner.close();
                }),
              );
              yield* Effect.acquireRelease(
                Effect.sync(() =>
                  vi
                    .spyOn(ServerOwnershipLock, "acquireServerOwnershipLock")
                    .mockImplementation(async (...args) => {
                      const [, options] = args;
                      if (options?.cli || options?.launcher || released) return acquire(...args);
                      try {
                        return await acquire(...args);
                      } finally {
                        // Real contention occurs, then ownership ends before
                        // the launcher can attempt an unsafe second acquire.
                        foreignOwner.close();
                        released = true;
                      }
                    }),
                ),
                (spy) => Effect.sync(() => spy.mockRestore()),
              );
            } else {
              yield* ServerRuntimeState.persistServerRuntimeState({
                path: path.join(path.dirname(databasePath), "server-runtime.json"),
                state: yield* ServerRuntimeState.makePersistedServerRuntimeState({
                  config: { host: undefined, devUrl: undefined },
                  port: 3773,
                }),
              });
            }
            const refused = Promise.withResolvers<void>();
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
                  if (String(chunk).includes("waiting for a service restart")) refused.resolve();
                  return true;
                }),
              ),
              (spy) => Effect.sync(() => spy.mockRestore()),
            );
            const launcher = new Launcher(
              root,
              yield* Effect.promise(() => readServiceState(statePath)),
            );
            const running = launcher.run();
            yield* Effect.addFinalizer(() => Effect.promise(() => launcher.stop("SIGTERM")));
            yield* Effect.promise(() =>
              Promise.race([refused.promise, running.catch(() => undefined)]),
            );
            assert.equal(yield* fs.readFileString(databasePath), "live database");
            const cancelled = yield* Effect.promise(() => readServiceState(statePath));
            assert.equal(cancelled.update?.status, hasBackup ? "pending" : "failed");
            if (!hasBackup) {
              assert.equal(
                cancelled.update?.status === "failed" ? cancelled.update.reason : undefined,
                "state-dir-owned",
              );
            }
            assert.equal(yield* fs.readFileString(databasePath), "live database");
            assert.equal(yield* fs.readFileString(`${databasePath}-wal`), "live wal");
            assert.equal(yield* fs.exists(backupDir), hasBackup);
            assert.isFalse(yield* fs.exists(`${backupDir}.staging`));
            yield* Effect.promise(() => launcher.stop("SIGTERM"));
            yield* Effect.promise(() => running.catch(() => undefined));
          }),
        );

        // Simulate accepted foreign work before its owner stops. An explicit
        // service restart must discard the cancelled snapshot, never restore it.
        yield* fs.writeFileString(databasePath, "foreign owner's accepted writes");
        yield* fs.remove(path.join(path.dirname(databasePath), "server-runtime.json"), {
          force: true,
        });
        yield* writeFakeRuntime(
          fs,
          path,
          path.join(root, "runtime", "versions", "1.0.0"),
          "process.exit(1);\n",
        );
        const restarted = new Launcher(
          root,
          yield* Effect.promise(() => readServiceState(statePath)),
        );
        yield* Effect.tryPromise(() => restarted.run()).pipe(Effect.flip);
        assert.equal(yield* fs.readFileString(databasePath), "foreign owner's accepted writes");
        assert.equal(yield* fs.exists(backupDir), hasBackup);
      }
    }),
  );

  it.effect("durably replaces and strictly reads one state document", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-test-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const state = {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "0.0.31",
      } as const;

      yield* Effect.promise(() => writeServiceState(statePath, state));
      assert.deepEqual(yield* Effect.promise(() => readServiceState(statePath)), state);
    }),
  );

  it.effect("a fresh launcher clears a restart deferred by t3 update", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-restart-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const restartPending = path.join(root, "runtime", SERVICE_RESTART_PENDING_FILE);
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        "setInterval(() => {}, 1_000);\n",
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      const run = () =>
        Effect.gen(function* () {
          const launcher = new Launcher(
            root,
            yield* Effect.promise(() => readServiceState(statePath)),
          );
          const running = launcher.run();
          yield* Effect.promise(() => launcher.stop("SIGTERM"));
          yield* Effect.promise(() => running);
        });

      // A launcher that is still the old version leaves a marker that waits
      // for a newer one.
      yield* fs.writeFileString(restartPending, "1.0.1\n");
      yield* run();
      assert.isTrue(yield* fs.exists(restartPending));

      // Whoever restarted the service, the launcher now runs what the unit
      // names, so the deferred-restart marker is gone.
      yield* fs.writeFileString(restartPending, "1.0.0\n");
      yield* run();
      assert.isFalse(yield* fs.exists(restartPending));
    }),
  );

  it.effect("serializes shutdown with launcher recovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-stop-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      yield* writeFakeRuntime(
        fs,
        path,
        path.join(root, "runtime", "versions", "1.0.0"),
        "setInterval(() => {}, 1_000);\n",
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      const running = launcher.run();
      const stopping = launcher.stop("SIGTERM");
      yield* Effect.promise(() => stopping);
      yield* Effect.promise(() => running);
      // An early stop writes the marker only after acquiring ownership,
      // before recovery can start a child.
      assert.isTrue(yield* fs.exists(path.join(root, "runtime", SERVICE_STOP_MARKER_FILE)));
    }),
  );

  it.effect("commits only after the trial reports prepared", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-flow-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "dev", "state.sqlite");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "before trial");
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: context.update.id });
  process.on("message", (message) => {
    if (message.type === "committed") process.exit(0);
  });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        yield* writeFakeRuntime(
          fs,
          path,
          path.join(root, "runtime", "versions", version),
          childSource,
        );
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.1.0");
      assert.equal(state.update?.status, "committed");
      assert.equal(state.update?.dbPath, databasePath);
      if (state.update === undefined) throw new Error("committed update missing");
      const updateId = state.update.id;
      const ownership = yield* Effect.promise(() =>
        ServerOwnershipLock.acquireServerOwnershipLock(path.dirname(databasePath)),
      );
      try {
        ownership.markUpdatePending(updateId);
      } finally {
        ownership.close();
      }
      const backupDir = path.join(root, "runtime", "db-backup", updateId);
      yield* fs.makeDirectory(backupDir, { recursive: true });
      const restarted = new Launcher(root, state);
      yield* Effect.tryPromise(() => restarted.run()).pipe(Effect.flip);
      assert.isFalse(yield* fs.exists(path.join(root, "dev", "server-update-pending")));
      assert.isFalse(yield* fs.exists(backupDir));
      assert.equal(yield* fs.readFileString(databasePath), "before trial");
    }),
  );

  it.effect("rolls back a trial that reports the wrong update ID", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-rollback-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "before trial");
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: "wrong-update" });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        yield* writeFakeRuntime(
          fs,
          path,
          path.join(root, "runtime", "versions", version),
          childSource,
        );
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(
        state.update?.status === "rolled-back" ? state.update.reason : undefined,
        "invalid-prepared",
      );
    }),
  );

  it.effect("restores the database when a migrating trial exits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-db-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const original = "database before migration";
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, original);
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
import { writeFileSync } from "node:fs";
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  writeFileSync(context.update.dbPath, "database after migration");
  writeFileSync(context.update.dbPath + "-wal", "trial wal");
  writeFileSync(context.update.dbPath + "-shm", "trial shm");
  process.exit(1);
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        yield* writeFakeRuntime(
          fs,
          path,
          path.join(root, "runtime", "versions", version),
          childSource,
        );
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(yield* fs.readFileString(databasePath), original);
      assert.isFalse(yield* fs.exists(`${databasePath}-wal`));
      assert.isFalse(yield* fs.exists(`${databasePath}-shm`));
      const updateId = state.update?.id;
      assert.isDefined(updateId);
      assert.isFalse(yield* fs.exists(path.join(root, "runtime", "db-backup", updateId)));
    }),
  );
});
