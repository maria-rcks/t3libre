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

const { clearAccessToken, getAccessToken, setAccessToken } = await import('../../src/lib/auth.ts');

describe('auth token storage helpers', () => {
  beforeEach(() => storage.clear());

  it('sets, reads, and clears the Supabase access token consistently', () => {
    assert.equal(getAccessToken(), null);
    setAccessToken('test-token');
    assert.equal(getAccessToken(), 'test-token');
    clearAccessToken();
    assert.equal(getAccessToken(), null);
  });
});
