import type { EnvironmentId } from "@t3tools/contracts";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";

import { runtime } from "~/lib/runtime";
import { readPreparedConnection } from "~/state/session";

export async function previewEnvironmentPost(
  environmentId: EnvironmentId,
  path: string,
  body?: Blob,
) {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
  const url = new URL(path, connection.httpBaseUrl).toString();
  const headers: Record<string, string> = {};
  const authorization = connection.httpAuthorization;
  if (authorization?._tag === "Bearer") {
    headers.authorization = `Bearer ${authorization.token}`;
  } else if (authorization?._tag === "Dpop") {
    headers.authorization = `DPoP ${authorization.accessToken}`;
    headers.dpop = await runtime.runPromise(
      Effect.gen(function* () {
        const signer = yield* ManagedRelay.ManagedRelayDpopSigner;
        return yield* signer.createProof({
          method: "POST",
          url,
          accessToken: authorization.accessToken,
        });
      }),
    );
  }
  return fetch(url, {
    method: "POST",
    headers,
    ...(body ? { body } : {}),
    credentials: authorization === null ? "include" : "omit",
    signal: AbortSignal.timeout(body ? 120_000 : 15_000),
  });
}
