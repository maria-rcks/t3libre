import {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkProofInvalidReason,
  type RelayEnvironmentLinkRequest,
} from "@t3tools/contracts/relay";
import {
  decodeRelayJwt,
  normalizeRelayIssuer,
  RELAY_LINK_PROOF_TYP,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DpopProofs from "../auth/DpopProofs.ts";
import * as RelayTokens from "../auth/RelayTokens.ts";
import * as EnvironmentCredentials from "./EnvironmentCredentials.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as ManagedEndpointProvider from "./ManagedEndpointProvider.ts";
import * as ManagedEndpointProvisionClaims from "./ManagedEndpointProvisionClaims.ts";
import * as RelayConfiguration from "../Config.ts";
import * as TemporaryEnvironmentLeases from "./TemporaryEnvironmentLeases.ts";

export class EnvironmentLinkProofExpired extends Schema.TaggedErrorClass<EnvironmentLinkProofExpired>()(
  "EnvironmentLinkProofExpired",
  {
    userId: Schema.String,
    environmentId: Schema.String,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' link proof expired at ${this.expiresAt}`;
  }
}

export class EnvironmentLinkProofInvalid extends Schema.TaggedErrorClass<EnvironmentLinkProofInvalid>()(
  "EnvironmentLinkProofInvalid",
  {
    userId: Schema.String,
    environmentId: Schema.String,
    reason: RelayEnvironmentLinkProofInvalidReason,
    stage: Schema.Literals([
      "decode_token",
      "decode_payload",
      "verify_proof",
      "authorize_capabilities",
      "validate_descriptor",
      "verify_challenge",
      "validate_expiration",
      "consume_proof_nonce",
      "consume_challenge_nonce",
      "validate_origin",
      "validate_endpoint",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' link proof is invalid during ${this.stage}: ${this.reason}`;
  }
}

export type EnvironmentLinkError =
  | EnvironmentLinkProofExpired
  | EnvironmentLinkProofInvalid
  | DpopProofs.DpopProofReplayPersistenceError
  | EnvironmentLinks.ActiveDurableEnvironmentLinkConflict
  | EnvironmentLinks.EnvironmentLinkLookupPersistenceError
  | EnvironmentLinks.EnvironmentLinkUpsertPersistenceError
  | ManagedEndpointProvisionClaims.ManagedEndpointProvisionInProgress
  | ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaimPersistenceError
  | EnvironmentCredentials.EnvironmentCredentialCreatePersistenceError
  | ManagedEndpointProvider.ManagedEndpointProviderError;

export class EnvironmentLinker extends Context.Service<
  EnvironmentLinker,
  {
    readonly link: (input: {
      readonly userId: string;
      readonly request: RelayEnvironmentLinkRequest;
    }) => Effect.Effect<
      {
        readonly environmentId: RelayEnvironmentLinkProofPayload["environmentId"];
        readonly endpoint: RelayEnvironmentLinkProofPayload["endpoint"];
        readonly endpointRuntime:
          | ManagedEndpointProvider.ManagedEndpointProvisioningResult["runtime"]
          | null;
        readonly environmentCredential: string;
        readonly temporaryLease?: {
          readonly leaseId: string;
          readonly expiresAt: string;
        };
      },
      EnvironmentLinkError
    >;
  }
>()("t3code-relay/environments/EnvironmentLinker") {}

const decodeProof = Schema.decodeUnknownEffect(RelayEnvironmentLinkProofPayload);

function proofAuthorizesRequestedCapabilities(
  proof: RelayEnvironmentLinkProofPayload,
  request: RelayEnvironmentLinkRequest,
): boolean {
  const scopes = new Set(proof.scopes);
  if (request.managedTunnelsEnabled && !scopes.has("managed_tunnels")) {
    return false;
  }
  if (request.temporary === true && !request.managedTunnelsEnabled) {
    return false;
  }
  return !(
    (request.notificationsEnabled || request.liveActivitiesEnabled) &&
    !scopes.has("agent_activity_notifications")
  );
}

function isSecureManagedEndpoint(endpoint: RelayEnvironmentLinkProofPayload["endpoint"]): boolean {
  try {
    const httpUrl = new URL(endpoint.httpBaseUrl);
    const wsUrl = new URL(endpoint.wsBaseUrl);
    return httpUrl.protocol === "https:" && wsUrl.protocol === "wss:";
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/u, "$1");
}

function isLoopbackManagedTunnelOrigin(
  origin: RelayEnvironmentLinkProofPayload["origin"],
): boolean {
  const hostname = normalizeHostname(origin.localHttpHost);
  return (
    (hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost") &&
    Number.isInteger(origin.localHttpPort) &&
    origin.localHttpPort > 0 &&
    origin.localHttpPort <= 65_535
  );
}

const make = Effect.gen(function* () {
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const credentials = yield* EnvironmentCredentials.EnvironmentCredentials;
  const managedEndpointProvider = yield* ManagedEndpointProvider.ManagedEndpointProvider;
  const provisionClaims = yield* ManagedEndpointProvisionClaims.ManagedEndpointProvisionClaims;
  const proofReplay = yield* DpopProofs.DpopProofReplay;
  const relayTokens = yield* RelayTokens.RelayTokens;
  const config = yield* RelayConfiguration.RelayConfiguration;
  const temporaryLeases = yield* TemporaryEnvironmentLeases.TemporaryEnvironmentLeases;

  return EnvironmentLinker.of({
    link: Effect.fn("relay.environment_linker.link")(function* (input) {
      const now = yield* DateTime.now;
      const nowSeconds = Math.floor(now.epochMilliseconds / 1_000);
      const unverified = yield* Effect.try({
        try: () => decodeRelayJwt(input.request.proof),
        catch: (cause) =>
          new EnvironmentLinkProofInvalid({
            userId: input.userId,
            environmentId: "unknown",
            reason: "invalid_signature_or_scope",
            stage: "decode_token",
            cause,
          }),
      });
      const candidate = yield* decodeProof(unverified).pipe(
        Effect.mapError(
          (cause) =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: "unknown",
              reason: "invalid_signature_or_scope",
              stage: "decode_payload",
              cause,
            }),
        ),
      );
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": candidate.environmentId,
        "relay.link.notifications_enabled": input.request.notificationsEnabled,
        "relay.link.live_activities_enabled": input.request.liveActivitiesEnabled,
        "relay.link.managed_tunnels_enabled": input.request.managedTunnelsEnabled,
        "relay.link.temporary": input.request.temporary === true,
      });
      if (candidate.exp <= nowSeconds) {
        return yield* new EnvironmentLinkProofExpired({
          userId: input.userId,
          environmentId: candidate.environmentId,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(candidate.exp * 1_000)),
        });
      }
      const issuer = `t3-env:${candidate.environmentId}`;
      const relayIssuer = normalizeRelayIssuer(config.relayIssuer);
      const verified = yield* verifyRelayJwt({
        publicKey: candidate.environmentPublicKey,
        token: input.request.proof,
        typ: RELAY_LINK_PROOF_TYP,
        issuer,
        audience: relayIssuer,
        nowEpochSeconds: nowSeconds,
      }).pipe(
        Effect.flatMap(decodeProof),
        Effect.mapError(
          (cause) =>
            new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: candidate.environmentId,
              reason: "invalid_signature_or_scope",
              stage: "verify_proof",
              cause,
            }),
        ),
      );
      if (
        verified.sub !== verified.environmentId ||
        !proofAuthorizesRequestedCapabilities(verified, input.request)
      ) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: candidate.environmentId,
          reason: "invalid_signature_or_scope",
          stage: "authorize_capabilities",
        });
      }
      if (verified.descriptor.environmentId !== verified.environmentId) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "descriptor_mismatch",
          stage: "validate_descriptor",
        });
      }
      const challenge = yield* relayTokens.verifyLinkChallenge({
        token: verified.challenge,
        userId: input.userId,
        request: {
          notificationsEnabled: input.request.notificationsEnabled,
          liveActivitiesEnabled: input.request.liveActivitiesEnabled,
          managedTunnelsEnabled: input.request.managedTunnelsEnabled,
          ...(input.request.temporary === undefined ? {} : { temporary: input.request.temporary }),
        },
        nowEpochSeconds: nowSeconds,
      });
      if (challenge === null) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "challenge_invalid",
          stage: "verify_challenge",
        });
      }
      const expiresAt = DateTime.make(verified.exp * 1_000);
      if (expiresAt._tag === "None") {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "invalid_signature_or_scope",
          stage: "validate_expiration",
        });
      }
      if (input.request.managedTunnelsEnabled && !isLoopbackManagedTunnelOrigin(verified.origin)) {
        return yield* new EnvironmentLinkProofInvalid({
          userId: input.userId,
          environmentId: verified.environmentId,
          reason: "origin_not_allowed",
          stage: "validate_origin",
        });
      }
      const provisionClaimKey = {
        userId: input.userId,
        environmentId: verified.environmentId,
      };
      const link = Effect.gen(function* () {
        if (input.request.temporary === true) {
          const durableLink = yield* links.getForUser({
            userId: input.userId,
            environmentId: verified.environmentId,
          });
          if (durableLink !== null) {
            return yield* new EnvironmentLinks.ActiveDurableEnvironmentLinkConflict({
              userId: input.userId,
              environmentId: verified.environmentId,
            });
          }
        }
        const consumedNonce = yield* proofReplay.consume({
          thumbprint: verified.environmentPublicKey,
          jti: verified.jti,
          iat: verified.iat,
          expiresAt: expiresAt.value,
        });
        if (!consumedNonce) {
          return yield* new EnvironmentLinkProofInvalid({
            userId: input.userId,
            environmentId: verified.environmentId,
            reason: "replayed_nonce",
            stage: "consume_proof_nonce",
          });
        }
        const consumedChallenge = yield* proofReplay.consume({
          thumbprint: "relay-environment-link-challenge",
          jti: challenge.jti,
          iat: challenge.iat,
          expiresAt: expiresAt.value,
        });
        if (!consumedChallenge) {
          return yield* new EnvironmentLinkProofInvalid({
            userId: input.userId,
            environmentId: verified.environmentId,
            reason: "challenge_invalid",
            stage: "consume_challenge_nonce",
          });
        }
        // Downgrading a managed link to publish-only must release the tunnel and
        // DNS that were provisioned for it — nothing else cleans them up until a
        // full unlink. Best effort: a cleanup failure must not block the link
        // itself, and the provider treats an absent allocation as already
        // deprovisioned, so retrying on every non-tunnel link is cheap.
        if (!input.request.managedTunnelsEnabled) {
          yield* managedEndpointProvider
            .deprovision({
              userId: input.userId,
              environmentId: verified.environmentId,
            })
            .pipe(
              Effect.tapError((error) =>
                Effect.logWarning("managed endpoint deprovision on publish-only link failed", {
                  environmentId: verified.environmentId,
                  errorTag: error._tag,
                }),
              ),
              Effect.ignore,
            );
        }
        const temporaryLeaseId = input.request.temporary === true ? verified.jti : undefined;
        const finishLink = Effect.fnUntraced(function* (
          provisioned: ManagedEndpointProvider.ManagedEndpointProvisioningResult | null,
        ) {
          const endpoint = provisioned?.endpoint ?? verified.endpoint;
          // The secure-endpoint requirement only matters when the relay advertises
          // this endpoint for other devices to reach (managed tunnel). Publish-only
          // links are reached out of band (e.g. Tailscale) and their stored endpoint
          // is never used for routing, so a nominal endpoint is acceptable.
          if (input.request.managedTunnelsEnabled && !isSecureManagedEndpoint(endpoint)) {
            return yield* new EnvironmentLinkProofInvalid({
              userId: input.userId,
              environmentId: verified.environmentId,
              reason: "endpoint_not_secure",
              stage: "validate_endpoint",
            });
          }
          const temporaryLease =
            temporaryLeaseId === undefined
              ? undefined
              : {
                  leaseId: temporaryLeaseId,
                  expiresAt: DateTime.formatIso(DateTime.add(yield* DateTime.now, { minutes: 10 })),
                };
          yield* links.upsert({
            ...input,
            proof: verified,
            endpoint,
            ...(temporaryLease === undefined ? {} : { temporaryLease }),
          });
          const environmentCredential = yield* credentials.create({
            environmentId: verified.environmentId,
            environmentPublicKey: verified.environmentPublicKey,
          });
          return {
            environmentId: verified.environmentId,
            endpoint,
            endpointRuntime: provisioned?.runtime ?? null,
            environmentCredential,
            ...(temporaryLease === undefined ? {} : { temporaryLease }),
          };
        });
        const rollbackTemporaryLink = Effect.fnUntraced(function* (
          provisioned: ManagedEndpointProvider.ManagedEndpointProvisioningResult | null,
        ) {
          if (temporaryLeaseId === undefined) return;
          const leaseKey = {
            userId: input.userId,
            environmentId: verified.environmentId,
            leaseId: temporaryLeaseId,
          };
          const claimedLease = yield* temporaryLeases.claimCleanup(leaseKey).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("temporary lease cleanup claim failed", {
                environmentId: verified.environmentId,
                cause,
              }).pipe(Effect.as(false)),
            ),
          );
          if (claimedLease) {
            yield* credentials
              .revokeForEnvironmentPublicKey({
                environmentId: verified.environmentId,
                environmentPublicKey: verified.environmentPublicKey,
              })
              .pipe(Effect.catchCause(Effect.logWarning));
          }
          yield* managedEndpointProvider
            .deprovision({
              ...leaseKey,
              target: provisioned?.deprovisionTarget ?? null,
            })
            .pipe(Effect.catchCause(Effect.logWarning));
          if (claimedLease) {
            yield* temporaryLeases.clear(leaseKey).pipe(Effect.catchCause(Effect.logWarning));
          }
        });
        const provisionManagedEndpoint = managedEndpointProvider.provision({
          userId: input.userId,
          environmentId: verified.environmentId,
          origin: verified.origin,
        });
        if (temporaryLeaseId !== undefined && input.request.managedTunnelsEnabled) {
          return yield* Effect.acquireUseRelease(
            provisionManagedEndpoint,
            finishLink,
            (provisioned, exit) =>
              Exit.isFailure(exit) ? rollbackTemporaryLink(provisioned) : Effect.void,
          );
        }
        const provisioned = input.request.managedTunnelsEnabled
          ? yield* provisionManagedEndpoint
          : null;
        return yield* temporaryLeaseId === undefined
          ? finishLink(provisioned)
          : finishLink(provisioned).pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit) ? rollbackTemporaryLink(provisioned) : Effect.void,
              ),
            );
      });
      return yield* ManagedEndpointProvisionClaims.withManagedEndpointProvisionClaim(
        provisionClaims,
        provisionClaimKey,
        link,
      );
    }),
  });
});

export const layer = Layer.effect(EnvironmentLinker, make);
