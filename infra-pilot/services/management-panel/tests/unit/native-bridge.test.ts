import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const {
  getOfflineState,
  saveOfflineState,
  addPendingAction,
  clearPendingActions,
  setOnlineStatus,
} = await import('../../src/native-bridge.ts');

describe('native-bridge module', () => {
  beforeEach(() => storage.clear());

  it('returns empty offline state by default', () => {
    const state = getOfflineState();
    assert.deepEqual(state.pendingActions, []);
    assert.equal(state.lastSyncAt, null);
    assert.equal(state.lastOnlineAt, null);
  });

  it('saves and restores offline state', () => {
    saveOfflineState({
      pendingActions: [],
      lastSyncAt: '2024-01-01T00:00:00Z',
      lastOnlineAt: '2024-01-01T00:00:00Z',
    });
    const state = getOfflineState();
    assert.equal(state.lastSyncAt, '2024-01-01T00:00:00Z');
    assert.equal(state.lastOnlineAt, '2024-01-01T00:00:00Z');
  });

  it('adds pending actions', () => {
    addPendingAction('app:create', { name: 'test-app' });
    const state = getOfflineState();
    assert.equal(state.pendingActions.length, 1);
    assert.equal(state.pendingActions[0].type, 'app:create');
    assert.deepEqual(state.pendingActions[0].payload, { name: 'test-app' });
    assert.ok(state.pendingActions[0].id);
    assert.ok(state.pendingActions[0].timestamp);
  });

  it('clears pending actions and sets lastSyncAt', () => {
    addPendingAction('app:create', { name: 'test' });
    clearPendingActions();
    const state = getOfflineState();
    assert.equal(state.pendingActions.length, 0);
    assert.ok(state.lastSyncAt);
  });

  it('sets online status timestamp', () => {
    setOnlineStatus();
    const state = getOfflineState();
    assert.ok(state.lastOnlineAt);
  });
});
