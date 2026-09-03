import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "./atomicWrite.ts";
import type * as ServerConfig from "./config.ts";
import { formatHostForUrl, isWildcardHost } from "./startupAccess.ts";

export const PersistedServerRuntimeState = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int,
  host: Schema.optional(Schema.String),
  port: Schema.Int,
  origin: Schema.String,
  // Present when the server fronts a dev web server (VITE_DEV_SERVER_URL).
  // Dev is single-origin: browsers must pair through this URL, not `origin`.
  devUrl: Schema.optional(Schema.String),
  // Present while a public endpoint is ready. `t3 pair` prefers it so a
  // replacement credential remains usable from the remote client.
  pairingBaseUrl: Schema.optional(Schema.String),
  startedAt: Schema.String,
});
export type PersistedServerRuntimeState = typeof PersistedServerRuntimeState.Type;

export class ServerRuntimeStateError extends Schema.TaggedErrorClass<ServerRuntimeStateError>()(
  "ServerRuntimeStateError",
  {
    operation: Schema.Literals(["persist", "read", "decode", "clear"]),
    statePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} server runtime state at ${this.statePath}.`;
  }
}

const PersistedServerRuntimeStateJson = Schema.fromJsonString(PersistedServerRuntimeState);
const decodePersistedServerRuntimeState = Schema.decodeUnknownEffect(
  PersistedServerRuntimeStateJson,
);
const encodePersistedServerRuntimeState = Schema.encodeSync(PersistedServerRuntimeStateJson);

const isAlreadyExists = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "AlreadyExists";

/** Atomically take the current state and reinstall it only if no replacement won the path. */
const mutatePersistedServerRuntimeState = (
  statePath: string,
  mutate: (state: PersistedServerRuntimeState) => Option.Option<PersistedServerRuntimeState>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Effect.acquireUseRelease(
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(statePath), { recursive: true });
        const tempDirectory = yield* fs.makeTempDirectory({
          directory: path.dirname(statePath),
          prefix: `${path.basename(statePath)}.mutate.`,
        });
        const snapshotPath = path.join(tempDirectory, "snapshot");
        const moved = yield* fs.rename(statePath, snapshotPath).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            error.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(error),
          ),
          Effect.tapError(() => fs.remove(tempDirectory, { recursive: true, force: true })),
        );
        return { moved, snapshotPath, tempDirectory };
      }),
      ({ moved, snapshotPath, tempDirectory }) =>
        !moved
          ? Effect.void
          : Effect.gen(function* () {
              const raw = yield* fs.readFileString(snapshotPath);
              const decoded = yield* decodePersistedServerRuntimeState(raw.trim()).pipe(
                Effect.option,
              );
              const replacement = Option.isSome(decoded) ? mutate(decoded.value) : Option.none();
              if (Option.isNone(decoded) || Option.isSome(replacement)) {
                const sourcePath = Option.isNone(decoded)
                  ? snapshotPath
                  : path.join(tempDirectory, "next");
                if (Option.isSome(replacement)) {
                  yield* fs.writeFileString(
                    sourcePath,
                    `${encodePersistedServerRuntimeState(replacement.value)}\n`,
                  );
                }
                yield* fs
                  .link(sourcePath, statePath)
                  .pipe(
                    Effect.catch((error) =>
                      isAlreadyExists(error) ? Effect.void : Effect.fail(error),
                    ),
                  );
              }
            }),
      ({ moved, snapshotPath, tempDirectory }, exit) => {
        const cleanup = fs.remove(tempDirectory, { recursive: true, force: true }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to clean up a server runtime-state mutation snapshot", {
              cause,
              statePath,
              tempDirectory,
            }),
          ),
        );
        if (!moved || Exit.isSuccess(exit)) return cleanup;
        return fs.link(snapshotPath, statePath).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              isAlreadyExists(error)
                ? cleanup
                : Effect.logWarning("Failed to restore a server runtime-state mutation snapshot", {
                    error,
                    statePath,
                    snapshotPath,
                  }),
            onSuccess: () => cleanup,
          }),
        );
      },
    );
  }).pipe(
    Effect.mapError(
      (cause) => new ServerRuntimeStateError({ operation: "clear", statePath, cause }),
    ),
  );

const runtimeOriginForConfig = (
  config: Pick<ServerConfig.ServerConfig["Service"], "host">,
  port: number,
): PersistedServerRuntimeState["origin"] => {
  const hostname =
    config.host && !isWildcardHost(config.host) ? formatHostForUrl(config.host) : "127.0.0.1";
  return `http://${hostname}:${port}`;
};

