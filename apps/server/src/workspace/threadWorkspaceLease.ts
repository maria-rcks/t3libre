import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

const leases = new Map<string, { semaphore: Semaphore.Semaphore; users: number }>();

/** Coordinates checkout removal with provider and terminal startup for a thread. */
export const withThreadWorkspaceLease = <A, E, R>(
  threadId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const lease = leases.get(threadId) ?? { semaphore: Semaphore.makeUnsafe(1), users: 0 };
    leases.set(threadId, lease);
    lease.users++;
    return lease.semaphore.withPermit(effect).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          lease.users--;
          if (lease.users === 0) leases.delete(threadId);
        }),
      ),
    );
  });
