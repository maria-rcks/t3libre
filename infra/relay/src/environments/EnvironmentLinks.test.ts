import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as TemporaryEnvironmentLeases from "./TemporaryEnvironmentLeases.ts";
import * as ManagedEndpointProvisionClaims from "./ManagedEndpointProvisionClaims.ts";

describe("EnvironmentLinks", () => {
  it.effect("allows only one live managed-endpoint provision claim", () => {
    let takeoverCondition: unknown;
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (config: { readonly setWhere: unknown }) => {
            takeoverCondition = config.setWhere;
            return { returning: () => Effect.succeed([]) };
          },
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-09-02T21:00:00.000Z"));
      const claims = yield* ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaims;
      const error = yield* Effect.flip(
        claims.acquire({ userId: "user-1", environmentId: "env-1" }),
      );
      expect(error).toMatchObject({
        _tag: "ManagedEndpointProvisionInProgress",
        userId: "user-1",
        environmentId: "env-1",
      });
      const query = new PgDialect().sqlToQuery(takeoverCondition as never);
      expect(query.sql).toContain('"expires_at" <= $1');
      expect(query.params).toEqual(["2026-09-02T21:00:00.000Z"]);
    }).pipe(
      Effect.provide(
        ManagedEndpointProvisionClaims.layer.pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)),
        ),
      ),
    );
  });

  it.effect("does not let a temporary upsert overwrite an active durable link", () => {
    let conflictConfig: { readonly setWhere?: unknown } | undefined;
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          values: () => ({
            onConflictDoUpdate: (config: { readonly setWhere?: unknown }) => {
              conflictConfig = config;
              return { returning: () => Effect.succeed([]) };
            },
          }),
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.upsert({
          userId: "user-1",
          request: {
            proof: "proof",
            notificationsEnabled: false,
            liveActivitiesEnabled: false,
            managedTunnelsEnabled: true,
            temporary: true,
          },
          proof: {
            environmentId: "env-1",
            descriptor: { label: "Environment" },
            environmentPublicKey: "public-key",
          } as never,
          endpoint: {
            httpBaseUrl: "https://env.example.test/",
            wsBaseUrl: "wss://env.example.test/ws",
            providerKind: "cloudflare_tunnel",
          },
          temporaryLease: {
            leaseId: "lease-1",
            expiresAt: "2026-09-02T22:10:00.000Z",
          },
        }),
      );

      expect(error).toMatchObject({
        _tag: "ActiveDurableEnvironmentLinkConflict",
        userId: "user-1",
        environmentId: "env-1",
      });
      const query = new PgDialect().sqlToQuery(conflictConfig?.setWhere as never);
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is not null');
      expect(query.sql).toContain('"relay_environment_links"."temporary_lease_id" is not null');
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("keeps durable upserts unconditional", () => {
    let conflictConfig: { readonly setWhere?: unknown } | undefined;
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (config: { readonly setWhere?: unknown }) => {
            conflictConfig = config;
            return { returning: () => Effect.succeed([{ environmentId: "env-1" }]) };
          },
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      yield* links.upsert({
        userId: "user-1",
        request: {
          proof: "proof",
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
          managedTunnelsEnabled: false,
        },
        proof: {
          environmentId: "env-1",
          descriptor: { label: "Environment" },
          environmentPublicKey: "public-key",
        } as never,
        endpoint: {
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/ws",
          providerKind: "manual",
        },
      });
      expect(conflictConfig).not.toHaveProperty("setWhere");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("retains link lookup failures with user and environment identity", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => ({
              limit: () => Effect.fail(cause),
            }),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.getForUser({ userId: "user-1", environmentId: "env-1" }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkLookupPersistenceError",
        userId: "user-1",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("identifies delivery-user list failures without retaining key material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => Effect.fail(cause),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "sensitive-public-key-material",
        }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkUserListPersistenceError",
        operation: "list-delivery-users",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
      expect(error).not.toHaveProperty("environmentPublicKey");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("selects users when either notifications or Live Activities are enabled", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: (selection: unknown) => {
        expect(selection).toBeDefined();
        return {
          from: (table: unknown) => {
            expect(table).toBe(relayEnvironmentLinks);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(yield* links.listUsersForEnvironment({ environmentId: "env-1" })).toEqual([]);
      expect(whereConditions).toHaveLength(1);

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."temporary_lease_id" is null');
      expect(query.sql).toContain('"relay_environment_links"."notifications_enabled" = $2');
      expect(query.sql).toContain('"relay_environment_links"."live_activities_enabled" = $3');
      expect(query.sql).toContain(" or ");
      expect(query.params).toEqual(["env-1", true, true]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("keeps temporary links out of account discovery", () => {
    let whereCondition: unknown;
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: (condition: unknown) => {
              whereCondition = condition;
              return Effect.succeed([]);
            },
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(yield* links.listForUser({ userId: "user-1" })).toEqual([]);
      const query = new PgDialect().sqlToQuery(whereCondition as never);
      expect(query.sql).toContain('"relay_environment_links"."temporary_lease_id" is null');
      expect(query.params).toEqual(["user-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("renews only the live matching temporary lease", () => {
    let whereCondition: unknown;
    let updateValues: Record<string, unknown> | undefined;
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues = values;
            return {
              where: (condition: unknown) => {
                whereCondition = condition;
                return {
                  returning: () =>
                    Effect.succeed([{ expiresAt: values.temporaryLeaseExpiresAt as string }]),
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-09-02T21:00:00.000Z"));
      const leases = yield* TemporaryEnvironmentLeases.TemporaryEnvironmentLeases;
      const expiresAt = yield* leases.renew({
        userId: "user-1",
        environmentId: "env-1",
        leaseId: "lease-current",
      });
      expect(expiresAt).toBe("2026-09-02T21:10:00.000Z");
      expect(updateValues?.temporaryLeaseExpiresAt).toBe(expiresAt);
      const query = new PgDialect().sqlToQuery(whereCondition as never);
      expect(query.sql).toContain('"temporary_lease_id" = $3');
      expect(query.sql).toContain('"revoked_at" is null');
      expect(query.sql).toContain('"temporary_lease_expires_at" >= $4');
      expect(query.params).toEqual([
        "user-1",
        "env-1",
        "lease-current",
        "2026-09-02T21:00:00.000Z",
      ]);
    }).pipe(
      Effect.provide(
        TemporaryEnvironmentLeases.layer.pipe(
          Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)),
        ),
      ),
    );
  });

  it.effect("revokes only the active link owned by the requesting user", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return {
                  returning: (selection: unknown) => {
                    expect(selection).toBeDefined();
                    return Effect.succeed([{ environmentId: "env-1" }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const revoked = yield* links.revokeForUser({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(revoked).toBe(true);
      expect(updateValues).toHaveLength(1);
      expect(updateValues[0]?.revokedAt).toEqual(updateValues[0]?.updatedAt);
      expect(typeof updateValues[0]?.revokedAt).toBe("string");
      expect(whereConditions).toHaveLength(1);

      const dialect = new PgDialect();
      const query = dialect.sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });
});
