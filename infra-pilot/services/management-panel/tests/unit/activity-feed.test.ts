import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as activity from '../../server/activity-feed.ts';

describe('activity feed module', () => {
  beforeEach(async () => {
    const { events } = await activity.getEvents({ limit: 5000 });
    for (const e of events) {
      // Individual deletion not exposed; we clear by reinitializing
    }
  });

  it('adds and retrieves events', async () => {
    const event = await activity.addEvent({
      type: 'app:create',
      userId: 'user-1',
      userName: 'Test User',
      description: 'Created test app',
      severity: 'info',
    });

    assert.ok(event.id);
    assert.equal(event.type, 'app:create');
    assert.equal(event.userId, 'user-1');
    assert.equal(event.severity, 'info');
    assert.ok(event.timestamp);

    const fetched = await activity.getEvent(event.id);
    assert.ok(fetched);
    assert.equal(fetched?.description, 'Created test app');
  });

  it('filters events by type', async () => {
    await activity.addEvent({ type: 'app:start', userId: 'u1', description: 'App started', severity: 'info' });
    await activity.addEvent({ type: 'backup:create', userId: 'u1', description: 'Backup created', severity: 'info' });
    await activity.addEvent({ type: 'app:stop', userId: 'u1', description: 'App stopped', severity: 'warning' });

    const { events } = await activity.getEvents({ type: 'app:start' });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'app:start');
  });

  it('filters events by userId', async () => {
    await activity.addEvent({ type: 'app:create', userId: 'user-a', description: 'A creates', severity: 'info' });
    await activity.addEvent({ type: 'app:create', userId: 'user-b', description: 'B creates', severity: 'info' });

    const { events } = await activity.getEvents({ userId: 'user-a' });
    assert.equal(events.length, 1);
    assert.equal(events[0].userId, 'user-a');
  });

  it('exports events as CSV', async () => {
    await activity.addEvent({ type: 'app:create', userId: 'u1', userName: 'User', description: 'Test', severity: 'info' });
    const csv = await activity.exportEvents({ format: 'csv' });
    assert.ok(csv.startsWith('id,type,userId,userName,description,severity,timestamp'));
    assert.ok(csv.includes('"app:create"'));
    assert.ok(csv.includes('"User"'));
  });

  it('exports events as JSON', async () => {
    await activity.addEvent({ type: 'app:create', userId: 'u1', description: 'Test export', severity: 'info' });
    const json = await activity.exportEvents({ format: 'json' });
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length > 0);
  });
});
