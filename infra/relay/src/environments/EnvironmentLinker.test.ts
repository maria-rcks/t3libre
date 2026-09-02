import * as NodeCrypto from "node:crypto";
import type {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
} from "@t3tools/contracts/relay";
import { RELAY_LINK_PROOF_TYP } from "@t3tools/shared/relayJwt";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "./EnvironmentCredentials.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as RelayConfiguration from "../Config.ts";
import * as EnvironmentLinker from "./EnvironmentLinker.ts";
import * as ManagedEndpointProvider from "./ManagedEndpointProvider.ts";
import * as ManagedEndpointProvisionClaims from "./ManagedEndpointProvisionClaims.ts";
import * as TemporaryEnvironmentLeases from "./TemporaryEnvironmentLeases.ts";

const relayKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const environmentKeyPair = NodeCrypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
const config = RelayConfiguration.RelayConfiguration.of({
  relayIssuer: "https://relay.example.test",
  apns: {
    environment: "sandbox",
    teamId: "team-id",
    keyId: "key-id",
    privateKey: Redacted.make("private-key"),
    bundleId: "com.t3tools.t3code.dev",
  },
  apnsDeliveryJobSigningSecret: Redacted.make("job-secret"),
  clerkSecretKey: Redacted.make("clerk-secret"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "t3-code-relay",
  cloudMintPrivateKey: Redacted.make(relayKeyPair.privateKey),
  cloudMintPublicKey: relayKeyPair.publicKey,
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
});
const isEnvironmentLinkProofInvalid = Schema.is(EnvironmentLinker.EnvironmentLinkProofInvalid);

function signTestJwt(payload: object, typ: string, privateKey: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ })).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${header}.${encodedPayload}`;
  return `${signingInput}.${NodeCrypto.sign(null, Buffer.from(signingInput), privateKey).toString("base64url")}`;
}

const makeRequest = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const expiresAt = DateTime.add(now, { minutes: 5 });
  const relayTokens = yield* RelayTokens.RelayTokens;
  const challenge = yield* relayTokens.issueLinkChallenge({
    userId: "user_123",
    request: {
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
      managedTunnelsEnabled: true,
      temporary: true,
    },
    jti: "challenge-jti",
    issuedAtEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
    expiresAtEpochSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
  });
  const payload = {
    iss: "t3-env:env-link-test",
    aud: "https://relay.example.test",
    sub: "env-link-test",
    jti: "link-proof-jti",
    iat: Math.floor(now.epochMilliseconds / 1_000),
    exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
    challenge,
    environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
    descriptor: {
      environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
      label: "Link Test Environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    environmentPublicKey: environmentKeyPair.publicKey.trim(),
    endpoint: {
      httpBaseUrl: "https://env.example.test/",
      wsBaseUrl: "wss://env.example.test/",
      providerKind: "manual",
    },
    origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
    scopes: ["agent_activity_notifications", "managed_tunnels"],
  } satisfies RelayEnvironmentLinkProofPayload;
  return {
    request: {
      proof: signTestJwt(payload, RELAY_LINK_PROOF_TYP, environmentKeyPair.privateKey),
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
      managedTunnelsEnabled: true,
      temporary: true,
    } satisfies RelayEnvironmentLinkRequest,
    payload,
  };
});

function testLayer(input?: {
  readonly upsert?: EnvironmentLinks.EnvironmentLinks["Service"]["upsert"];
  readonly getForUser?: EnvironmentLinks.EnvironmentLinks["Service"]["getForUser"];
  readonly consume?: DpopProofs.DpopProofReplay["Service"]["consume"];
  readonly provision?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["provision"];
  readonly deprovision?: ManagedEndpointProvider.ManagedEndpointProvider["Service"]["deprovision"];
  readonly releaseProvisionClaim?: ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaims["Service"]["release"];
  readonly createCredential?: EnvironmentCredentials.EnvironmentCredentials["Service"]["create"];
  readonly revokeCredential?: EnvironmentCredentials.EnvironmentCredentials["Service"]["revokeForEnvironmentPublicKey"];
  readonly claimTemporaryCleanup?: TemporaryEnvironmentLeases.TemporaryEnvironmentLeases["Service"]["claimCleanup"];
  readonly clearTemporaryLease?: TemporaryEnvironmentLeases.TemporaryEnvironmentLeases["Service"]["clear"];
}) {
  return EnvironmentLinker.layer.pipe(
    Layer.provideMerge(RelayTokens.layer),
    Layer.provide(
      Layer.mergeAll(
        RelayConfiguration.layer(config),
        Layer.succeed(DpopProofs.DpopProofReplay, {
          verifyAndConsume: () => Effect.die("unexpected DPoP proof verification"),
          consume: input?.consume ?? (() => Effect.succeed(true)),
          pruneExpired: Effect.void,
        }),
        Layer.succeed(EnvironmentLinks.EnvironmentLinks, {
          upsert: input?.upsert ?? (() => Effect.void),
          listUsersForEnvironment: () => Effect.succeed([]),
          listDeliveryUsersForEnvironment: () => Effect.succeed([]),
          listPublicKeysForEnvironment: () => Effect.succeed([]),
          listForUser: () => Effect.succeed([]),
          getForUser: input?.getForUser ?? (() => Effect.succeed(null)),
          revokeForUser: () => Effect.succeed(false),
        }),
        Layer.succeed(EnvironmentCredentials.EnvironmentCredentials, {
          create: input?.createCredential ?? (() => Effect.succeed("t3env_credential_secret")),
          authenticate: () => Effect.succeedNone,
          revokeForEnvironmentPublicKey: input?.revokeCredential ?? (() => Effect.succeed(false)),
        }),
        Layer.succeed(ManagedEndpointProvider.ManagedEndpointProvider, {
          prepareDeprovision: () => Effect.succeed(null),
          deprovision: input?.deprovision ?? (() => Effect.void),
          release: () => Effect.succeed(true),
          provision:
            input?.provision ??
            (() =>
              Effect.succeed({
                endpoint: {
                  httpBaseUrl: "https://managed.example.test/",
                  wsBaseUrl: "wss://managed.example.test/ws",
                  providerKind: "cloudflare_tunnel",
                },
                runtime: {
                  providerKind: "cloudflare_tunnel",
                  connectorToken: "connector-token",
                },
                deprovisionTarget: {
                  userId: "user_123",
                  environmentId: "env-link-test",
                  hostname: "managed.example.test",
                  tunnelId: "tunnel-id",
                  tunnelName: "tunnel-name",
                  dnsRecordId: "dns-record-id",
                  generationId: "provision-generation",
                  readyAt: "2026-09-02T22:00:00.000Z",
                  updatedAt: "2026-09-02T22:00:00.000Z",
                },
              })),
        }),
        Layer.succeed(ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaims, {
          acquire: () => Effect.succeed("provision-claim"),
          release: input?.releaseProvisionClaim ?? (() => Effect.void),
        }),
        Layer.succeed(TemporaryEnvironmentLeases.TemporaryEnvironmentLeases, {
          get: () => Effect.succeed(null),
          renew: () => Effect.succeed(null),
          claimCleanup: input?.claimTemporaryCleanup ?? (() => Effect.succeed(true)),
          clear: input?.clearTemporaryLease ?? (() => Effect.succeed(true)),
          listExpired: Effect.succeed([]),
        }),
      ),
    ),
  );
}

describe("EnvironmentLinker", () => {
  it.effect("returns and persists a proof-owned temporary lease", () => {
    let persistedEnvironmentId: string | null = null;
    let persistedLease: { readonly leaseId: string; readonly expiresAt: string } | undefined;
    return Effect.gen(function* () {
      const { request, payload } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* linker.link({ userId: "user_123", request });
      expect(result.environmentId).toBe(payload.environmentId);
      expect(result.environmentCredential).toBe("t3env_credential_secret");
      expect(persistedEnvironmentId).toBe(payload.environmentId);
      expect(result.temporaryLease).toEqual(persistedLease);
      expect(result.temporaryLease?.leaseId).toBe(payload.jti);
      expect(Date.parse(result.temporaryLease?.expiresAt ?? "")).toBe(
        payload.iat * 1_000 + 600_000,
      );
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: (input) =>
            Effect.sync(() => {
              persistedEnvironmentId = input.proof.environmentId;
              persistedLease = input.temporaryLease;
            }),
        }),
      ),
    );
  });

  it.effect("deprovisions a temporary endpoint when link persistence fails", () => {
    let deprovisionedEnvironmentId: string | null = null;
    let deprovisionedGeneration: string | null = null;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error._tag).toBe("EnvironmentLinkUpsertPersistenceError");
      expect(deprovisionedEnvironmentId).toBe("env-link-test");
      expect(deprovisionedGeneration).toBe("provision-generation");
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.fail(
              new EnvironmentLinks.EnvironmentLinkUpsertPersistenceError({
                userId: "user_123",
                environmentId: "env-link-test",
                cause: new Error("database unavailable"),
              }),
            ),
          deprovision: (input) =>
            Effect.sync(() => {
              deprovisionedEnvironmentId = input.environmentId;
              deprovisionedGeneration = input.target?.generationId ?? null;
            }),
        }),
      ),
    );
  });

  it.effect("deprovisions a temporary endpoint when interrupted before lease persistence", () =>
    Effect.gen(function* () {
      const enteredUpsert = yield* Deferred.make<void>();
      let deprovisionedGeneration: string | null = null;
      yield* Effect.gen(function* () {
        const { request } = yield* makeRequest;
        const linker = yield* EnvironmentLinker.EnvironmentLinker;
        const fiber = yield* linker.link({ userId: "user_123", request }).pipe(Effect.forkChild);
        yield* Deferred.await(enteredUpsert);
        yield* Fiber.interrupt(fiber);
      }).pipe(
        Effect.provide(
          testLayer({
            upsert: () =>
              Deferred.succeed(enteredUpsert, undefined).pipe(Effect.andThen(Effect.never)),
            claimTemporaryCleanup: () => Effect.succeed(false),
            deprovision: (input) =>
              Effect.sync(() => {
                deprovisionedGeneration = input.target?.generationId ?? null;
              }),
          }),
        ),
      );
      expect(deprovisionedGeneration).toBe("provision-generation");
    }),
  );

  it.effect("rolls back its exact endpoint generation on a durable-link conflict", () => {
    let deprovisionedGeneration: string | null = null;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error._tag).toBe("ActiveDurableEnvironmentLinkConflict");
      expect(deprovisionedGeneration).toBe("provision-generation");
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.fail(
              new EnvironmentLinks.ActiveDurableEnvironmentLinkConflict({
                userId: "user_123",
                environmentId: "env-link-test",
              }),
            ),
          deprovision: (input) =>
            Effect.sync(() => {
              deprovisionedGeneration = input.target?.generationId ?? null;
            }),
        }),
      ),
    );
  });

  it.effect("rejects an active durable link before provisioning a temporary endpoint", () => {
    let provisioned = false;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error).toMatchObject({
        _tag: "ActiveDurableEnvironmentLinkConflict",
        userId: "user_123",
        environmentId: "env-link-test",
      });
      expect(provisioned).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          getForUser: () =>
            Effect.succeed({
              environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
              label: "Durable Environment",
              endpoint: {
                httpBaseUrl: "https://durable.example.test/",
                wsBaseUrl: "wss://durable.example.test/ws",
                providerKind: "cloudflare_tunnel",
              },
              environmentPublicKey: "durable-public-key",
              linkedAt: "2026-09-02T20:00:00.000Z",
            }),
          provision: () => {
            provisioned = true;
            return Effect.die("temporary endpoint must not be provisioned");
          },
        }),
      ),
    );
  });

  it.effect("preserves a durable-link lookup persistence error", () => {
    let provisioned = false;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error).toMatchObject({
        _tag: "EnvironmentLinkLookupPersistenceError",
        userId: "user_123",
        environmentId: "env-link-test",
      });
      expect(provisioned).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          getForUser: () =>
            Effect.fail(
              new EnvironmentLinks.EnvironmentLinkLookupPersistenceError({
                userId: "user_123",
                environmentId: "env-link-test",
                cause: new Error("database unavailable"),
              }),
            ),
          provision: () => {
            provisioned = true;
            return Effect.die("temporary endpoint must not be provisioned");
          },
        }),
      ),
    );
  });

  it.effect("retries provision claim release before relying on expiry recovery", () => {
    let releaseAttempts = 0;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* linker.link({ userId: "user_123", request });
      expect(result.environmentId).toBe("env-link-test");
      expect(releaseAttempts).toBe(3);
    }).pipe(
      Effect.provide(
        testLayer({
          releaseProvisionClaim: () =>
            Effect.suspend(() => {
              releaseAttempts += 1;
              return releaseAttempts < 3
                ? Effect.fail(
                    new ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaimPersistenceError(
                      {
                        operation: "release",
                        userId: "user_123",
                        environmentId: "env-link-test",
                        cause: new Error("database unavailable"),
                      },
                    ),
                  )
                : Effect.void;
            }),
        }),
      ),
    );
  });

  it.effect("cleans up the exact temporary lease when credential creation fails", () => {
    let claimedLeaseId: string | null = null;
    let revokedEnvironmentPublicKey: string | null = null;
    let deprovisionedGeneration: string | null = null;
    let clearedLeaseId: string | null = null;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error._tag).toBe("EnvironmentCredentialCreatePersistenceError");
      expect(claimedLeaseId).toBe("link-proof-jti");
      expect(revokedEnvironmentPublicKey).toBe(environmentKeyPair.publicKey.trim());
      expect(deprovisionedGeneration).toBe("provision-generation");
      expect(clearedLeaseId).toBe("link-proof-jti");
    }).pipe(
      Effect.provide(
        testLayer({
          createCredential: () =>
            Effect.fail(
              new EnvironmentCredentials.EnvironmentCredentialCreatePersistenceError({
                stage: "insert-credential",
                environmentId: "env-link-test",
                cause: new Error("database unavailable"),
              }),
            ),
          claimTemporaryCleanup: (input) =>
            Effect.sync(() => {
              claimedLeaseId = input.leaseId;
              return true;
            }),
          revokeCredential: (input) =>
            Effect.sync(() => {
              revokedEnvironmentPublicKey = input.environmentPublicKey;
              return true;
            }),
          deprovision: (input) =>
            Effect.sync(() => {
              deprovisionedGeneration = input.target?.generationId ?? null;
            }),
          clearTemporaryLease: (input) =>
            Effect.sync(() => {
              clearedLeaseId = input.leaseId;
              return true;
            }),
        }),
      ),
    );
  });

  it.effect("preserves the link failure when provision claim release also fails", () =>
    Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const error = yield* Effect.flip(linker.link({ userId: "user_123", request }));
      expect(error._tag).toBe("EnvironmentLinkUpsertPersistenceError");
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.fail(
              new EnvironmentLinks.EnvironmentLinkUpsertPersistenceError({
                userId: "user_123",
                environmentId: "env-link-test",
                cause: new Error("link database unavailable"),
              }),
            ),
          releaseProvisionClaim: () =>
            Effect.fail(
              new ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaimPersistenceError({
                operation: "release",
                userId: "user_123",
                environmentId: "env-link-test",
                cause: new Error("claim database unavailable"),
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("links a publish-only environment with a non-secure nominal endpoint", () => {
    let persistedEndpoint: string | null = null;
    let deprovisionedEnvironmentId: string | null = null;
    return Effect.gen(function* () {
      const now = yield* DateTime.now;
      const expiresAt = DateTime.add(now, { minutes: 5 });
      const relayTokens = yield* RelayTokens.RelayTokens;
      const challenge = yield* relayTokens.issueLinkChallenge({
        userId: "user_123",
        request: {
          notificationsEnabled: true,
          liveActivitiesEnabled: true,
          managedTunnelsEnabled: false,
        },
        jti: "publish-only-challenge-jti",
        issuedAtEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
        expiresAtEpochSeconds: Math.floor(expiresAt.epochMilliseconds / 1_000),
      });
      const payload = {
        iss: "t3-env:env-link-test",
        aud: "https://relay.example.test",
        sub: "env-link-test",
        jti: "publish-only-proof-jti",
        iat: Math.floor(now.epochMilliseconds / 1_000),
        exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
        challenge,
        environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
        descriptor: {
          environmentId: "env-link-test" as RelayEnvironmentLinkProofPayload["environmentId"],
          label: "Link Test Environment",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: true },
        },
        environmentPublicKey: environmentKeyPair.publicKey.trim(),
        endpoint: {
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          providerKind: "manual",
        },
        origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
        scopes: ["agent_activity_notifications"],
      } satisfies RelayEnvironmentLinkProofPayload;
      const request = {
        proof: signTestJwt(payload, RELAY_LINK_PROOF_TYP, environmentKeyPair.privateKey),
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled: false,
      } satisfies RelayEnvironmentLinkRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* linker.link({ userId: "user_123", request });
      expect(result.environmentCredential).toBe("t3env_credential_secret");
      expect(result.endpointRuntime).toBeNull();
      expect(persistedEndpoint).toBe("http://127.0.0.1:3773/");
      // Downgrading from a managed link must release the previously provisioned
      // tunnel; nothing else cleans it up before a full unlink.
      expect(deprovisionedEnvironmentId).toBe("env-link-test");
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: (input) =>
            Effect.sync(() => {
              persistedEndpoint = input.endpoint.httpBaseUrl;
            }),
          deprovision: (input) =>
            Effect.sync(() => {
              deprovisionedEnvironmentId = input.environmentId;
            }),
        }),
      ),
    );
  });

  it.effect("rejects a tampered compact proof before persistence", () => {
    let persisted = false;
    return Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const segments = request.proof.split(".");
      const signature = segments[2]!;
      segments[2] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
      const tampered = { ...request, proof: segments.join(".") };
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* Effect.result(linker.link({ userId: "user_123", request: tampered }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(isEnvironmentLinkProofInvalid(result.failure)).toBe(true);
        if (isEnvironmentLinkProofInvalid(result.failure)) {
          expect(result.failure).toMatchObject({
            userId: "user_123",
            environmentId: "env-link-test",
            reason: "invalid_signature_or_scope",
            stage: "verify_proof",
            cause: { _tag: "RelayJwtError" },
          });
        }
      }
      expect(persisted).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          upsert: () =>
            Effect.sync(() => {
              persisted = true;
            }),
        }),
      ),
    );
  });

  it.effect("rejects replayed JWT ids", () =>
    Effect.gen(function* () {
      const { request } = yield* makeRequest;
      const linker = yield* EnvironmentLinker.EnvironmentLinker;
      const result = yield* Effect.result(linker.link({ userId: "user_123", request }));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(isEnvironmentLinkProofInvalid(result.failure)).toBe(true);
        if (isEnvironmentLinkProofInvalid(result.failure)) {
          expect(result.failure).toMatchObject({
            userId: "user_123",
            environmentId: "env-link-test",
            reason: "replayed_nonce",
            stage: "consume_proof_nonce",
          });
        }
      }
    }).pipe(Effect.provide(testLayer({ consume: () => Effect.succeed(false) }))),
  );
});
