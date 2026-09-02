import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq, lte } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayManagedEndpointProvisionClaims } from "../persistence/schema.ts";

// Relay requests and every provider operation are bounded well below this.
// A live owner must finish before expiry; takeover is crash recovery only.
export const MANAGED_ENDPOINT_PROVISION_CLAIM_TTL_MINUTES = 30;

export class ManagedEndpointProvisionInProgress extends Schema.TaggedErrorClass<ManagedEndpointProvisionInProgress>()(
  "ManagedEndpointProvisionInProgress",
  { userId: Schema.String, environmentId: Schema.String },
) {
  override get message(): string {
    return `Managed endpoint provision already in progress for user '${this.userId}', environment '${this.environmentId}'`;
  }
}

export class ManagedEndpointProvisionClaimPersistenceError extends Schema.TaggedErrorClass<ManagedEndpointProvisionClaimPersistenceError>()(
  "ManagedEndpointProvisionClaimPersistenceError",
  {
    operation: Schema.Literals(["acquire", "release"]),
    userId: Schema.String,
    environmentId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Managed endpoint provision claim '${this.operation}' failed for user '${this.userId}', environment '${this.environmentId}'`;
  }
}

export class ManagedEndpointProvisionClaims extends Context.Service<
  ManagedEndpointProvisionClaims,
  {
    readonly acquire: (input: {
      readonly userId: string;
      readonly environmentId: string;
    }) => Effect.Effect<
      string,
      ManagedEndpointProvisionInProgress | ManagedEndpointProvisionClaimPersistenceError
    >;
    readonly release: (input: {
      readonly userId: string;
      readonly environmentId: string;
      readonly claimId: string;
    }) => Effect.Effect<void, ManagedEndpointProvisionClaimPersistenceError>;
  }
>()("t3code-relay/environments/ManagedEndpointProvisionClaims") {}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const crypto = yield* Crypto.Crypto;
  return ManagedEndpointProvisionClaims.of({
    acquire: Effect.fn("relay.managed_endpoint_provision_claims.acquire")(function* (input) {
      const now = yield* DateTime.now;
      const createdAt = DateTime.formatIso(now);
      const expiresAt = DateTime.formatIso(
        DateTime.add(now, { minutes: MANAGED_ENDPOINT_PROVISION_CLAIM_TTL_MINUTES }),
      );
      const claimId = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new ManagedEndpointProvisionClaimPersistenceError({
              operation: "acquire",
              ...input,
              cause,
            }),
        ),
      );
      const rows = yield* db
        .insert(relayManagedEndpointProvisionClaims)
        .values({ ...input, claimId, expiresAt, createdAt })
        .onConflictDoUpdate({
          target: [
            relayManagedEndpointProvisionClaims.userId,
            relayManagedEndpointProvisionClaims.environmentId,
          ],
          set: { claimId, expiresAt, createdAt },
          setWhere: lte(relayManagedEndpointProvisionClaims.expiresAt, createdAt),
        })
        .returning({ claimId: relayManagedEndpointProvisionClaims.claimId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedEndpointProvisionClaimPersistenceError({
                operation: "acquire",
                ...input,
                cause,
              }),
          ),
        );
      if (rows.length === 0) return yield* new ManagedEndpointProvisionInProgress(input);
      return claimId;
    }),
    release: Effect.fn("relay.managed_endpoint_provision_claims.release")(function* (input) {
      yield* db
        .delete(relayManagedEndpointProvisionClaims)
        .where(
          and(
            eq(relayManagedEndpointProvisionClaims.userId, input.userId),
            eq(relayManagedEndpointProvisionClaims.environmentId, input.environmentId),
            eq(relayManagedEndpointProvisionClaims.claimId, input.claimId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ManagedEndpointProvisionClaimPersistenceError({
                operation: "release",
                userId: input.userId,
                environmentId: input.environmentId,
                cause,
              }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(ManagedEndpointProvisionClaims, make);
