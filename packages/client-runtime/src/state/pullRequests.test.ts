import { EnvironmentId, ProjectId, WS_METHODS, type PullRequestRef } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
  createPullRequestRefreshAtomFamily,
} from "./pullRequests.ts";
import { PullRequestDiffLoader } from "./pullRequestDiffHttp.ts";
import { executeAtomQuery } from "./runtime.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function makeRuntime(client: WsRpcProtocolClient) {
  return Effect.gen(function* () {
    const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
      target: TARGET,
      state: yield* SubscriptionRef.make<SupervisorConnectionState>({
        ...AVAILABLE_CONNECTION_STATE,
        desired: true,
        network: "online",
        phase: "connected",
        attempt: 1,
        generation: 1,
      }),
      session: yield* SubscriptionRef.make(Option.some(session(client))),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
    const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
      run: (_environmentId, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      runStream: (_environmentId, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      followStream: (_environmentId, stream) =>
        Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
    return Atom.runtime(
      Layer.merge(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
        Layer.succeed(
          PullRequestDiffLoader,
          PullRequestDiffLoader.of({ load: () => Effect.die("unused") }),
        ),
      ),
    );
  });
}

it.effect("refreshes pull request activity after a comment is updated", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let commentBody = "old comment";
      const client = {
        [WS_METHODS.pullRequestsSubscribeRefreshes]: () => Stream.never,
        [WS_METHODS.pullRequestsActivity]: () =>
          Effect.succeed({
            author: null,
            reviewers: [],
            comments: [
              {
                id: "comment-1",
                kind: "issue-comment",
                author: null,
                body: commentBody,
                createdAt: "2026-08-24T00:00:00Z",
                url: null,
                path: null,
                reviewState: null,
                reactions: [],
              },
            ],
            commentCount: 1,
            commentsTruncated: false,
            reviewThreads: [],
            commits: [],
            reactions: [],
          }),
        [WS_METHODS.pullRequestsUpdateComment]: (input: { readonly body: string }) =>
          Effect.sync(() => {
            commentBody = input.body;
          }),
      } as unknown as WsRpcProtocolClient;
      const runtime = yield* makeRuntime(client);
      const atoms = createPullRequestEnvironmentAtoms(runtime);
      const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
        Effect.sync(() => registry.dispose()),
      );
      const reference = {
        projectId: ProjectId.make("project-1"),
        repository: "acme/web",
        number: 1,
      } as const;
      const activity = atoms.activity({ environmentId: TARGET.environmentId, input: reference });
      const unmount = registry.mount(activity);
      yield* Effect.addFinalizer(() => Effect.sync(unmount));

      const initial = yield* Effect.promise(() => executeAtomQuery(registry, activity));
      expect(AsyncResult.isSuccess(initial)).toBe(true);
      if (!AsyncResult.isSuccess(initial)) {
        return yield* Effect.die("activity did not load");
      }
      expect(initial.value.comments[0]?.body).toBe("old comment");

      const update = yield* Effect.promise(() =>
        atoms.updateComment.run(registry, {
          environmentId: TARGET.environmentId,
          input: { ...reference, commentId: "comment-1", kind: "issue-comment", body: "updated" },
        }),
      );

      expect(AsyncResult.isSuccess(update)).toBe(true);
      expect(
        (yield* AtomRegistry.getResult(registry, activity, { suspendOnWaiting: true })).comments[0]
          ?.body,
      ).toBe("updated");
    }),
  ),
);

it.effect("refreshes mounted pull request reads after a completed turn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const refreshEvents = yield* PubSub.unbounded<{ readonly revision: number }>();
      const refreshed = Latch.makeUnsafe();
      let hostRevision = 1;
      let calls = 0;
      const reference = {
        projectId: ProjectId.make("project-1"),
        repository: "acme/web",
        number: 1,
      } as const;
      const client = {
        [WS_METHODS.pullRequestsSubscribeRefreshes]: () => Stream.fromPubSub(refreshEvents),
        [WS_METHODS.pullRequestsSummary]: (input: PullRequestRef) =>
          Effect.sync(() => {
            calls += 1;
            return {
              provider: "github" as const,
              ...input,
              title: `revision ${hostRevision}`,
              url: `https://github.com/${input.repository}/pull/${input.number}`,
              state: "open" as const,
              headBranch: "feature",
              baseBranch: "main",
              updatedAt: `2026-09-03T00:00:0${hostRevision}.000Z`,
            };
          }),
      } as unknown as WsRpcProtocolClient;
      const runtime = yield* makeRuntime(client);
      const refreshes = createPullRequestRefreshAtomFamily(runtime);
      const linkedSummaries = createLinkedPullRequestSummaryAtomFamily(runtime, refreshes);
      const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
        Effect.sync(() => registry.dispose()),
      );
      const summary = linkedSummaries({ environmentId: TARGET.environmentId, input: reference });
      const stop = registry.subscribe(summary, (result) => {
        if (AsyncResult.isSuccess(result) && result.value.title === "revision 2") {
          refreshed.openUnsafe();
        }
      });

      expect(
        (yield* AtomRegistry.getResult(registry, summary, { suspendOnWaiting: true })).title,
      ).toBe("revision 1");

      hostRevision = 2;
      yield* PubSub.publish(refreshEvents, { revision: 1 });
      yield* refreshed.await;

      expect(
        (yield* AtomRegistry.getResult(registry, summary, { suspendOnWaiting: true })).title,
      ).toBe("revision 2");
      expect(calls).toBe(2);
      stop();
    }),
  ),
);
