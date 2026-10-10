// Split chunks are fetched lazily, so a deploy (or desktop server swap)
// between page load and a later fetch can 404 the old hashed assets. One
// reload picks up the fresh index.html. sessionStorage remembers which
// failures already had their reload, so a chunk that keeps failing, even one
// every boot requests, reloads once and then surfaces. A later deploy fails a
// different asset and gets its own reload. The list is capped, so a tab
// reloads automatically at most that many times.
const CHUNK_RELOAD_GUARD_KEY = "t3code:chunk-load-reloads";
const MAX_CHUNK_RELOADS = 20;

/**
 * Called from the `vite:preloadError` listener with a key naming the page's
 * build and the asset that failed. Reloads at most once per key and returns
 * whether it did, so the caller knows whether to swallow the event or let
 * the error surface through the normal paths.
 */
export function reloadOnceForChunkLoadError(
  failure: string,
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  try {
    const storage = getStorage();
    const stored: unknown = JSON.parse(storage.getItem(CHUNK_RELOAD_GUARD_KEY) ?? "[]");
    const reloaded = Array.isArray(stored) ? stored : [];
    if (reloaded.includes(failure) || reloaded.length >= MAX_CHUNK_RELOADS) return false;
    storage.setItem(CHUNK_RELOAD_GUARD_KEY, JSON.stringify([...reloaded, failure]));
  } catch {
    // Without storage the guard cannot survive a reload, so a persistent
    // failure would loop forever. Let the error surface instead.
    return false;
  }
  reload();
  return true;
}
