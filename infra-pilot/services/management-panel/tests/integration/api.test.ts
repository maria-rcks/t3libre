import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import http from 'node:http';
import { app, setSupabaseClientForTests } from '../../server/index.ts';
import { Row, Db, makeSupabase } from '../helpers/supabase-mock.ts';
import { request } from '../helpers/http-client.ts';

describe('management-panel API integration contract', () => {
  let server: http.Server;
  let db: Db;

  before(async () => {
    server = app.listen(0);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.VITE_DEMO_FEATURE_ENABLED = 'true';
    db = {
      setup_config: [{ id: 'setup', initialized: true, mode: 'business' }],
      docker_apps: [
        { id: 'owned-app', user_id: 'user-1', name: 'Owned', image: 'nginx', status: 'stopped' },
        { id: 'other-app', user_id: 'user-2', name: 'Other', image: 'redis', status: 'stopped' },
      ],
      app_logs: [{ id: 'log-1', app_id: 'owned-app', message: 'started' }],
      customers: [{ id: 'customer-1', owner_user_id: 'user-1', name: 'Acme Co' }],
      user_profiles: [{ id: 'user-1', display_name: 'Test User', role: 'admin' }],
    };
    setSupabaseClientForTests(makeSupabase(db));
  });

  it('rejects authenticated endpoints without a bearer token', async () => {
    const response = await request(server, 'GET', '/api/apps');
    assert.equal(response.status, 401);
  });

  it('requires auth to list runbooks', async () => {
    const response = await request(server, 'GET', '/api/runbooks');
    assert.equal(response.status, 401);
  });

  it('requires auth to set up, confirm or disable 2FA', async () => {
    for (const path of ['/api/auth/2fa/setup', '/api/auth/2fa/verify-setup', '/api/auth/2fa/disable']) {
      const response = await request(server, 'POST', path, {});
      assert.equal(response.status, 401, `${path} should require auth`);
    }
  });

  it('filters apps by the authenticated owner', async () => {
    const response = await request(server, 'GET', '/api/apps', undefined, 'token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((app: Row) => app.id), ['owned-app']);
  });

  it('blocks business endpoints while in personal mode', async () => {
    db.setup_config[0].mode = 'personal';
    const response = await request(server, 'GET', '/api/customers', undefined, 'token');
    assert.equal(response.status, 403);
  });

  it('validates setup initialization payloads', async () => {
    const response = await request(server, 'POST', '/api/setup/init', { email: 'admin@example.test', password: 'secret', mode: 'invalid' });
    assert.equal(response.status, 400);
  });

  it('reports the demo feature flag from the environment', async () => {
    process.env.VITE_DEMO_FEATURE_ENABLED = 'false';
    const response = await request(server, 'GET', '/api/demo/flag');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { enabled: false });
  });

  it('keeps demo seeding idempotent per owner and app name', async () => {
    let response = await request(server, 'POST', '/api/seed-demo', undefined, 'token');
    assert.equal(response.status, 200);
    assert.equal(response.body.appsSeeded, 2);

    response = await request(server, 'POST', '/api/seed-demo', undefined, 'token');
    assert.equal(response.status, 200);
    assert.equal(response.body.appsSeeded, 0);

    const demoAppsForUser = db.docker_apps.filter((row) => row.user_id === 'user-1' && ['demo-app', 'monitor'].includes(row.name));
    assert.equal(demoAppsForUser.length, 2);
  });
});
