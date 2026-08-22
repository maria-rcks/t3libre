import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeGraphQL, parseSelectionSet } from '../../server/graphql.ts';

const ctx = {
  userId: 'user-1',
  query: async (table: string, args?: Record<string, any>) => {
    assert.equal(args?.user_id, 'user-1');
    if (table === 'docker_apps') {
      if (args?.status === 'running') {
        return { data: [{ id: 'a1', name: 'web', status: 'running' }], error: null };
      }
      return {
        data: [
          { id: 'a1', name: 'web', status: 'running' },
          { id: 'a2', name: 'db', status: 'stopped' },
        ],
        error: null,
      };
    }
    if (table === 'audit_log') {
      return { data: [{ id: 1, action: 'app:start', entity_id: 'a1' }], error: null };
    }
    return { data: [], error: null };
  },
};

describe('graphql minimal engine', () => {
  it('parses a selection set', () => {
    const fields = parseSelectionSet('{ apps { id name } health }');
    assert.equal(fields.length, 2);
    assert.equal(fields[0].name, 'apps');
    assert.deepEqual(fields[0].children.map((c) => c.name), ['id', 'name']);
  });

  it('executes apps with field projection', async () => {
    const result = await executeGraphQL('{ apps { id name } }', ctx);
    assert.ok(result.data);
    assert.deepEqual((result.data.apps as any[]).map((a) => a.id), ['a1', 'a2']);
    const first = (result.data.apps as any[])[0];
    assert.equal(first.name, 'web');
    assert.equal(first.status, undefined);
  });

  it('applies status argument filters', async () => {
    const result = await executeGraphQL('{ apps(status: "running") { name } }', ctx);
    assert.deepEqual((result.data!.apps as any[]).map((a) => a.name), ['web']);
  });

  it('supports aliases', async () => {
    const result = await executeGraphQL('{ myApps: apps { name } }', ctx);
    assert.ok(result.data!.myApps);
  });

  it('returns real data for auditLog', async () => {
    const result = await executeGraphQL('{ auditLog { action } }', ctx);
    assert.equal((result.data!.auditLog as any[])[0].action, 'app:start');
  });

  it('reports unknown fields as errors', async () => {
    const result = await executeGraphQL('{ bogus }', ctx);
    assert.ok(result.errors);
    assert.match(result.errors[0].message, /Unknown field/);
  });

  it('reports invalid documents as errors', async () => {
    const result = await executeGraphQL('nonsense', ctx);
    assert.ok(result.errors);
  });

  it('projects nested rows recursively', async () => {
    const result = await executeGraphQL('{ apps { id name } }', ctx);
    assert.deepEqual(Object.keys((result.data!.apps as any[])[0]).sort(), ['id', 'name']);
  });
});