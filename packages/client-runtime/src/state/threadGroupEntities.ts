import type {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadGroup,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentThreadGroup } from "./models.ts";
import { scopeThreadGroup } from "./models.ts";
import { type EnvironmentCatalogState, enabledEnvironmentIds } from "./connections.ts";
import { arrayElementsEqual } from "./entities.ts";

const EMPTY_GROUPS: ReadonlyArray<OrchestrationThreadGroup> = Object.freeze([]);

/** Thread groups across every enabled environment, scoped with their environment id. */
export function createEnvironmentThreadGroupAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
}) {
  const scopedGroups = new WeakMap<
    OrchestrationThreadGroup,
    Map<EnvironmentId, EnvironmentThreadGroup>
  >();
  const scopedGroup = (environmentId: EnvironmentId, group: OrchestrationThreadGroup) => {
    let byEnvironment = scopedGroups.get(group);
    if (byEnvironment === undefined) {
      byEnvironment = new Map();
      scopedGroups.set(group, byEnvironment);
    }
    let value = byEnvironment.get(environmentId);
    if (value === undefined) {
      value = scopeThreadGroup(environmentId, group);
      byEnvironment.set(environmentId, value);
    }
    return value;
  };

  const environmentThreadGroupsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationThreadGroup> =>
        get(input.snapshotAtom(environmentId))?.threadGroups ?? EMPTY_GROUPS,
    ).pipe(Atom.withLabel(`environment-thread-groups:${environmentId}`)),
  );

  let previousGroups: ReadonlyArray<EnvironmentThreadGroup> = [];
  const threadGroupsAtom = Atom.make((get) => {
    const next: EnvironmentThreadGroup[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      for (const group of get(environmentThreadGroupsAtom(environmentId))) {
        next.push(scopedGroup(environmentId, group));
      }
    }
    if (arrayElementsEqual(previousGroups, next)) {
      return previousGroups;
    }
    previousGroups = next;
    return previousGroups;
  }).pipe(Atom.withLabel("environment-thread-group-list"));

  return { environmentThreadGroupsAtom, threadGroupsAtom };
}
