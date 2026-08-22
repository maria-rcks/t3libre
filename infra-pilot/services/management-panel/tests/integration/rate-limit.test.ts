import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import http from 'node:http';
import { app, setSupabaseClientForTests } from '../../server/index.ts';
import { Db, makeSupabase } from '../helpers/supabase-mock.ts';
import { requestWithHeaders } from '../helpers/http-client.ts';

describe('customers rate-limiting middleware', () => {
  let server: http.Server;
  let db: Db;

  before(async () => {
    server = app.listen(0);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    db = {
      setup_config: [{ id: 'setup', initialized: true, mode: 'business' }],
      docker_apps: [],
      app_logs: [],
      customers: [{ id: 'customer-1', owner_user_id: 'user-1', name: 'Acme Co', email: 'acme@example.test' }],
      user_profiles: [{ id: 'user-1', display_name: 'Test User', role: 'admin' }],
    };
    setSupabaseClientForTests(makeSupabase(db));
  });

  it('GET /api/customers emits standard RateLimit-* response headers', async () => {
    const { headers } = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    assert.ok('ratelimit-limit' in headers, 'Expected RateLimit-Limit header to be present');
    assert.ok('ratelimit-remaining' in headers, 'Expected RateLimit-Remaining header to be present');
    assert.ok('ratelimit-reset' in headers, 'Expected RateLimit-Reset header to be present');
  });

  it('GET /api/customers does not emit legacy X-RateLimit-* response headers', async () => {
    const { headers } = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    assert.ok(!('x-ratelimit-limit' in headers), 'X-RateLimit-Limit must be absent (legacyHeaders: false)');
    assert.ok(!('x-ratelimit-remaining' in headers), 'X-RateLimit-Remaining must be absent (legacyHeaders: false)');
    assert.ok(!('x-ratelimit-reset' in headers), 'X-RateLimit-Reset must be absent (legacyHeaders: false)');
  });

  it('POST /api/customers emits standard RateLimit-* response headers', async () => {
    const { headers } = await requestWithHeaders(server, 'POST', '/api/customers', { name: 'New Customer', email: 'new@example.test' }, 'token');
    assert.ok('ratelimit-limit' in headers, 'Expected RateLimit-Limit header to be present');
    assert.ok('ratelimit-remaining' in headers, 'Expected RateLimit-Remaining header to be present');
    assert.ok('ratelimit-reset' in headers, 'Expected RateLimit-Reset header to be present');
  });

  it('POST /api/customers does not emit legacy X-RateLimit-* response headers', async () => {
    const { headers } = await requestWithHeaders(server, 'POST', '/api/customers', { name: 'Another Customer' }, 'token');
    assert.ok(!('x-ratelimit-limit' in headers), 'X-RateLimit-Limit must be absent (legacyHeaders: false)');
    assert.ok(!('x-ratelimit-remaining' in headers), 'X-RateLimit-Remaining must be absent (legacyHeaders: false)');
    assert.ok(!('x-ratelimit-reset' in headers), 'X-RateLimit-Reset must be absent (legacyHeaders: false)');
  });

  it('RateLimit-Limit header reflects the configured max of 60', async () => {
    const { headers } = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    assert.equal(headers['ratelimit-limit'], '60');
  });

  it('RateLimit-Remaining decrements with each request to /api/customers', async () => {
    const first = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    const second = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    const firstRemaining = parseInt(first.headers['ratelimit-remaining'], 10);
    const secondRemaining = parseInt(second.headers['ratelimit-remaining'], 10);
    assert.equal(secondRemaining, firstRemaining - 1, 'Remaining count should decrement by 1 per request');
  });

  it('non-customer routes are not subject to the customers rate limiter', async () => {
    const { headers } = await requestWithHeaders(server, 'GET', '/api/apps', undefined, 'token');
    assert.ok(!('ratelimit-limit' in headers), 'GET /api/apps must not emit RateLimit-Limit (no rate limiter on this route)');
  });

  it('GET /api/customers returns 429 after exceeding the 60-request limit', async () => {
    let remaining = -1;
    const probe = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    remaining = parseInt(probe.headers['ratelimit-remaining'], 10);

    for (let i = 0; i < remaining; i++) {
      await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    }

    const { status } = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    assert.equal(status, 429, 'Expected 429 Too Many Requests after exhausting the rate-limit window');
  });

  it('POST /api/customers also returns 429 once the shared limit is exhausted', async () => {
    const { status } = await requestWithHeaders(server, 'POST', '/api/customers', { name: 'X' }, 'token');
    assert.equal(status, 429, 'POST /api/customers must also be blocked after the shared limit is exhausted');
  });

  it('rate-limited 429 response includes a Retry-After header', async () => {
    const { status, headers } = await requestWithHeaders(server, 'GET', '/api/customers', undefined, 'token');
    assert.equal(status, 429);
    assert.ok('retry-after' in headers, 'Expected Retry-After header on 429 response');
  });
});
