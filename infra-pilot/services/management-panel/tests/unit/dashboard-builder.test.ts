import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as de from '../../server/dashboard-engine.ts';

describe('dashboard engine module', () => {
  beforeEach(async () => {
    const dashboards = await de.listDashboards();
    for (const d of dashboards) {
      await de.deleteDashboard(d.id);
    }
  });

  it('creates and retrieves a dashboard', async () => {
    const created = await de.createDashboard({
      name: 'Test Dashboard',
      description: 'A test dashboard',
      panels: [],
      layout: { columns: 12, rowHeight: 100 },
      refreshInterval: 30,
      starred: false,
    });

    assert.ok(created.id);
    assert.equal(created.name, 'Test Dashboard');
    assert.equal(created.description, 'A test dashboard');
    assert.ok(created.created_at);
    assert.ok(created.updated_at);

    const fetched = await de.getDashboard(created.id);
    assert.ok(fetched);
    assert.equal(fetched?.name, 'Test Dashboard');
  });

  it('updates an existing dashboard', async () => {
    const created = await de.createDashboard({ name: 'Original' });
    const updated = await de.updateDashboard(created.id, { name: 'Updated Dashboard', description: 'Updated desc' });
    assert.ok(updated);
    assert.equal(updated?.name, 'Updated Dashboard');
    assert.equal(updated?.description, 'Updated desc');
  });

  it('deletes a dashboard', async () => {
    const created = await de.createDashboard({ name: 'To Delete' });
    const deleted = await de.deleteDashboard(created.id);
    assert.equal(deleted, true);

    const fetched = await de.getDashboard(created.id);
    assert.equal(fetched, null);
  });

  it('lists all dashboards', async () => {
    await de.createDashboard({ name: 'DB 1' });
    await de.createDashboard({ name: 'DB 2' });
    await de.createDashboard({ name: 'DB 3' });

    const list = await de.listDashboards();
    assert.equal(list.length, 3);
  });

  it('returns null for nonexistent dashboard', async () => {
    const fetched = await de.getDashboard('nonexistent');
    assert.equal(fetched, null);
  });

  it('rejects delete for nonexistent dashboard', async () => {
    const result = await de.deleteDashboard('nonexistent');
    assert.equal(result, false);
  });
});
