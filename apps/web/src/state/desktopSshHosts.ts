import type { DesktopBridge, DesktopDiscoveredSshHost } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

type DesktopSshDiscoveryBridge = Pick<DesktopBridge, "discoverSshHosts">;

/** Filters and ranks SSH host suggestions as the user types in the host field. */
export function filterDiscoveredSshHosts(
  hosts: ReadonlyArray<DesktopDiscoveredSshHost>,
  query: string,
  saved?: {
    readonly aliases: ReadonlySet<string>;
    readonly addresses: ReadonlySet<string>;
  },
): ReadonlyArray<DesktopDiscoveredSshHost> {
  // Configured aliases can have different SSH options at the same hostname.
  const unsavedHosts = saved
    ? hosts.filter(
        (host) =>
          !saved.aliases.has(host.alias) &&
          (host.source === "ssh-config" || !saved.addresses.has(host.hostname)),
      )
    : hosts;
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return unsavedHosts;

  const prefixMatches: Array<DesktopDiscoveredSshHost> = [];
  const substringMatches: Array<DesktopDiscoveredSshHost> = [];
  for (const host of unsavedHosts) {
    const alias = host.alias.toLowerCase();
    if (alias.startsWith(normalizedQuery)) {
      prefixMatches.push(host);
    } else if (
      alias.includes(normalizedQuery) ||
      host.hostname.toLowerCase().includes(normalizedQuery)
    ) {
      substringMatches.push(host);
    }
  }

  return [...prefixMatches, ...substringMatches];
}

class DesktopSshDiscoveryUnavailableError extends Schema.TaggedError<DesktopSshDiscoveryUnavailableError>()(
  "DesktopSshDiscoveryUnavailableError",
  {},
) {
  override get message(): string {
    return "Desktop SSH host discovery is unavailable.";
  }
}

class DesktopSshDiscoveryError extends Schema.TaggedError<DesktopSshDiscoveryError>()(
  "DesktopSshDiscoveryError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to discover SSH hosts.";
  }
}

function getDesktopSshDiscoveryBridge(): DesktopSshDiscoveryBridge | undefined {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

export function createDesktopSshHostsStateAtom(
  getBridge: () => DesktopSshDiscoveryBridge | undefined,
) {
  const discoverDesktopSshHosts = Effect.fn("discoverDesktopSshHosts")(function* () {
    const bridge = getBridge();
    if (!bridge) {
      return yield* new DesktopSshDiscoveryUnavailableError();
    }
    return yield* Effect.tryPromise({
      try: (): Promise<ReadonlyArray<DesktopDiscoveredSshHost>> => bridge.discoverSshHosts(),
      catch: (cause) => new DesktopSshDiscoveryError({ cause }),
    });
  });

  return Atom.make(discoverDesktopSshHosts()).pipe(
    Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
    Atom.keepAlive,
    Atom.withLabel("desktop:ssh-hosts"),
  );
}

export const desktopSshHostsStateAtom = createDesktopSshHostsStateAtom(
  getDesktopSshDiscoveryBridge,
);
