import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlan } from '../../server/assistant.ts';

const apps = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'web' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'minecraft' },
];

describe('assistant plan builder', () => {
  it('detects a start intent and maps it to the app id', () => {
    const plan = buildPlan('please start web', apps);
    assert.equal(plan.intent, 'start');
    assert.equal(plan.actions[0].appId, '11111111-1111-1111-1111-111111111111');
    assert.equal(plan.requires_approval, true);
  });

  it('detects a stop intent by app name case-insensitively', () => {
    const plan = buildPlan('Stop Minecraft now', apps);
    assert.equal(plan.intent, 'stop');
    assert.equal(plan.actions[0].appId, '22222222-2222-2222-2222-222222222222');
  });

  it('status and logs do not require approval', () => {
    assert.equal(buildPlan('what is the status of web', apps).requires_approval, false);
    assert.equal(buildPlan('show logs for web', apps).requires_approval, false);
  });

  it('falls back to the first matching action for ambiguous requests', () => {
    const plan = buildPlan('restart minecraft', apps);
    assert.equal(plan.intent, 'restart');
    assert.equal(plan.actions.length, 1);
  });

  it('recognizes a raw app id without a known name', () => {
    const plan = buildPlan('restart 33333333-3333-3333-3333-333333333333', apps);
    assert.equal(plan.actions[0].appId, '33333333-3333-3333-3333-333333333333');
  });

  it('returns a helpful message for unknown app names', () => {
    const plan = buildPlan('start nonexistent_app', apps);
    assert.equal(plan.actions.length, 0);
    assert.match(plan.message, /couldn't find/i);
  });

  it('plans a local benchmark without an app', () => {
    const plan = buildPlan('run a benchmark', apps);
    assert.equal(plan.intent, 'benchmark');
    assert.equal(plan.actions[0].tool, 'benchmark');
    assert.equal(plan.actions[0].appId, undefined);
    assert.equal(plan.requires_approval, true);
  });

  it('handles empty requests gracefully', () => {
    const plan = buildPlan('   ', apps);
    assert.equal(plan.intent, 'status');
  });
});