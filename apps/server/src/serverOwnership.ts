// @effect-diagnostics nodeBuiltinImport:off - Publication must finish synchronously while the scope holds ownership.
// @effect-diagnostics schemaSyncInEffect:off - Descriptor validation and publication are synchronous under the ownership lock.
import {
  HostProcessEnvironment,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { SERVER_EXIT_CODE_STATE_DIR_OWNED } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "./processRunner.ts";
import { acquireServerOwnershipLock, SERVER_UPDATE_RECOVERY_FILE } from "./serverOwnershipLock.ts";
import { decodeServicePreflightResult } from "./cloud/servicePreflight.ts";
import {
  BOOT_SERVICE_LAUNCHD_LABEL,
  BOOT_SERVICE_PLIST_FILE,
  BOOT_SERVICE_UNIT_FILE,
  bootServiceBaseDirOf,
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_RESTART_PENDING_FILE,
  SERVICE_STATE_FILE,
  serviceStateActiveVersion,
  serviceStateHasPendingUpdate,
  serviceStatePendingUpdateId,
} from "./cloud/serviceProtocol.ts";

import {
  isProcessAlive,
  readPersistedServerRuntimeState,
  PersistedServerRuntimeState,
} from "./serverRuntimeState.ts";

export class ServerAlreadyRunningError extends Schema.TaggedError<ServerAlreadyRunningError>()(
  "ServerAlreadyRunningError",
  { stateDir: Schema.String },
) {
  // Distinct process exit code so a supervisor can tell "owned by another
  // server" apart from a crash and stop restarting.
  override readonly [Runtime.errorExitCode] = SERVER_EXIT_CODE_STATE_DIR_OWNED;

  override get message(): string {
    return `A T3 Code server already owns ${this.stateDir}. Finish active agent work, stop that server through the app or terminal that started it, then retry this command with the same home directory. No server was stopped.`;
  }
}

export class LegacyBootServiceError extends Schema.TaggedError<LegacyBootServiceError>()(
  "LegacyBootServiceError",
  { baseDir: Schema.String },
) {
  override readonly [Runtime.errorExitCode] = SERVER_EXIT_CODE_STATE_DIR_OWNED;

  override get message(): string {
    return `An older T3 Code background service is set up for ${this.baseDir} and cannot share it safely. Update it with \`t3 update\` and let it restart (run \`t3 service restart\` if the update is already installed), or remove it with \`t3 service uninstall\`, then retry. No server was stopped.`;
  }
}

export class ServerOwnershipError extends Schema.TaggedError<ServerOwnershipError>()(
  "ServerOwnershipError",
  { statePath: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not acquire or update server ownership at ${this.statePath}.`;
  }
}

export class ServerOwnershipReleasedError extends Schema.TaggedError<ServerOwnershipReleasedError>()(
  "ServerOwnershipReleasedError",
  { statePath: Schema.String },
) {
  override get message(): string {
    return `Cannot publish server runtime state after ownership was released at ${this.statePath}.`;
  }
}

export class ServerUpdateRecoveryRequiredError extends Schema.TaggedError<ServerUpdateRecoveryRequiredError>()(
  "ServerUpdateRecoveryRequiredError",
  { statePath: Schema.String },
) {
  override readonly [Runtime.errorExitCode] = SERVER_EXIT_CODE_STATE_DIR_OWNED;
  override get message(): string {
    return `An interrupted server update requires recovery at ${this.statePath}. Recover the database and service state before restarting. No database files were restored.`;
  }
}

const isServerUpdateRecoveryRequiredError = Schema.is(ServerUpdateRecoveryRequiredError);

const requireNoInterruptedRestore = (statePath: string) =>
  Effect.try({
    try: () => {
      const marker = NodePath.join(NodePath.dirname(statePath), SERVER_UPDATE_RECOVERY_FILE);
      if (NodeFS.existsSync(marker)) {
        throw new ServerUpdateRecoveryRequiredError({ statePath: marker });
      }
      const runtimeDir = NodePath.join(NodePath.dirname(NodePath.dirname(statePath)), "runtime");
      let contents: string;
      try {
        contents = NodeFS.readFileSync(NodePath.join(runtimeDir, "service-state.json"), "utf8");
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
        throw cause;
      }
      const updateId = serviceStatePendingUpdateId(contents);
      if (
        serviceStateHasPendingUpdate(contents) &&
        (updateId === undefined ||
          NodeFS.existsSync(NodePath.join(runtimeDir, "db-backup", updateId)))
      ) {
        throw new ServerUpdateRecoveryRequiredError({ statePath: runtimeDir });
      }
    },
    catch: (cause) =>
      isServerUpdateRecoveryRequiredError(cause)
        ? cause
        : new ServerOwnershipError({ statePath, cause }),
  });

const encodeRuntimeState = Schema.encodeSync(Schema.fromJsonString(PersistedServerRuntimeState));
const decodeRuntimeState = Schema.decodeUnknownSync(
  Schema.fromJsonString(PersistedServerRuntimeState),
);
const decodeJson = Schema.decodeOption(Schema.fromJsonString(Schema.Unknown));

/** Treat a legacy record as stale only when process start time proves PID reuse. */
const legacyOwnerIsLive = Effect.fn("legacyOwnerIsLive")(function* (
  state: PersistedServerRuntimeState,
) {
  if (!isProcessAlive(state.pid)) return false;
  const recordedAt = Date.parse(state.startedAt);
  if (!Number.isFinite(recordedAt)) return true;
  const platform = yield* HostProcessPlatform;
  const windows = platform === "win32";
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner
    .run({
      command: windows ? "powershell.exe" : "ps",
      args: windows
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${state.pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
          ]
        : ["-p", String(state.pid), "-o", "lstart="],
      env: { LC_ALL: "C", TZ: "UTC" },
      timeout: Duration.seconds(2),
      maxOutputBytes: 16_384,
    })
    .pipe(Effect.option);
  if (Option.isNone(result) || result.value.code !== 0) return true;
  const output = result.value.stdout.trim();
  const startedAt = Date.parse(windows ? output : `${output} UTC`);
  // ps reports whole seconds. Unknown identity stays conservative, and no
  // process is ever signalled based on this comparison.
  return !Number.isFinite(startedAt) || startedAt <= recordedAt + 1_000;
});

/**
 * A boot service on an older release never takes the ownership lock, so it is
 * invisible once its runtime record is replaced. Best effort: anything that
 * cannot be read or probed allows startup.
 */
const legacyBootServiceHome = Effect.fn("legacyBootServiceHome")(function* (
  stateDir: string,
  serviceSetup: boolean,
) {
  const environment = yield* HostProcessEnvironment;
  const platform = yield* HostProcessPlatform;
  const uid = yield* HostProcessUserId;
  const homeDir = environment.HOME;
  if (environment[SERVICE_LAUNCHER_CONTEXT_ENV] !== undefined || !homeDir) return undefined;
  const manager =
    platform === "darwin" && uid !== undefined
      ? {
          unitPath: NodePath.join(homeDir, "Library", "LaunchAgents", BOOT_SERVICE_PLIST_FILE),
          running: {
            command: "launchctl",
            args: ["print", `gui/${uid}/${BOOT_SERVICE_LAUNCHD_LABEL}`],
          },
          scheduled: { command: "launchctl", args: ["print-disabled", `gui/${uid}`] },
          // macOS 12 and earlier print true/false instead of disabled/enabled.
          isScheduled: (stdout: string) =>
            !stdout.includes(`"${BOOT_SERVICE_LAUNCHD_LABEL}" => disabled`) &&
            !stdout.includes(`"${BOOT_SERVICE_LAUNCHD_LABEL}" => true`),
        }
      : platform === "linux"
        ? {
            unitPath: NodePath.join(homeDir, ".config", "systemd", "user", BOOT_SERVICE_UNIT_FILE),
            running: {
              command: "systemctl",
              args: ["--user", "is-active", BOOT_SERVICE_UNIT_FILE],
            },
            scheduled: {
              command: "systemctl",
              args: ["--user", "is-enabled", BOOT_SERVICE_UNIT_FILE],
            },
            isScheduled: (stdout: string) => stdout.trim() === "enabled",
          }
        : undefined;
  if (manager === undefined) return undefined;

  const service = yield* Effect.try(() => {
    const baseDir = bootServiceBaseDirOf(NodeFS.readFileSync(manager.unitPath, "utf8"));
    if (baseDir === undefined) return undefined;
    if (NodeFS.realpathSync(NodePath.join(baseDir, "userdata")) !== stateDir) return undefined;
    const version = serviceStateActiveVersion(
      NodeFS.readFileSync(NodePath.join(baseDir, "runtime", SERVICE_STATE_FILE), "utf8"),
    );
    const restartPending = NodeFS.existsSync(
      NodePath.join(baseDir, "runtime", SERVICE_RESTART_PENDING_FILE),
    );
    return version === undefined ? undefined : { baseDir, version, restartPending };
  }).pipe(Effect.orElseSucceed(() => undefined));
  if (service === undefined) return undefined;

  const runner = yield* ProcessRunner.ProcessRunner;
  const running = yield* runner
    .run({ ...manager.running, timeout: Duration.seconds(5) })
    .pipe(Effect.option);
  if (Option.isNone(running)) return undefined;
  // systemd reports a unit waiting out its restart delay as "activating", exit 3.
  if (running.value.code === 0 || running.value.stdout.trim() === "activating") {
    // The service's server would hold this lock, so with a restart pending the
    // loaded service is still on a release older than activeVersion.
    if (service.restartPending) return service.baseDir;
  } else {
    if (serviceSetup) return undefined;
    const scheduled = yield* runner
      .run({ ...manager.scheduled, timeout: Duration.seconds(5) })
      .pipe(Effect.option);
    if (
      Option.isNone(scheduled) ||
      scheduled.value.code !== 0 ||
      !manager.isScheduled(scheduled.value.stdout)
    ) {
      return undefined;
    }
  }

  const preflight = yield* runner
    .run({
      command: NodePath.join(service.baseDir, "runtime", "versions", service.version, "t3"),
      args: [
        "__service-preflight",
        "--database-path",
        NodePath.join(stateDir, "statev2.sqlite"),
        "--launcher-protocol",
        String(SERVICE_LAUNCHER_PROTOCOL),
      ],
      timeout: Duration.seconds(15),
    })
    .pipe(Effect.option);
  if (Option.isNone(preflight) || preflight.value.code !== 0) return undefined;
  const result = decodeServicePreflightResult(
    Option.getOrUndefined(decodeJson(preflight.value.stdout)),
  );
  return result !== undefined && result.ownershipProtocol !== 1 ? service.baseDir : undefined;
});

/**
 * Hold an OS file lock until the server and its finalizers stop. This separate
 * SQLite file never contains application data and must never be unlinked.
 * SQLite releases the lock on process exit, including SIGKILL. No PID is killed
 * and no heartbeat can expire while a live server is paused.
 */
export const acquireServerOwnership = Effect.fn("acquireServerOwnership")(function* (
  statePath: string,
  trial?: { readonly previousOwnerId: string | null; readonly ownerId: string },
  options?: { readonly serviceSetup?: boolean },
) {
  const crypto = yield* Crypto.Crypto;
  const ownerId =
    trial?.ownerId ??
    (yield* crypto.randomUUIDv4.pipe(
      Effect.mapError((cause) => new ServerOwnershipError({ statePath, cause })),
    ));
  const resource = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const lock = await acquireServerOwnershipLock(NodePath.dirname(statePath));
        return {
          lock,
          path: NodePath.join(lock.stateDir, NodePath.basename(statePath)),
          active: true,
        };
      },
      catch: (cause) =>
        cause instanceof Error &&
        (("errcode" in cause && cause.errcode === 5) ||
          ("code" in cause && cause.code === "SQLITE_BUSY"))
          ? new ServerAlreadyRunningError({ stateDir: NodePath.dirname(statePath) })
          : new ServerOwnershipError({ statePath, cause }),
    }),
    (resource) =>
      Effect.gen(function* () {
        resource.active = false;
        const state = yield* readPersistedServerRuntimeState(resource.path);
        yield* Effect.try({
          try: () => {
            if (Option.isSome(state) && state.value.ownerId === ownerId) {
              NodeFS.rmSync(resource.path, { force: true });
            }
          },
          catch: (cause) => new ServerOwnershipError({ statePath, cause }),
        }).pipe(Effect.ignore({ log: true }));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            resource.active = false;
            resource.lock.close();
          }),
        ),
      ),
  );

  if (trial === undefined) yield* requireNoInterruptedRestore(resource.path);
  if (trial === undefined && statePath !== resource.path)
    yield* requireNoInterruptedRestore(statePath);

  // Older releases have no lock. Do not replace their record while their PID
  // still identifies that process. New records with a free lock belong to a
  // crashed or stopped owner.
  const previous = yield* Effect.try({
    try: () => {
      try {
        const contents = NodeFS.readFileSync(resource.path, "utf8");
        return Option.some(decodeRuntimeState(contents));
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
          return Option.none<PersistedServerRuntimeState>();
        }
        throw cause;
      }
    },
    catch: (cause) => new ServerOwnershipError({ statePath, cause }),
  });
  if (
    Option.isSome(previous) &&
    previous.value.ownerId === undefined &&
    (yield* legacyOwnerIsLive(previous.value))
  ) {
    return yield* new ServerAlreadyRunningError({ stateDir: resource.lock.stateDir });
  }
  if (trial === undefined) {
    const baseDir = yield* legacyBootServiceHome(
      resource.lock.stateDir,
      options?.serviceSetup === true,
    );
    if (baseDir !== undefined) return yield* new LegacyBootServiceError({ baseDir });
  }

  yield* Effect.try({
    try: () => {
      if (trial !== undefined && resource.lock.readOwnerId() !== trial.previousOwnerId) {
        throw Object.assign(
          new Error("Another owner used the database after the update snapshot."),
          { code: "T3_STATE_DIR_OWNED" },
        );
      }
      resource.lock.claim(ownerId);
    },
    catch: (cause) =>
      cause instanceof Error && "code" in cause && cause.code === "T3_STATE_DIR_OWNED"
        ? new ServerAlreadyRunningError({ stateDir: resource.lock.stateDir })
        : new ServerOwnershipError({ statePath, cause }),
  });

  return {
    publish: (state: PersistedServerRuntimeState) =>
      Effect.suspend<void, ServerOwnershipError | ServerOwnershipReleasedError, never>(() => {
        if (!resource.active) return Effect.fail(new ServerOwnershipReleasedError({ statePath }));
        return Effect.try({
          try: () => {
            const temporaryPath = `${resource.path}.${ownerId}.tmp`;
            try {
              NodeFS.writeFileSync(
                temporaryPath,
                `${encodeRuntimeState({ ...state, ownerId })}\n`,
                {
                  mode: 0o600,
                },
              );
              NodeFS.renameSync(temporaryPath, resource.path);
            } finally {
              NodeFS.rmSync(temporaryPath, { force: true });
            }
          },
          catch: (cause) => new ServerOwnershipError({ statePath, cause }),
        });
      }),
  };
});

/**
 * Check before service setup. The server still acquires its own lifetime lock.
 * Setup replaces a stopped older service, so only a still-loaded one refuses.
 */
export const requireServerStopped = (statePath: string) =>
  Effect.scoped(acquireServerOwnership(statePath, undefined, { serviceSetup: true })).pipe(
    Effect.asVoid,
  );