export const makePersistedServerRuntimeState = (input: {
  readonly config: Pick<ServerConfig.ServerConfig["Service"], "host" | "devUrl">;
  readonly port: number;
  readonly pairingBaseUrl?: string;
}): Effect.Effect<PersistedServerRuntimeState> =>
  Effect.map(DateTime.now, (now) => ({
    version: 1,
    pid: process.pid,
    ...(input.config.host ? { host: input.config.host } : {}),
    port: input.port,
    origin: runtimeOriginForConfig(input.config, input.port),
    ...(input.config.devUrl ? { devUrl: input.config.devUrl.toString() } : {}),
    ...(input.pairingBaseUrl ? { pairingBaseUrl: input.pairingBaseUrl } : {}),
    startedAt: DateTime.formatIso(now),
  }));

export const persistServerRuntimeState = (input: {
  readonly path: string;
  readonly state: PersistedServerRuntimeState;
}) =>
  writeFileStringAtomically({
    filePath: input.path,
    contents: `${JSON.stringify(input.state)}\n`,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ServerRuntimeStateError({
          operation: "persist",
          statePath: input.path,
          cause,
        }),
    ),
  );

export const clearPersistedServerRuntimeState = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(path, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerRuntimeStateError({
            operation: "clear",
            statePath: path,
            cause,
          }),
      ),
      Effect.catchTags({
        ServerRuntimeStateError: (error) =>
          Effect.logWarning(error.message).pipe(
            Effect.annotateLogs({
              operation: error.operation,
              statePath: error.statePath,
              cause: error,
            }),
          ),
      }),
    );
  });

/**
 * Report whether the pid recorded in a persisted runtime state is still
 * running. Signal 0 delivers nothing; it only reports whether the pid exists.
 * EPERM means it exists but belongs to another user, which still counts as
 * alive.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

export const readPersistedServerRuntimeState = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(path).pipe(
      Effect.matchEffect({
        onFailure: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.fail(
                new ServerRuntimeStateError({
                  operation: "read",
                  statePath: path,
                  cause,
                }),
              ),
        onSuccess: (contents) => Effect.succeed(Option.some(contents)),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<PersistedServerRuntimeState>();
    }

    const trimmed = raw.value.trim();
    if (trimmed.length === 0) {
      return Option.none<PersistedServerRuntimeState>();
    }

    return yield* decodePersistedServerRuntimeState(trimmed).pipe(
      Effect.map(Option.some),
      Effect.mapError(
        (cause) =>
          new ServerRuntimeStateError({
            operation: "decode",
            statePath: path,
            cause,
          }),
      ),
    );
  }).pipe(
    Effect.catchTags({
      ServerRuntimeStateError: (error) =>
        Effect.logWarning(error.message).pipe(
          Effect.annotateLogs({
            operation: error.operation,
            statePath: error.statePath,
            cause: error,
          }),
          Effect.as(Option.none<PersistedServerRuntimeState>()),
        ),
    }),
  );

/** Clear a runtime advertisement only while it still belongs to this process. */
export const clearOwnedPersistedServerRuntimeState = (path: string, pid: number) =>
  mutatePersistedServerRuntimeState(path, (state) =>
    state.pid === pid ? Option.none() : Option.some(state),
  );

/** Remove a public pairing origin only while this process still owns that exact advertisement. */
export const clearOwnedPairingBaseUrl = (input: {
  readonly path: string;
  readonly pid: number;
  readonly pairingBaseUrl: string;
}) =>
  mutatePersistedServerRuntimeState(input.path, (state) => {
    if (state.pid !== input.pid || state.pairingBaseUrl !== input.pairingBaseUrl) {
      return Option.some(state);
    }
    const localState = { ...state };
    delete localState.pairingBaseUrl;
    return Option.some(localState);
  });
