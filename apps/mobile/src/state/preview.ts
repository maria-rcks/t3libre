import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { PREVIEW_STREAM_BASE_PATH } from "@t3tools/client-runtime/preview/server-browser-stream";
import { createPreviewEnvironmentAtoms } from "@t3tools/client-runtime/state/preview";
import { resolveDeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type {
  EnvironmentId,
  PreviewEvent,
  PreviewListResult,
  PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "./atom-registry";
import { useEnvironmentQuery } from "./query";
import { environmentSession, usePreparedConnection } from "./session";

export const previewEnvironment = createPreviewEnvironmentAtoms(connectionAtomRuntime);

interface ThreadPreviewTabs {
  /** Null until the first list result or event arrives. */
  readonly serverEpoch: string | null;
  readonly revision: number;
  readonly sessions: ReadonlyArray<PreviewSessionSnapshot>;
  /** A list result has arrived, so `sessions` covers tabs opened before this view. */
  readonly listed: boolean;
}

const EMPTY_TABS: ThreadPreviewTabs = {
  serverEpoch: null,
  revision: 0,
  sessions: [],
  listed: false,
};
const emptyTabsAtom = Atom.make(EMPTY_TABS).pipe(Atom.withLabel("mobile-preview-tabs:empty"));

function reconcileList(current: ThreadPreviewTabs, result: PreviewListResult): ThreadPreviewTabs {
  if (
    current.listed &&
    current.serverEpoch === result.serverEpoch &&
    result.revision <= current.revision
  ) {
    return current;
  }
  return {
    serverEpoch: result.serverEpoch,
    revision: result.revision,
    sessions: result.sessions,
    listed: true,
  };
}

function applyEvent(current: ThreadPreviewTabs, event: PreviewEvent): ThreadPreviewTabs {
  if (event.revision <= current.revision) return current;
  const others = current.sessions.filter((session) => session.tabId !== event.tabId);
  const existing = current.sessions.find((session) => session.tabId === event.tabId);
  const sessions = (() => {
    switch (event.type) {
      case "opened":
      case "navigated":
      case "resized":
        // Keep a tab's place so the picker order is stable.
        return existing
          ? current.sessions.map((session) =>
              session.tabId === event.tabId ? event.snapshot : session,
            )
          : [...others, event.snapshot];
      case "failed":
        return existing
          ? current.sessions.map((session) =>
              session.tabId === event.tabId
                ? {
                    ...session,
                    navStatus: {
                      _tag: "LoadFailed" as const,
                      url: event.url,
                      title: event.title,
                      code: event.code,
                      description: event.description,
                    },
                    updatedAt: event.createdAt,
                  }
                : session,
            )
          : current.sessions;
      case "closed":
        return others;
    }
  })();
  return { ...current, serverEpoch: event.serverEpoch, revision: event.revision, sessions };
}

/**
 * One thread's preview tabs: the `preview.list` result kept current by
 * environment preview events, the same pairing web's preview session sync uses.
 */
const threadPreviewTabsAtom = Atom.family((threadKey: string) => {
  const ref = parseScopedThreadKey(threadKey);
  if (ref === null) return emptyTabsAtom;
  const listAtom = previewEnvironment.list({
    environmentId: ref.environmentId,
    input: { threadId: ref.threadId },
  });
  const eventsAtom = previewEnvironment.events({ environmentId: ref.environmentId, input: {} });
  return Atom.make((get) => {
    let disposed = false;
    let state = EMPTY_TABS;
    const publish = (next: ThreadPreviewTabs) => {
      if (next === state) return;
      state = next;
      get.setSelf(next);
    };
    get.addFinalizer(() => {
      disposed = true;
    });
    get.subscribe(listAtom, (result) => {
      if (AsyncResult.isSuccess(result)) publish(reconcileList(state, result.value));
    });
    get.subscribe(eventsAtom, (result) => {
      if (!AsyncResult.isSuccess(result) || result.value.threadId !== ref.threadId) return;
      // A restarted server resets revisions; only a fresh list is authoritative.
      if (state.serverEpoch !== null && result.value.serverEpoch !== state.serverEpoch) {
        get.refresh(listAtom);
        return;
      }
      publish(applyEvent(state, result.value));
    });
    const cached = get.once(listAtom);
    if (AsyncResult.isSuccess(cached)) state = reconcileList(state, cached.value);
    // The cached list can predate an agent-opened tab.
    queueMicrotask(() => {
      if (!disposed) get.refresh(listAtom);
    });
    return state;
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`mobile-preview-tabs:${threadKey}`));
});

/** The thread's server-hosted browser tabs. `loaded` turns true once the tab list has arrived. */
export function useThreadServerBrowserTabs(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly enabled: boolean;
}) {
  const tabs = useAtomValue(
    input.enabled
      ? threadPreviewTabsAtom(
          scopedThreadKey({ environmentId: input.environmentId, threadId: input.threadId }),
        )
      : emptyTabsAtom,
  );
  const sessions = useMemo(
    () => tabs.sessions.filter((session) => session.runtime === "server"),
    [tabs.sessions],
  );
  return { tabs: sessions, loaded: tabs.listed };
}

const previewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      return prepared === null
        ? Effect.never
        : resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`mobile-preview-stream-access:${environmentId}`)),
);

/** Fetches a fresh stream ticket; a refused socket calls this before reconnecting. */
export function refreshPreviewStreamAccess(environmentId: EnvironmentId) {
  appAtomRegistry.refresh(previewStreamAccessAtom(environmentId));
}

/** Stream credentials for server tabs, with the same ticket flow as the device hub. */
export function usePreviewStreamAccess(environmentId: EnvironmentId) {
  const prepared = usePreparedConnection(environmentId);
  const query = useEnvironmentQuery(previewStreamAccessAtom(environmentId));
  const access = query.data && query.error === null && Option.isSome(prepared) ? query.data : null;
  return { access, error: query.error, refresh: query.refresh };
}
