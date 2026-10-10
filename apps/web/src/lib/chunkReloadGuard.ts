// Split chunks are fetched lazily, so a deploy (or desktop server swap)
// between page load and a later fetch can 404 the old hashed assets. One
// reload picks up the fresh index.html. sessionStorage keeps the time of that
// reload, and no automatic reload follows within a minute of it, so a chunk
// that keeps failing, even one every boot requests, cannot become a reload
// loop. A stale deploy after that minute gets its own single reload.
const CHUNK_RELOAD_GUARD_KEY = "t3code:chunk-load-reloaded";
const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * Called from the `vite:preloadError` listener. Reloads at most once per
 * window and returns whether it did, so the caller knows whether to swallow
 * the event or let the error surface through the normal paths.
 */
export function reloadOnceForChunkLoadError(
  getStorage: () => Storage = () => window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  now = Date.now(),
): boolean {
  try {
    const storage = getStorage();
    const sinceLastReload = now - Number(storage.getItem(CHUNK_RELOAD_GUARD_KEY));
    if (sinceLastReload >= 0 && sinceLastReload < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
  } catch {
    // Without storage the guard cannot survive a reload, so a persistent
    // failure would loop forever. Let the error surface instead.
    return false;
  }
  reload();
  return true;
}
