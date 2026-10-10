import { describe, expect, it, vi } from "vite-plus/test";

import { reloadOnceForChunkLoadError } from "./chunkReloadGuard";

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("reloadOnceForChunkLoadError", () => {
  it("reloads on the first failure and lets failures within the next minute surface", () => {
    const storage = createStorageStub();
    const reload = vi.fn();

    expect(reloadOnceForChunkLoadError(() => storage, reload, 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // The reloaded page requests the same failing chunk during its first render.
    expect(reloadOnceForChunkLoadError(() => storage, reload, 1_002_000)).toBe(false);
    expect(reloadOnceForChunkLoadError(() => storage, reload, 1_059_999)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again for a stale deploy a minute after the last reload", () => {
    const storage = createStorageStub();
    const reload = vi.fn();

    reloadOnceForChunkLoadError(() => storage, reload, 1_000_000);

    expect(reloadOnceForChunkLoadError(() => storage, reload, 1_060_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads when storage is blocked, so a persistent failure cannot loop", () => {
    const reload = vi.fn();
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };

    expect(reloadOnceForChunkLoadError(blocked, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
