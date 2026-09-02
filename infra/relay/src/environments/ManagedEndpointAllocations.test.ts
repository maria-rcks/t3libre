import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RelayDb from "../db.ts";
import { relayManagedEndpointAllocations } from "../persistence/schema.ts";
import * as ManagedEndpointAllocations from "./ManagedEndpointAllocations.ts";

const layerWithDb = (db: RelayDb.RelayDb["Service"]) =>
  ManagedEndpointAllocations.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, db)));

describe("ManagedEndpointAllocations", () => {
  it.effect("returns a claim generation only when deprovision wins the allocation CAS", () => {
    let claimedAt: string | undefined;
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayManagedEndpointAllocations);
        return {
          set: (_values: { readonly updatedAt: string }) => {
            claimedAt = "claimed-generation";
            return {
              where: () => ({
                returning: () => Effect.succeed([{ generationId: claimedAt }]),
              }),
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      const generation = yield* allocations.claimDeprovision({
        userId: "user-1",
        environmentId: "environment-1",
        generationId: "captured-generation",
      });

      expect(generation).toBe(claimedAt);
      expect(generation).not.toBeNull();
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("does not remove an allocation superseded after a deprovision claim", () => {
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayManagedEndpointAllocations);
        return {
          where: () => ({
            returning: () => Effect.succeed([]),
          }),
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      expect(
        yield* allocations.removeClaimed({
          userId: "user-1",
          environmentId: "environment-1",
          generationId: "outdated-claim-generation",
        }),
      ).toBe(false);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("rejects a tunnel recorded after its reservation was superseded", () => {
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayManagedEndpointAllocations);
        return {
          set: () => ({
            where: () => ({
              returning: () => Effect.succeed([]),
            }),
          }),
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      const error = yield* Effect.flip(
        allocations.recordTunnel({
          userId: "user-1",
          environmentId: "environment-1",
          tunnelId: "tunnel-1",
          generationId: "outdated-generation",
        }),
      );

      expect(error).toMatchObject({
        _tag: "ManagedEndpointAllocationPersistenceError",
        operation: "record-tunnel",
        stage: "resolve-reservation",
        userId: "user-1",
        environmentId: "environment-1",
        tunnelId: "tunnel-1",
      });
      expect(error.cause).toBeUndefined();
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("rejects DNS recorded after its reservation was superseded", () => {
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayManagedEndpointAllocations);
        return {
          set: () => ({
            where: () => ({
              returning: () => Effect.succeed([]),
            }),
          }),
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      const error = yield* Effect.flip(
        allocations.recordDns({
          userId: "user-1",
          environmentId: "environment-1",
          dnsRecordId: "dns-record-1",
          generationId: "outdated-generation",
        }),
      );

      expect(error).toMatchObject({
        _tag: "ManagedEndpointAllocationPersistenceError",
        operation: "record-dns",
        stage: "resolve-reservation",
        userId: "user-1",
        environmentId: "environment-1",
        dnsRecordId: "dns-record-1",
      });
      expect(error.cause).toBeUndefined();
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("retains database failures with allocation operation and identity", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayManagedEndpointAllocations);
          return {
            where: () => ({
              limit: () => Effect.fail(cause),
            }),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      const error = yield* Effect.flip(
        allocations.get({ userId: "user-1", environmentId: "environment-1" }),
      );

      expect(error).toMatchObject({
        _tag: "ManagedEndpointAllocationPersistenceError",
        operation: "get",
        stage: "database-request",
        userId: "user-1",
        environmentId: "environment-1",
      });
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("reports an unresolved reservation without manufacturing a cause", () => {
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayManagedEndpointAllocations);
        return {
          values: () => ({
            onConflictDoUpdate: () => ({
              returning: () => Effect.succeed([]),
            }),
          }),
        };
      },
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayManagedEndpointAllocations);
          return {
            where: () => ({
              limit: () => Effect.succeed([]),
            }),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
      const error = yield* Effect.flip(
        allocations.reserve({
          userId: "user-1",
          environmentId: "environment-1",
          hostname: "environment-1.example.test",
          tunnelName: "environment-1-tunnel",
        }),
      );

      expect(error).toMatchObject({
        _tag: "ManagedEndpointAllocationPersistenceError",
        operation: "reserve",
        stage: "resolve-reservation",
        userId: "user-1",
        environmentId: "environment-1",
        hostname: "environment-1.example.test",
        tunnelName: "environment-1-tunnel",
      });
      expect(error.cause).toBeUndefined();
      expect(error.message).toContain("'resolve-reservation'");
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });
});
