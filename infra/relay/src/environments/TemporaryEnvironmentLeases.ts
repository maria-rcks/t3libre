import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentCredentials from "./EnvironmentCredentials.ts";
import * as ManagedEndpointProvider from "./ManagedEndpointProvider.ts";

export const TEMPORARY_ENVIRONMENT_LEASE_TTL_MINUTES = 10;

export interface TemporaryEnvironmentLeaseRecord {
  readonly userId: string;
  readonly environmentId: string;
  readonly environmentPublicKey: string;
  readonly leaseId: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export class TemporaryEnvironmentLeasePersistenceError extends Schema.TaggedErrorClass<TemporaryEnvironmentLeasePersistenceError>()(
  "TemporaryEnvironmentLeasePersistenceError",
  {
    operation: Schema.Literals(["lookup", "renew", "claim", "clear", "list-expired"]),
    userId: Schema.optionalKey(Schema.String),
    environmentId: Schema.optionalKey(Schema.String),
    leaseId: Schema.optionalKey(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Temporary environment lease '${this.operation}' failed`;
  }
}

interface TemporaryEnvironmentLeaseKey {
  readonly userId: string;
  readonly environmentId: string;
  readonly leaseId: string;
}

interface TemporaryEnvironmentLeaseCleanupKey extends TemporaryEnvironmentLeaseKey {
  readonly expectedExpiresAt?: string;
}

const leaseSelection = {
  userId: relayEnvironmentLinks.userId,
  environmentId: relayEnvironmentLinks.environmentId,
  environmentPublicKey: relayEnvironmentLinks.environmentPublicKey,
  leaseId: relayEnvironmentLinks.temporaryLeaseId,
  expiresAt: relayEnvironmentLinks.temporaryLeaseExpiresAt,
  revokedAt: relayEnvironmentLinks.revokedAt,
};

const whereLease = (input: TemporaryEnvironmentLeaseKey) =>
  and(
    eq(relayEnvironmentLinks.userId, input.userId),
    eq(relayEnvironmentLinks.environmentId, input.environmentId),
    eq(relayEnvironmentLinks.temporaryLeaseId, input.leaseId),
    isNotNull(relayEnvironmentLinks.temporaryLeaseExpiresAt),
  );

function toLeaseRecord(row: {
  readonly userId: string;
  readonly environmentId: string;
  readonly environmentPublicKey: string;
  readonly leaseId: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}): TemporaryEnvironmentLeaseRecord | null {
  return row.leaseId !== null && row.expiresAt !== null
    ? ({
        ...row,
        leaseId: row.leaseId,
        expiresAt: row.expiresAt,
      } satisfies TemporaryEnvironmentLeaseRecord)
    : null;
}

export class TemporaryEnvironmentLeases extends Context.Service<
  TemporaryEnvironmentLeases,
  {
    readonly get: (
      input: TemporaryEnvironmentLeaseKey,
    ) => Effect.Effect<
      TemporaryEnvironmentLeaseRecord | null,
      TemporaryEnvironmentLeasePersistenceError
    >;
    readonly renew: (
      input: TemporaryEnvironmentLeaseKey,
    ) => Effect.Effect<string | null, TemporaryEnvironmentLeasePersistenceError>;
    readonly claimCleanup: (
      input: TemporaryEnvironmentLeaseCleanupKey,
    ) => Effect.Effect<boolean, TemporaryEnvironmentLeasePersistenceError>;
    readonly clear: (
      input: TemporaryEnvironmentLeaseKey,
    ) => Effect.Effect<boolean, TemporaryEnvironmentLeasePersistenceError>;
    readonly listExpired: Effect.Effect<
      ReadonlyArray<TemporaryEnvironmentLeaseRecord>,
      TemporaryEnvironmentLeasePersistenceError
    >;
  }
>()("t3code-relay/environments/TemporaryEnvironmentLeases") {}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  return TemporaryEnvironmentLeases.of({
    get: Effect.fn("relay.temporary_environment_leases.get")(function* (input) {
      return yield* db
        .select(leaseSelection)
        .from(relayEnvironmentLinks)
        .where(whereLease(input))
        .limit(1)
        .pipe(
          Effect.map((rows) => (rows[0] ? toLeaseRecord(rows[0]) : null)),
          Effect.mapError(
            (cause) =>
              new TemporaryEnvironmentLeasePersistenceError({
                operation: "lookup",
                ...input,
                cause,
              }),
          ),
        );
    }),
    renew: Effect.fn("relay.temporary_environment_leases.renew")(function* (input) {
      const now = yield* DateTime.now;
      const expiresAt = DateTime.formatIso(
        DateTime.add(now, { minutes: TEMPORARY_ENVIRONMENT_LEASE_TTL_MINUTES }),
      );
      const rows = yield* db
        .update(relayEnvironmentLinks)
        .set({ temporaryLeaseExpiresAt: expiresAt, updatedAt: DateTime.formatIso(now) })
        .where(
          and(
            whereLease(input),
            isNull(relayEnvironmentLinks.revokedAt),
            gte(relayEnvironmentLinks.temporaryLeaseExpiresAt, DateTime.formatIso(now)),
          ),
        )
        .returning({ expiresAt: relayEnvironmentLinks.temporaryLeaseExpiresAt })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TemporaryEnvironmentLeasePersistenceError({
                operation: "renew",
                ...input,
                cause,
              }),
          ),
        );
      return rows[0]?.expiresAt ?? null;
    }),
    claimCleanup: Effect.fn("relay.temporary_environment_leases.claim_cleanup")(function* (input) {
      const now = DateTime.formatIso(yield* DateTime.now);
      return yield* db
        .update(relayEnvironmentLinks)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            whereLease(input),
            isNull(relayEnvironmentLinks.revokedAt),
            input.expectedExpiresAt === undefined
              ? undefined
              : eq(relayEnvironmentLinks.temporaryLeaseExpiresAt, input.expectedExpiresAt),
          ),
        )
        .returning({ environmentId: relayEnvironmentLinks.environmentId })
        .pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(
            (cause) =>
              new TemporaryEnvironmentLeasePersistenceError({
                operation: "claim",
                ...input,
                cause,
              }),
          ),
        );
    }),
    clear: Effect.fn("relay.temporary_environment_leases.clear")(function* (input) {
      return yield* db
        .update(relayEnvironmentLinks)
        .set({
          temporaryLeaseId: null,
          temporaryLeaseExpiresAt: null,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        })
        .where(whereLease(input))
        .returning({ environmentId: relayEnvironmentLinks.environmentId })
        .pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.mapError(
            (cause) =>
              new TemporaryEnvironmentLeasePersistenceError({
                operation: "clear",
                ...input,
                cause,
              }),
          ),
        );
    }),
    listExpired: Effect.gen(function* () {
      const expiresBefore = DateTime.formatIso(yield* DateTime.now);
      return yield* db
        .select(leaseSelection)
        .from(relayEnvironmentLinks)
        .where(
          and(
            isNotNull(relayEnvironmentLinks.temporaryLeaseId),
            isNotNull(relayEnvironmentLinks.temporaryLeaseExpiresAt),
            lte(relayEnvironmentLinks.temporaryLeaseExpiresAt, expiresBefore),
          ),
        )
        .pipe(
          Effect.map((rows) => rows.flatMap((row) => toLeaseRecord(row) ?? [])),
          Effect.mapError(
            (cause) =>
              new TemporaryEnvironmentLeasePersistenceError({
                operation: "list-expired",
                cause,
              }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(TemporaryEnvironmentLeases, make);

export const releaseTemporaryEnvironmentLease = Effect.fn(
  "relay.temporary_environment_leases.release",
)(function* (input: TemporaryEnvironmentLeaseCleanupKey) {
  const leases = yield* TemporaryEnvironmentLeases;
  const credentials = yield* EnvironmentCredentials.EnvironmentCredentials;
  const managedEndpointProvider = yield* ManagedEndpointProvider.ManagedEndpointProvider;
  const leaseKey = {
    userId: input.userId,
    environmentId: input.environmentId,
    leaseId: input.leaseId,
  };
  const lease = yield* leases.get(leaseKey);
  if (lease === null) return false;

  const target = yield* managedEndpointProvider.prepareDeprovision(leaseKey);
  if (lease.revokedAt === null && !(yield* leases.claimCleanup(input))) return false;
  yield* credentials.revokeForEnvironmentPublicKey({
    environmentId: lease.environmentId,
    environmentPublicKey: lease.environmentPublicKey,
  });
  yield* managedEndpointProvider.deprovision({ ...leaseKey, target });
  yield* leases.clear(leaseKey);
  return true;
});

export const pruneExpiredTemporaryEnvironmentLeases = Effect.fn(
  "relay.temporary_environment_leases.prune_expired",
)(function* () {
  const leases = yield* TemporaryEnvironmentLeases;
  const expired = yield* leases.listExpired;
  yield* Effect.forEach(
    expired,
    (lease) =>
      releaseTemporaryEnvironmentLease({
        userId: lease.userId,
        environmentId: lease.environmentId,
        leaseId: lease.leaseId,
        expectedExpiresAt: lease.expiresAt,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to release expired temporary environment lease", {
            cause,
            userId: lease.userId,
            environmentId: lease.environmentId,
          }),
        ),
      ),
    { concurrency: 1, discard: true },
  );
});
