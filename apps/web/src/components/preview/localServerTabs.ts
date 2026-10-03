import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

/**
 * Server tabs this client opened, so the floating player pops up only for tabs
 * an agent opens. A tab can reach the session stream before its open call
 * returns, so an open still in flight counts for its whole thread.
 */
const pendingOpens = new Map<string, number>();
const openedTabs = new Set<string>();

const tabKey = (threadKey: string, tabId: string) => JSON.stringify([threadKey, tabId]);

export async function trackLocalServerTabOpen<R extends { readonly _tag: string }>(
  threadRef: ScopedThreadRef,
  open: () => Promise<R>,
): Promise<R> {
  const threadKey = scopedThreadKey(threadRef);
  pendingOpens.set(threadKey, (pendingOpens.get(threadKey) ?? 0) + 1);
  try {
    const result = await open();
    if (result._tag === "Success" && "value" in result) {
      const snapshot = result.value as PreviewSessionSnapshot;
      openedTabs.add(tabKey(threadKey, snapshot.tabId));
    }
    return result;
  } finally {
    const remaining = (pendingOpens.get(threadKey) ?? 1) - 1;
    if (remaining > 0) pendingOpens.set(threadKey, remaining);
    else pendingOpens.delete(threadKey);
  }
}

export function isLocalServerTab(threadRef: ScopedThreadRef, tabId: string): boolean {
  const threadKey = scopedThreadKey(threadRef);
  return openedTabs.has(tabKey(threadKey, tabId)) || pendingOpens.has(threadKey);
}
