import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import http from 'node:http';
import { app, setSupabaseClientForTests } from '../../server/index.ts';
import { makeSupabase } from '../helpers/supabase-mock.ts';
import { request } from '../helpers/http-client.ts';
import * as changeApproval from '../../server/change-approval-engine.ts';

describe('Feature API integration tests', () => {
  let server: http.Server;

  before(async () => {
    server = app.listen(0);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    const db: any = {
      setup_config: [{ id: 'setup', initialized: true, mode: 'business' }],
      docker_apps: [
        { id: 'owned-app', user_id: 'user-1', name: 'Owned', image: 'nginx', status: 'stopped' },
      ],
      user_profiles: [{ id: 'user-1', display_name: 'Test User', role: 'admin' }],
    };
    setSupabaseClientForTests(makeSupabase(db));
  });

  it('GET /api/plugins returns plugin list', async () => {
    const response = await request(server, 'GET', '/api/plugins', undefined, 'token');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length > 0);
  });

  it('GET /api/plugins/:id returns a specific plugin', async () => {
    const listRes = await request(server, 'GET', '/api/plugins', undefined, 'token');
    const firstId = listRes.body[0].id;
    const response = await request(server, 'GET', `/api/plugins/${firstId}`, undefined, 'token');
    assert.equal(response.status, 200);
    assert.equal(response.body.id, firstId);
  });

  it('POST /api/change-requests creates a pending change request', async () => {
    const response = await request(server, 'POST', '/api/change-requests', {
      appId: 'owned-app',
      action: 'restart',
      reason: 'Testing change approval',
      details: 'Restarting for test',
    }, 'token');
    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'pending');
    assert.equal(response.body.action, 'restart');
  });

  it('POST /api/change-requests with break glass creates emergency request', async () => {
    const response = await request(server, 'POST', '/api/change-requests', {
      appId: 'owned-app',
      action: 'delete',
      reason: 'Emergency',
      details: 'Critical fix',
      isBreakGlass: true,
    }, 'token');
    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'emergency');
    assert.equal(response.body.isBreakGlass, true);
  });

  it('POST /api/change-requests/:id/approve approves a request', async () => {
    const createRes = await request(server, 'POST', '/api/change-requests', {
      appId: 'owned-app',
      action: 'restart',
      reason: 'Test approve',
    }, 'token');
    const id = createRes.body.id;

    const approveRes = await request(server, 'POST', `/api/change-requests/${id}/approve`, undefined, 'token');
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.status, 'approved');
  });

  it('POST /api/change-requests/:id/reject rejects with reason', async () => {
    const createRes = await request(server, 'POST', '/api/change-requests', {
      appId: 'owned-app',
      action: 'restart',
      reason: 'Test reject',
    }, 'token');
    const id = createRes.body.id;

    const rejectRes = await request(server, 'POST', `/api/change-requests/${id}/reject`, { reason: 'Not needed' }, 'token');
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.status, 'rejected');
    assert.equal(rejectRes.body.rejectReason, 'Not needed');
  });

  it('GET /api/change-requests lists requests', async () => {
    await request(server, 'POST', '/api/change-requests', {
      appId: 'owned-app',
      action: 'restart',
      reason: 'List test',
    }, 'token');

    const response = await request(server, 'GET', '/api/change-requests', undefined, 'token');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    assert.ok(response.body.length > 0);
  });

  it('POST /api/terminal/sessions creates a session', async () => {
    const response = await request(server, 'POST', '/api/terminal/sessions', {
      appId: 'owned-app',
    }, 'token');
    assert.equal(response.status, 201);
    assert.ok(response.body.id);
    assert.equal(response.body.appId, 'owned-app');
  });

  it('GET /api/config/:appId/advice requires auth', async () => {
    const response = await request(server, 'GET', '/api/config/owned-app/advice');
    assert.equal(response.status, 401);
  });
});
